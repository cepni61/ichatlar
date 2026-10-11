import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { actorOf, requireRole } from '../auth/guard.js';
import { EventType, NotificationType, RecordStatus, Role } from '../domain/enums.js';
import { OPEN_STATUSES } from '../domain/constants.js';
import { activeGrant, GRANT_KINDS, GRANT_LABELS, GrantKind, ROLE_KINDS, roleRank, syncRole } from '../domain/grants.js';
import { isAssignableUnit, loadOrgTree } from '../domain/org.js';
import { isTeamRole } from '../domain/permissions.js';
import { fromJsonText, toJsonText } from '../lib/dialect.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * Yetkiler ekranının uçları (yalnızca sistem yöneticisi). Türler ve etkin rol
 * kuralı domain/grants.ts'de. Her değişiklik denetim izine yazılır (geçmiş
 * buradan okunur) ve kişiye bildirim gider. Kişinin kendi yetkisi buradan
 * değiştirilmez: sistem yöneticisiz kalınmasın.
 */
type Tx = Prisma.TransactionClient;

const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' });

/** "Departman sorumlusu (İnsan Kaynakları), 31.10.2026 tarihine kadar" */
function describe(kind: string, department: string | null, expiresAt: Date | null) {
  return GRANT_LABELS[kind as GrantKind] + (department ? ` (${department})` : '')
    + (expiresAt ? `, ${dayFmt.format(expiresAt)} tarihine kadar` : '');
}

async function record(
  tx: Tx,
  o: { actorId: string | null; action: string; userId: string; user: string; kind: string; department: string | null; expiresAt: Date | null; ip?: string; notice: string },
) {
  const detail = { userId: o.userId, user: o.user, kind: o.kind, label: GRANT_LABELS[o.kind as GrantKind], department: o.department, expiresAt: o.expiresAt };
  await tx.auditLog.create({
    data: { actorId: o.actorId, action: o.action, entity: 'Grant', entityId: o.userId, after: toJsonText(detail), ip: o.ip ?? null },
  });
  await tx.notification.create({ data: { userId: o.userId, type: NotificationType.ACCESS, text: o.notice } });
}

