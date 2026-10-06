import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { EventType, NotificationType, RecordStatus, type Role } from '../domain/enums.js';
import { z } from 'zod';
import { prisma } from '../db.js';
import { actorOf, requireUser } from '../auth/guard.js';
import { STATUS_FROM_SLUG, STATUS_LABELS, WORK_STATUSES } from '../domain/constants.js';
import { can, canTransition, type Action } from '../domain/permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { detailInclude, serializeRecord } from '../lib/serialize.js';
import { MAX_FILES } from '../domain/attachments.js';
import { lockRecordByCode, toJsonText } from '../lib/dialect.js';
import { recordForward } from '../ml/service.js';
import { notifyUsers } from '../lib/notify.js';

/** Yorum ve çözümle birlikte gönderilebilecek, önceden yüklenmiş taslak ekler. */
const attachmentIds = z.array(z.string().min(1).max(64)).max(MAX_FILES).default([]);

/**
 * Her aksiyon aynı iskeleti izler:
 *   1. kaydı kilitle,        2. yetkiyi doğrula,
 *   3. durum geçişini doğrula, 4. yaz + olay + denetim izi.
 *
 * Yetki kararı arayüzden gelen bilgiye göre değil, her seferinde
 * `permissions.ts` içindeki aynı fonksiyonlarla verilir. Arayüz düğmeyi
 * gizlemeyi unutsa bile istek 403 döner.
 */
async function mutate(
  app: FastifyInstance,
  opts: {
    code: string;
    actorId: string;
    actorRole: string;
    actorDept: string | null;
    action: Action;
    ip: string;
    /** Değişiklikleri ve olay metnini üretir. */
    plan: (rec: {
      id: string;
      status: string;
      departmentId: string;
      department2Id: string | null;
      assigneeId: string | null;
      firstResponseAt: Date | null;
      createdById: string;
    }) => {
      data: Prisma.RecordUpdateInput;
      event: { type: EventType; text: string; meta?: unknown };
      nextStatus?: RecordStatus;
      /** Aynı işlemde yazılacak bildirim. İşlemi yapan kişi kendine bildirim almaz. */
      notify?: { userIds: (string | null)[]; type: NotificationType; text: string };
      /** Bu olaya bağlanacak taslak ekler (bu kayda, bu kişinin yüklediği, henüz gönderilmemiş). */
      attachmentIds?: string[];
    };
  },
) {
  const actor = { id: opts.actorId, role: opts.actorRole, departmentId: opts.actorDept };

  return prisma.$transaction(async (tx) => {
    // Eşzamanlı iki "üzerime al" isteğinden yalnızca biri kazanmalı.
    // Satır kilidi: SELECT … FOR UPDATE (bkz. lib/dialect.ts).
    const locked = await lockRecordByCode(tx, opts.code);
    if (!locked) throw notFound();

    const rec = await tx.record.findUnique({
      where: { code: opts.code },
      select: {
        id: true,
        status: true,
        departmentId: true,
        department2Id: true,
        createdById: true,
        assigneeId: true,
        anonymous: true,
        firstResponseAt: true,
      },
    });
    if (!rec) throw notFound();

    if (!can(opts.action, rec, actor)) {
      throw forbidden(`Bu kayıtta "${opts.action}" işlemi için yetkiniz yok.`);
    }

    const planned = opts.plan(rec);

    if (planned.nextStatus && !canTransition(rec.status, planned.nextStatus)) {
      throw conflict(
        `"${STATUS_LABELS[rec.status]}" durumundan "${STATUS_LABELS[planned.nextStatus]}" durumuna geçilemez.`,
      );
    }

    // updatedAt açıkça yazılır: yorum gibi alan değiştirmeyen aksiyonlar da
    // kaydı "son güncellenen" yapmalı.
    await tx.record.update({ where: { id: rec.id }, data: { ...planned.data, updatedAt: new Date() } });

    // Olay ayrı oluşturulur ki kimliği eklere bağlanabilsin.
    const event = await tx.recordEvent.create({
      data: {
        recordId: rec.id,
        type: planned.event.type,
        text: planned.event.text,
        byId: opts.actorId,
        ...(planned.event.meta ? { meta: toJsonText(planned.event.meta) } : {}),
      },
      select: { id: true },
    });

    const ids = [...new Set(planned.attachmentIds ?? [])];
    if (ids.length) {
      const { count } = await tx.attachment.updateMany({
        where: { id: { in: ids }, recordId: rec.id, uploadedById: opts.actorId, eventId: null },
        data: { eventId: event.id },
      });
      if (count !== ids.length) {
        throw badRequest('Eklerden biri bulunamadı ya da zaten gönderilmiş. Sayfayı yenileyip tekrar deneyin.');
      }
    }

    const updated = await tx.record.findUniqueOrThrow({ where: { id: rec.id }, include: detailInclude });

    if (planned.notify) {
      await notifyUsers(tx, { ...planned.notify, except: opts.actorId, recordId: rec.id });
    }

    await tx.auditLog.create({
      data: {
        actorId: opts.actorId,
        action: `record.${opts.action}`,
        entity: 'Record',
        entityId: rec.id,
        before: toJsonText({ status: rec.status, assigneeId: rec.assigneeId }),
        after: toJsonText({ status: updated.status, assigneeId: updated.assigneeId }),
        ip: opts.ip,
      },
    });

    return updated;
  });
}

