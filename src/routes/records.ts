import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { RecordStatus, Role } from '../domain/enums.js';
import { z } from 'zod';
import { prisma } from '../db.js';
import { actorOf, requireUser } from '../auth/guard.js';
import {
  OPEN_STATUSES,
  PRIORITY_FROM_SLUG,
  STATUS_FROM_SLUG,
  TYPE_FROM_SLUG,
} from '../domain/constants.js';
import { can } from '../domain/permissions.js';
import { dueDateFor } from '../domain/sla.js';
import { findSimilar } from '../domain/similarity.js';
import { logInference, recordOutcome, suggestDepartment } from '../ml/service.js';
import { nextRecordCode } from '../lib/code.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { serializeList, serializeRecord } from '../lib/serialize.js';
import { containsFilter, containsVariants, toJsonText } from '../lib/dialect.js';

/** Detay ve liste için ortak include — olay akışı ve ekler. */
const withDetail = {
  events: {
    orderBy: { at: 'asc' as const },
    select: { type: true, text: true, at: true, byId: true },
  },
  attachments: { select: { id: true, name: true, size: true, mime: true } },
};

/**
 * Kapsam süzgeci veritabanı seviyesinde uygulanır. Tüm kayıtları çekip
 * bellekte filtrelemek hem yavaş hem güvensiz olurdu: kullanıcının
 * görmemesi gereken kayıtlar hiç sorgudan dönmemeli.
 */
function scopeWhere(
  scope: string,
  actor: { id: string; role: string; departmentId: string | null },
): Prisma.RecordWhereInput {
  const teamFilter: Prisma.RecordWhereInput = actor.departmentId
    ? { OR: [{ departmentId: actor.departmentId }, { department2Id: actor.departmentId }] }
    : { id: '__none__' };

  switch (scope) {
    case 'mine':
      return { assigneeId: actor.id };
    case 'opened':
      return { createdById: actor.id };
    case 'team':
      return teamFilter;
    case 'all':
    default:
      // ADMIN her şeyi görür. Diğerleri: kendi açtıkları + ekiplerine düşenler
      // + üzerlerine aldıkları.
      if (actor.role === Role.ADMIN) return {};
      return {
        OR: [{ createdById: actor.id }, { assigneeId: actor.id }, ...(actor.departmentId ? [teamFilter] : [])],
      };
  }
}

