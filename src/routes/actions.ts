import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { EventType, RecordStatus, type Role } from '../domain/enums.js';
import { z } from 'zod';
import { prisma } from '../db.js';
import { actorOf, requireUser } from '../auth/guard.js';
import { STATUS_FROM_SLUG, STATUS_LABELS, WORK_STATUSES } from '../domain/constants.js';
import { can, canTransition, type Action } from '../domain/permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { serializeRecord } from '../lib/serialize.js';
import { lockRecordByCode, toJsonText } from '../lib/dialect.js';
import { recordForward } from '../ml/service.js';

const withDetail = {
  events: {
    orderBy: { at: 'asc' as const },
    select: { type: true, text: true, at: true, byId: true },
  },
  attachments: { select: { id: true, name: true, size: true, mime: true } },
};

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
      assigneeId: string | null;
      firstResponseAt: Date | null;
      createdById: string;
    }) => {
      data: Prisma.RecordUpdateInput;
      event: { type: EventType; text: string; meta?: unknown };
      nextStatus?: RecordStatus;
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

    const updated = await tx.record.update({
      where: { id: rec.id },
      data: {
        ...planned.data,
        events: {
          create: {
            type: planned.event.type,
            text: planned.event.text,
            byId: opts.actorId,
            ...(planned.event.meta ? { meta: toJsonText(planned.event.meta) } : {}),
          },
        },
      },
      include: withDetail,
    });

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
    let nextStatus: RecordStatus;

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

      nextStatus = RecordStatus.UZERIME_ALINDI;
      data = {
        assignee: { connect: { id: assigneeId! } },
        status: RecordStatus.UZERIME_ALINDI,
      };
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
      plan: (r) => ({
        nextStatus,
        data: { ...data, ...stampFirstResponse(r) },
        event: { type: EventType.FORWARD, text, meta: { departmentId, assigneeId } },
      }),
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
      }),
    });
    return { record: await serializeRecord(rec, a) };
  });

  /** Çözüldü. Çözüm metni zorunlu — kapanan kaydın bilgi değeri buradan gelir. */
  app.post('/api/records/:code/resolve', async (req) => {
    const a = actorOf(req);
    const parsed = z
      .object({ resolution: z.string().trim().min(10, 'Çözümü en az 10 karakter yazın.').max(5000) })
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
      .object({ text: z.string().trim().min(1, 'Yorum boş olamaz.').max(4000) })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);

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
        event: { type: EventType.COMMENT, text: parsed.data.text },
      }),
    });
    return { record: await serializeRecord(rec, a) };
  });
}