/** İlk ekip teması SLA'nın "ilk geri dönüş" ölçümünü başlatır. */
const stampFirstResponse = (rec: { firstResponseAt: Date | null }) =>
  rec.firstResponseAt ? {} : { firstResponseAt: new Date() };

export default async function actionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  const codeParam = (req: unknown) => (req as { params: { code: string } }).params.code;

  /** Üzerime al. */
  app.post('/api/records/:code/claim', async (req) => {
    const a = actorOf(req);
    const rec = await mutate(app, {
      code: codeParam(req),
      actorId: a.id,
      actorRole: a.role,
      actorDept: a.departmentId,
      action: 'claim',
      ip: req.ip,
      plan: (r) => ({
        nextStatus: RecordStatus.UZERIME_ALINDI,
        data: {
          assignee: { connect: { id: a.id } },
          status: RecordStatus.UZERIME_ALINDI,
          ...stampFirstResponse(r),
        },
        event: { type: EventType.ASSIGN, text: `Kayıt ${req.user!.name} tarafından üzerine alındı.` },
      }),
    });
    return { record: await serializeRecord(rec, a) };
  });

  /** Yönlendirme: başka ekibe ya da ekipteki başka kişiye. */
  const forwardBody = z
    .object({
      departmentId: z.string().min(1).optional(),
      assigneeId: z.string().min(1).optional(),
      note: z.string().trim().max(1000).optional(),
    })
    .refine((v) => Boolean(v.departmentId) !== Boolean(v.assigneeId), {
      message: 'Departman veya kişi seçin — ikisi birlikte olmaz.',
    });

  app.post('/api/records/:code/forward', async (req) => {
    const a = actorOf(req);
    const parsed = forwardBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);
    const { departmentId, assigneeId, note } = parsed.data;

    let text: string;
    let data: Prisma.RecordUpdateInput;
    let nextStatus: RecordStatus | ((current: string) => RecordStatus);
    let mateDept: string | null = null;

    if (departmentId) {
      const dept = await prisma.department.findFirst({
        where: { id: departmentId, active: true },
        select: { name: true },
      });
      if (!dept) throw badRequest('Ekip bulunamadı.');

      // Ekip değişince kayıt yeniden sahipsiz kalır — yeni ekipten biri alır.
      nextStatus = RecordStatus.YENI;
      data = {
        department: { connect: { id: departmentId } },
        assignee: { disconnect: true },
        status: RecordStatus.YENI,
      };
      text = `Kayıt ${dept.name} ekibine yönlendirildi.`;
    } else {
      const mate = await prisma.user.findFirst({
        where: { id: assigneeId!, active: true },
        select: { name: true, departmentId: true },
      });
      if (!mate) throw badRequest('Kişi bulunamadı.');
      mateDept = mate.departmentId;

      // Devir bir sahip değişikliğidir, durum değişikliği değil: yeni kayıt
      // "Üzerime Alındı"ya geçer, üzerinde çalışılan kayıt durumunu korur.
      // (Eskiden hep Üzerime Alındı'ya çekiliyordu; Çalışılıyor'dan geri
      // geçiş olmadığı için çalışılan kayıt devredilemiyordu.)
      nextStatus = (current) =>
        current === RecordStatus.YENI ? RecordStatus.UZERIME_ALINDI : (current as RecordStatus);
      data = { assignee: { connect: { id: assigneeId! } } };
      text = `Kayıt ${mate.name} kişisine atandı.`;
    }

    if (note) text += ` Not: ${note}`;

    const rec = await mutate(app, {
      code: codeParam(req),
      actorId: a.id,
      actorRole: a.role,
      actorDept: a.departmentId,
      action: 'forward',
      ip: req.ip,
      plan: (r) => {
        // Kişiye devir yalnızca kaydın ekibindeki birine: aksi hâlde kayıt,
        // görmemesi gereken birinin üzerine düşüp ona görünür olurdu.
        if (assigneeId && (!mateDept || (mateDept !== r.departmentId && mateDept !== r.department2Id))) {
          throw badRequest('Kayıt yalnızca ekipteki birine devredilebilir; başka ekibe göndermek için ekip seçin.');
        }
        const next = typeof nextStatus === 'function' ? nextStatus(r.status) : nextStatus;
        return {
        nextStatus: next,
        data: { ...data, ...(assigneeId ? { status: next } : {}), ...stampFirstResponse(r) },
        event: { type: EventType.FORWARD, text, meta: { departmentId, assigneeId } },
        ...(assigneeId
          ? { notify: { userIds: [assigneeId], type: NotificationType.ASSIGNED, text: `${codeParam(req)} size atandı.` } }
          : {}),
        };
      },
    });

    // Ekip değiştiyse bu, açılışta seçilen (ya da ML'in önerdiği) ekibin yanlış
    // olduğunun kanıtıdır — ML veritabanındaki sonuca "doğru ekip" olarak yazılır.
    if (departmentId) await recordForward(req.log, rec.code, departmentId);

    return { record: await serializeRecord(rec, a) };
  });

  /** Ara durum güncelleme. */
  app.post('/api/records/:code/status', async (req) => {
    const a = actorOf(req);
    const parsed = z
      .object({ status: z.string(), note: z.string().trim().max(1000).optional() })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Geçersiz istek.');

    const next = STATUS_FROM_SLUG[parsed.data.status];
    if (!next || !WORK_STATUSES.includes(next)) {
      throw badRequest('Bu uçtan yalnızca İnceleniyor, Çalışılıyor veya Ek Bilgi durumları ayarlanır.');
    }

    const note = parsed.data.note;
    const rec = await mutate(app, {
      code: codeParam(req),
      actorId: a.id,
      actorRole: a.role,
      actorDept: a.departmentId,
      action: 'status',
      ip: req.ip,
      plan: (r) => ({
        nextStatus: next,
        data: { status: next, ...stampFirstResponse(r) },
        event: {
          type: EventType.STATUS,
          text: `Durum güncellendi: ${STATUS_LABELS[next]}${note ? ` — ${note}` : ''}`,
          meta: { from: r.status, to: next },
        },
        ...(next === RecordStatus.EK_BILGI
          ? {
              notify: {
                userIds: [r.createdById],
                type: NotificationType.INFO_REQUESTED,
                text: `${codeParam(req)} için sizden ek bilgi bekleniyor. Kayda güncelleme ekleyerek yanıtlayın.`,
              },
            }
          : {}),
      }),
    });
    return { record: await serializeRecord(rec, a) };
  });

  /** Çözüldü. Çözüm metni zorunlu — kapanan kaydın bilgi değeri buradan gelir. */
  app.post('/api/records/:code/resolve', async (req) => {
    const a = actorOf(req);
    const parsed = z
      .object({
        resolution: z.string().trim().min(10, 'Çözümü en az 10 karakter yazın.').max(5000),
        attachmentIds,
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);
    const { resolution } = parsed.data;

    const rec = await mutate(app, {
      code: codeParam(req),
      actorId: a.id,
      actorRole: a.role,
      actorDept: a.departmentId,
      action: 'resolve',
      ip: req.ip,
      plan: (r) => ({
        nextStatus: RecordStatus.COZULDU,
        data: {
          status: RecordStatus.COZULDU,
          resolution,
          resolvedAt: new Date(),
          ...stampFirstResponse(r),
        },
        event: { type: EventType.COMMENT, text: resolution },
        attachmentIds: parsed.data.attachmentIds,
        notify: {
          userIds: [r.createdById],
          type: NotificationType.RESOLVED,
          text: `${codeParam(req)} çözüldü. Çözümü inceleyip kaydı kapatın ya da işe yaramadıysa yeniden açın.`,
        },
      }),
    });
    return { record: await serializeRecord(rec, a) };
  });

  /** Reddet. */
  app.post('/api/records/:code/reject', async (req) => {
    const a = actorOf(req);
    const parsed = z
      .object({ reason: z.string().trim().min(10, 'Ret gerekçesini yazın.').max(2000) })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);

    const rec = await mutate(app, {
      code: codeParam(req),
      actorId: a.id,
      actorRole: a.role,
      actorDept: a.departmentId,
      action: 'reject',
      ip: req.ip,
      plan: (r) => ({
        nextStatus: RecordStatus.REDDEDILDI,
        data: { status: RecordStatus.REDDEDILDI, closedAt: new Date(), ...stampFirstResponse(r) },
        event: { type: EventType.STATUS, text: `Kayıt reddedildi. Gerekçe: ${parsed.data.reason}` },
        notify: { userIds: [r.createdById], type: NotificationType.REJECTED, text: `${codeParam(req)} reddedildi.` },
      }),
    });
    return { record: await serializeRecord(rec, a) };
  });

  /**
   * Yeniden aç — çözüm işe yaramadıysa kaydı açan kişi kaydı sahibine geri
   * gönderir. Gerekçe zorunlu: sahip neyin eksik kaldığını bilmeli.
   */
  app.post('/api/records/:code/reopen', async (req) => {
    const a = actorOf(req);
    const parsed = z
      .object({ reason: z.string().trim().min(10, 'Neden yeniden açtığınızı en az 10 karakterle yazın.').max(2000) })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);

    const rec = await mutate(app, {
      code: codeParam(req),
      actorId: a.id,
      actorRole: a.role,
      actorDept: a.departmentId,
      action: 'reopen',
      ip: req.ip,
      plan: (r) => ({
        nextStatus: RecordStatus.CALISILIYOR,
        // İşe yaramayan çözüm "güncel çözüm" olarak görünmesin ve ML onu benzer
        // kayıtlarda önermesin; metni süreç geçmişinde kalıyor.
        data: { status: RecordStatus.CALISILIYOR, resolvedAt: null, resolution: null },
        event: { type: EventType.REOPEN, text: `Kayıt yeniden açıldı. Gerekçe: ${parsed.data.reason}` },
        notify: {
          userIds: [r.assigneeId],
          type: NotificationType.REOPENED,
          text: `${codeParam(req)} yeniden açıldı: çözüm kaydı açan kişinin sorununu gidermedi.`,
        },
      }),
    });
    return { record: await serializeRecord(rec, a) };
  });

  /** Kaydı kapat — çözümün yeterli olduğuna kaydı açan karar verir. */
  app.post('/api/records/:code/close', async (req) => {
    const a = actorOf(req);
    const rec = await mutate(app, {
      code: codeParam(req),
      actorId: a.id,
      actorRole: a.role,
      actorDept: a.departmentId,
      action: 'close',
      ip: req.ip,
      plan: () => ({
        nextStatus: RecordStatus.KAPATILDI,
        data: { status: RecordStatus.KAPATILDI, closedAt: new Date() },
        event: { type: EventType.STATUS, text: 'Kayıt, açan kişi tarafından kapatıldı.' },
      }),
    });
    return { record: await serializeRecord(rec, a) };
  });

  /** Yorum. */
  app.post('/api/records/:code/comments', async (req) => {
    const a = actorOf(req);
    const parsed = z
      .object({ text: z.string().trim().max(4000).default(''), attachmentIds })
      .refine((v) => v.text.length > 0 || v.attachmentIds.length > 0, { message: 'Güncelleme boş olamaz: metin yazın ya da dosya ekleyin.' })
      .safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);
    const files = parsed.data.attachmentIds.length;
    const text = parsed.data.text || (files === 1 ? 'Dosya eklendi.' : `${files} dosya eklendi.`);

    const rec = await mutate(app, {
      code: codeParam(req),
      actorId: a.id,
      actorRole: a.role,
      actorDept: a.departmentId,
      action: 'comment',
      ip: req.ip,
      plan: (r) => ({
        // Ekipten gelen ilk yorum da geri dönüş sayılır; kaydı açanın kendi
        // yorumu sayılmamalı.
        data: r.createdById === a.id ? {} : stampFirstResponse(r),
        event: { type: EventType.COMMENT, text },
        attachmentIds: parsed.data.attachmentIds,
        // Açan yazdıysa sahibine (ek bilgi yanıtı), ekipten biri yazdıysa açana.
        notify: {
          userIds: r.createdById === a.id ? [r.assigneeId] : [r.createdById],
          type: NotificationType.COMMENT,
          text: `${codeParam(req)} kaydına yeni güncelleme eklendi.`,
        },
      }),
    });
    return { record: await serializeRecord(rec, a) };
  });
}