const grantBody = z.object({
  userId: z.string().min(1).max(64),
  kind: z.enum(GRANT_KINDS),
  /** DEPT_HEAD: departman; KB_EDITOR: ekip (boşsa kişinin ekibi). */
  departmentId: z.string().min(1).max(64).nullish(),
  /** YYYY-AA-GG: o günün sonuna kadar (Türkiye saati). Boşsa süresiz. */
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

const handoverBody = z.object({
  fromUserId: z.string().min(1).max(64),
  /** Boşsa bütün kayıtlar ekiplerinin havuzuna döner. */
  toUserId: z.string().min(1).max(64).nullish(),
  /** Kişiyi uygulamada kapat: oturumları düşer, yetkileri silinir. */
  deactivate: z.boolean().default(false),
});

export default async function grantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole(Role.ADMIN));

  app.get('/api/admin/grants', async () => {
    const [grants, directory] = await Promise.all([
      prisma.grant.findMany({
        where: { user: { active: true }, AND: [activeGrant()] },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, kind: true, createdAt: true, expiresAt: true,
          user: { select: { id: true, name: true, email: true, role: true, baseRole: true, departmentId: true } },
          department: { select: { id: true, name: true } },
          grantedBy: { select: { name: true } },
        },
      }),
      prisma.user.findMany({
        where: { active: true, baseRole: { in: [Role.MANAGER, Role.ADMIN] } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true, baseRole: true, departmentId: true },
      }),
    ]);
    return {
      grants: grants.map((g) => ({
        id: g.id, kind: g.kind, label: GRANT_LABELS[g.kind as GrantKind], createdAt: g.createdAt, expiresAt: g.expiresAt,
        user: g.user, department: g.department, grantedBy: g.grantedBy?.name ?? null,
        // Verilmiş ama şu an işlemeyen yetki: arayüz nedenini yazar.
        note:
          g.kind === GrantKind.MANAGER && !g.user.departmentId ? 'Ekibi olmadığı için işlemiyor'
          : ROLE_KINDS.includes(g.kind) && roleRank(g.user.baseRole) >= roleRank(g.kind) ? 'Kurumsal dizinden zaten bu yetkide'
          : null,
      })),
      directory,
      source: env.ldapConfigured ? 'AD' : env.entraConfigured ? 'Entra' : null,
    };
  });

  app.post('/api/admin/grants', async (req, reply) => {
    const actor = actorOf(req);
    const parsed = grantBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('Kişi ve yetki türü seçin.');
    const { userId, kind, until } = parsed.data;
    if (userId === actor.id) throw badRequest('Kendi yetkinizi değiştiremezsiniz; başka bir sistem yöneticisinden isteyin.');

    const user = await prisma.user.findFirst({
      where: { id: userId, active: true },
      select: { id: true, name: true, baseRole: true, departmentId: true },
    });
    if (!user) throw notFound('Kişi');

    const expiresAt = until ? new Date(`${until}T23:59:59+03:00`) : null;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
      throw badRequest('Bitiş tarihi bugün ya da sonrası olmalı.');
    }

    const tree = await loadOrgTree(prisma);
    let departmentId: string | null = null;
    if (kind === GrantKind.MANAGER || kind === GrantKind.ADMIN) {
      if (roleRank(kind) <= roleRank(user.baseRole)) throw badRequest('Kişi bu yetkiye kurumsal dizinden zaten sahip.');
      if (kind === GrantKind.MANAGER && !user.departmentId) {
        throw badRequest('Kişinin ekibi yok, ekip yöneticisi yapılamaz. Önce bir ekibe (AD grubuna) eklenmeli.');
      }
    } else if (kind === GrantKind.REPORTS) {
      if (roleRank(user.baseRole) >= roleRank(Role.MANAGER)) throw badRequest('Kişi raporları zaten görüyor.');
    } else if (kind === GrantKind.DEPT_HEAD) {
      departmentId = parsed.data.departmentId ?? null;
      const unit = departmentId ? tree.get(departmentId) : undefined;
      if (!unit || !unit.active || unit.parentId) throw badRequest('Departman seçin.');
    } else {
      departmentId = parsed.data.departmentId ?? user.departmentId;
      if (!departmentId || !isAssignableUnit(tree, departmentId)) throw badRequest('Ekip seçin; kişinin ekibi yok.');
      if (user.baseRole === Role.ADMIN || (user.baseRole === Role.MANAGER && user.departmentId === departmentId)) {
        throw badRequest('Kişi bu ekibin maddelerini zaten yönetiyor.');
      }
    }
    const dept = departmentId ? await prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } }) : null;

    const out = await prisma.$transaction(async (tx) => {
      // Aynı yetki varsa yenilenir (süre uzatma / süresize çevirme).
      const prev = await tx.grant.findFirst({ where: { userId, kind, departmentId }, select: { id: true } });
      const g = prev
        ? await tx.grant.update({ where: { id: prev.id }, data: { expiresAt, grantedById: actor.id }, select: { id: true } })
        : await tx.grant.create({ data: { userId, kind, departmentId, expiresAt, grantedById: actor.id }, select: { id: true } });
      const role = ROLE_KINDS.includes(kind) ? await syncRole(tx, userId) : null;
      await record(tx, {
        actorId: actor.id, action: prev ? 'grant.renew' : 'grant.add', userId, user: user.name, kind,
        department: dept?.name ?? null, expiresAt, ip: req.ip,
        notice: `Size ${describe(kind, dept?.name ?? null, expiresAt)} yetkisi verildi.`,
      });
      return { id: g.id, role, renewed: Boolean(prev) };
    });
    req.log.info({ by: actor.id, userId, kind, departmentId, expiresAt }, 'yetki verildi');
    return reply.code(out.renewed ? 200 : 201).send(out);
  });

  app.delete('/api/admin/grants/:id', async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const g = await prisma.grant.findUnique({
      where: { id },
      select: { id: true, userId: true, kind: true, expiresAt: true, user: { select: { name: true } }, department: { select: { name: true } } },
    });
    if (!g) throw notFound('Yetki');
    if (g.userId === actor.id) throw badRequest('Kendi yetkinizi değiştiremezsiniz; başka bir sistem yöneticisinden isteyin.');
    await prisma.$transaction(async (tx) => {
      await tx.grant.delete({ where: { id } });
      if (ROLE_KINDS.includes(g.kind)) await syncRole(tx, g.userId);
      await record(tx, {
        actorId: actor.id, action: 'grant.revoke', userId: g.userId, user: g.user.name, kind: g.kind,
        department: g.department?.name ?? null, expiresAt: g.expiresAt, ip: req.ip,
        notice: `${describe(g.kind, g.department?.name ?? null, null)} yetkiniz alındı.`,
      });
    });
    return { ok: true };
  });

  /** Yetki geçmişi: denetim izinden, en yeni 100 olay. */
  app.get('/api/admin/grants/history', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { OR: [{ action: { startsWith: 'grant.' } }, { action: { startsWith: 'handover' } }] },
      orderBy: { at: 'desc' },
      take: 100,
      select: { at: true, action: true, after: true, actor: { select: { name: true } } },
    });
    return { items: rows.map((r) => ({ at: r.at, action: r.action, actor: r.actor?.name ?? null, detail: fromJsonText(r.after) })) };
  });

  /* ------------------------------------------- ayrılan kişinin kayıtları */

  const openOf = (userId: string) =>
    prisma.record.findMany({
      where: { assigneeId: userId, status: { in: OPEN_STATUSES } },
      select: { id: true, code: true, departmentId: true, department2Id: true, department: { select: { name: true } } },
    });

  app.get('/api/admin/handover/:userId', async (req) => {
    const { userId } = req.params as { userId: string };
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, active: true } });
    if (!user) throw notFound('Kişi');
    const open = await openOf(userId);
    const byTeam = new Map<string, number>();
    for (const r of open) byTeam.set(r.department.name, (byTeam.get(r.department.name) ?? 0) + 1);
    return { user, open: open.length, teams: [...byTeam].map(([name, n]) => ({ name, n })) };
  });

  app.post('/api/admin/handover', async (req) => {
    const actor = actorOf(req);
    const parsed = handoverBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('Kişi seçin.');
    const { fromUserId, toUserId, deactivate } = parsed.data;
    if (fromUserId === actor.id) throw badRequest('Kendi kayıtlarınızı buradan devredemezsiniz.');
    if (toUserId && toUserId === fromUserId) throw badRequest('Kayıtlar aynı kişiye devredilemez.');

    const [from, to] = await Promise.all([
      prisma.user.findUnique({ where: { id: fromUserId }, select: { id: true, name: true } }),
      toUserId
        ? prisma.user.findFirst({ where: { id: toUserId, active: true }, select: { id: true, name: true, role: true, departmentId: true } })
        : null,
    ]);
    if (!from) throw notFound('Kişi');
    if (toUserId && (!to || !isTeamRole(to.role))) throw badRequest('Devralacak kişi bir ekipte çalışan, etkin bir kullanıcı olmalı.');

    const open = await openOf(fromUserId);
    let assigned = 0;
    let pooled = 0;
    await prisma.$transaction(async (tx) => {
      for (const r of open) {
        // Kayıt yalnızca kendi ekibindeki birine geçer; diğerleri ekibin havuzuna döner.
        const fits = to && (to.departmentId === r.departmentId || to.departmentId === r.department2Id);
        if (fits) {
          await tx.record.update({ where: { id: r.id }, data: { assigneeId: to.id } });
          await tx.recordEvent.create({
            data: {
              recordId: r.id, type: EventType.FORWARD, byId: actor.id,
              text: `Kayıt ${from.name} kişisinden ${to.name} kişisine devredildi (sistem yöneticisi).`,
              meta: { handover: true, from: from.id, to: to.id },
            },
          });
          await tx.notification.createMany({
            data: [{ userId: to.id, recordId: r.id, type: NotificationType.ASSIGNED, text: `${r.code} size devredildi.` }],
            skipDuplicates: true,
          });
          assigned++;
        } else {
          await tx.record.update({ where: { id: r.id }, data: { assigneeId: null, status: RecordStatus.YENI } });
          await tx.recordEvent.create({
            data: {
              recordId: r.id, type: EventType.FORWARD, byId: actor.id,
              text: `${from.name} kaydı bıraktığı için kayıt ${r.department.name} ekibinin havuzuna döndü (sistem yöneticisi).`,
              meta: { handover: true, from: from.id },
            },
          });
          pooled++;
        }
      }
      if (deactivate) {
        await tx.user.update({ where: { id: from.id }, data: { active: false } });
        await tx.session.updateMany({ where: { userId: from.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.grant.deleteMany({ where: { userId: from.id } });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id, action: deactivate ? 'handover.deactivate' : 'handover', entity: 'User', entityId: from.id,
          after: toJsonText({ userId: from.id, user: from.name, to: to?.name ?? null, assigned, pooled, deactivate }),
          ip: req.ip,
        },
      });
    });
    req.log.info({ by: actor.id, from: from.id, to: to?.id ?? null, assigned, pooled, deactivate }, 'kayıtlar devredildi');
    return { assigned, pooled, deactivated: deactivate };
  });
}