const listQuery = z.object({
  scope: z.enum(['all', 'team', 'mine', 'opened']).default('all'),
  type: z.enum(['bilgi', 'oneri']).optional(),
  status: z.string().optional(),
  dept: z.string().optional(),
  q: z.string().max(200).optional(),
  open: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

const createBody = z.object({
  type: z.enum(['bilgi', 'oneri']),
  title: z.string().trim().min(5, 'Başlık en az 5 karakter olmalı.').max(200),
  description: z.string().trim().min(10, 'Açıklama en az 10 karakter olmalı.').max(5000),
  department: z.string().min(1),
  department2: z.string().min(1).nullable().optional(),
  priority: z.enum(['normal', 'yuksek', 'kritik']).default('normal'),
  anonymous: z.boolean().default(false),
  /** Kayıt açılırken gösterilen öneriler — modelin işe yararlılığını ölçmek için. */
  shownSuggestions: z.array(z.object({ code: z.string(), score: z.number() })).max(5).optional(),
  /** /api/similar'ın döndürdüğü ML çalıştırma kimliği — sonuç ML veritabanına bağlanır. */
  mlInferenceId: z.string().max(64).nullish(),
  /** Kullanıcı "Bu ekibi seç" ile ML'in ekip önerisini uyguladı mı. */
  deptSuggestionApplied: z.boolean().default(false),
});

export default async function recordRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  /** Liste. */
  app.get('/api/records', async (req) => {
    const actor = actorOf(req);
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);
    const { scope, type, status, dept, q, open, page, pageSize } = parsed.data;

    const and: Prisma.RecordWhereInput[] = [scopeWhere(scope, actor)];

    if (type) and.push({ type: TYPE_FROM_SLUG[type] });
    if (dept) and.push({ OR: [{ departmentId: dept }, { department2Id: dept }] });
    if (status) {
      const mapped = STATUS_FROM_SLUG[status];
      if (!mapped) throw badRequest('Geçersiz durum.');
      and.push({ status: mapped });
    }
    if (open !== undefined) {
      and.push(open ? { status: { in: OPEN_STATUSES } } : { status: { notIn: OPEN_STATUSES } });
    }
    if (q) {
      // Harf duyarsızlık lehçeye göre değişiyor: PostgreSQL'de mode:'insensitive',
      // SQLite'ta o argüman yok ve Türkçe harflerde LIKE duyarsız değil — bu
      // yüzden yazılan hâli ve büyük/küçük varyantları birlikte denenir.
      and.push({
        OR: containsVariants(q).flatMap((v) => [
          { code: containsFilter(v) },
          { title: containsFilter(v) },
          { description: containsFilter(v) },
        ]),
      });
    }

    const where: Prisma.RecordWhereInput = { AND: and };

    const [rows, total] = await Promise.all([
      prisma.record.findMany({
        where,
        include: withDetail,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.record.count({ where }),
    ]);

    return { records: await serializeList(rows, actor), total, page, pageSize };
  });

  /** Detay. */
  app.get('/api/records/:code', async (req) => {
    const actor = actorOf(req);
    const { code } = req.params as { code: string };

    const rec = await prisma.record.findUnique({ where: { code }, include: withDetail });
    if (!rec) throw notFound();
    if (!can('view', rec, actor)) throw forbidden('Bu kaydı görme yetkiniz yok.');

    return { record: await serializeRecord(rec, actor) };
  });

  /**
   * Benzer çözülmüş kayıtlar — kayıt açmadan önceki kontrol.
   * department ve type skorlamada bonus olarak kullanılır (prototipteki
   * mlScore ile aynı), bu yüzden formdan birlikte gelir.
   */
  app.post('/api/similar', async (req) => {
    const body = z
      .object({
        title: z.string().max(200).default(''),
        description: z.string().max(5000).default(''),
        department: z.string().max(64).nullish(),
        type: z.enum(['bilgi', 'oneri']).nullish(),
      })
      .safeParse(req.body);
    if (!body.success) throw badRequest('Geçersiz istek.');
    const actor = actorOf(req);

    const t0 = performance.now();
    const matches = await findSimilar(
      {
        title: body.data.title,
        description: body.data.description,
        department: body.data.department ?? null,
        type: body.data.type ?? null,
      },
      3,
    );
    // Ekip önerisi: formda ekip seçilmiş olsa bile hesaplanır — seçim ile
    // modelin önerisi farklıysa kullanıcıya gösterilir.
    const suggestion = suggestDepartment(body.data.title, body.data.description);

    // ML veritabanına: çalıştırma + her ekip önerisi + her eşleşme ayrı satır.
    const inferenceId = await logInference(req.log, {
      userId: actor.id,
      title: body.data.title,
      description: body.data.description,
      type: body.data.type ?? null,
      selectedDepartmentId: body.data.department ?? null,
      durationMs: performance.now() - t0,
      suggestion,
      matches: matches.map((m) => ({
        code: m.code,
        title: m.title,
        departmentId: m.departmentId,
        percent: m.percent,
        terms: m.terms,
      })),
    });

    return {
      matches,
      inferenceId,
      department: suggestion && suggestion.candidates.length
        ? {
            lowConfidence: suggestion.lowConfidence,
            candidates: suggestion.candidates.map((c) => ({
              id: c.departmentId,
              name: c.departmentName,
              percent: Math.round(c.probability * 100),
              terms: c.terms,
            })),
          }
        : null,
    };
  });

  /** Yeni kayıt. */
  app.post('/api/records', async (req, reply) => {
    const actor = actorOf(req);
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);
    const body = parsed.data;

    if (body.department2 && body.department2 === body.department) {
      throw badRequest('İkinci ekip birinciyle aynı olamaz.');
    }

    const deptIds = [body.department, ...(body.department2 ? [body.department2] : [])];
    const depts = await prisma.department.findMany({
      where: { id: { in: deptIds }, active: true },
      select: { id: true, name: true },
    });
    if (depts.length !== deptIds.length) throw badRequest('Seçilen ekip bulunamadı.');

    const primaryName = depts.find((d) => d.id === body.department)!.name;
    const secondName = body.department2 ? depts.find((d) => d.id === body.department2)!.name : null;

    const priority = PRIORITY_FROM_SLUG[body.priority]!;
    const now = new Date();
    const slaDueAt = await dueDateFor(priority, now);

    const created = await prisma.$transaction(async (tx) => {
      const code = await nextRecordCode(tx, now);

      const rec = await tx.record.create({
        data: {
          code,
          type: TYPE_FROM_SLUG[body.type]!,
          title: body.title,
          description: body.description,
          priority,
          status: RecordStatus.YENI,
          departmentId: body.department,
          department2Id: body.department2 ?? null,
          createdById: actor.id,
          anonymous: body.anonymous,
          createdAt: now,
          slaDueAt,
          events: {
            create: [
              {
                type: 'CREATE',
                byId: actor.id,
                at: now,
                text: `Kayıt oluşturuldu ve ${primaryName} ekibine iletildi.`,
              },
              ...(secondName
                ? [
                    {
                      type: 'ASSIGN' as const,
                      byId: actor.id,
                      at: now,
                      text: `Kayıt ayrıca ${secondName} ekibiyle paylaşıldı.`,
                    },
                  ]
                : []),
            ],
          },
        },
        include: withDetail,
      });

      // Gösterilen öneriler kaydedilir: kullanıcı yine de kayıt açtıysa
      // eşleşme işe yaramamış demektir. accepted=false bunu işaretler.
      if (body.shownSuggestions?.length) {
        const matches = await tx.record.findMany({
          where: { code: { in: body.shownSuggestions.map((s) => s.code) } },
          select: { id: true, code: true },
        });
        const byCode = new Map(matches.map((m) => [m.code, m.id]));
        await tx.suggestion.createMany({
          data: body.shownSuggestions.flatMap((s) => {
            const matchId = byCode.get(s.code);
            return matchId
              ? [{ sourceRecordId: rec.id, matchRecordId: matchId, score: s.score, accepted: false }]
              : [];
          }),
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'record.create',
          entity: 'Record',
          entityId: rec.id,
          after: toJsonText({ code: rec.code, department: body.department, priority: body.priority }),
          ip: req.ip,
        },
      });

      return rec;
    });

    app.log.info({ code: created.code, by: actor.id }, 'kayıt oluşturuldu');

    // İşlem bittikten SONRA ve ayrı veritabanına: yazılamazsa kayıt yine açılmış olur.
    if (body.mlInferenceId) {
      await recordOutcome(req.log, {
        inferenceId: body.mlInferenceId,
        userId: actor.id,
        recordCode: created.code,
        finalDepartmentId: body.department,
        suggestionApplied: body.deptSuggestionApplied,
        anonymous: body.anonymous,
      });
    }

    reply.code(201);
    return { record: await serializeRecord(created, actor) };
  });
}