/**
 * Süresi dolan yetkileri siler, etkin rolü düzeltir, kişiye haber verir.
 * Rol dışı yetkiler süre dolunca zaten işlemez (oturum her istekte okur);
 * rol yetkisi etkin role yazıldığı için bu iş gecikmesi kadar sürer.
 */
export async function expireGrants(log: FastifyBaseLogger) {
  const due = await prisma.grant.findMany({
    where: { expiresAt: { lte: new Date() } },
    take: 200,
    select: { id: true, userId: true, kind: true, expiresAt: true, user: { select: { name: true } }, department: { select: { name: true } } },
  });
  for (const g of due) {
    await prisma.$transaction(async (tx) => {
      const gone = await tx.grant.deleteMany({ where: { id: g.id } });
      if (!gone.count) return; // başka bir süreç aldı
      if (ROLE_KINDS.includes(g.kind)) await syncRole(tx, g.userId);
      await record(tx, {
        actorId: null, action: 'grant.expire', userId: g.userId, user: g.user.name, kind: g.kind,
        department: g.department?.name ?? null, expiresAt: g.expiresAt,
        notice: `${describe(g.kind, g.department?.name ?? null, null)} yetkinizin süresi doldu.`,
      });
    });
  }
  if (due.length) log.info({ count: due.length }, 'süresi dolan yetkiler kaldırıldı');
  return due.length;
}
