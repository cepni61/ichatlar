import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { actorOf, requireRole } from '../auth/guard.js';
import { Role } from '../domain/enums.js';
import { effectiveRole, GRANTABLE } from '../domain/roles.js';
import { toJsonText } from '../lib/dialect.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * Yetkiler (yalnızca sistem yöneticisi): kişiye ekip yöneticisi ya da sistem
 * yöneticisi yetkisi verir, geri alır. Dizinden (AD grubu) gelen rol burada
 * değiştirilmez, BT grubu düzenler; verilen yetki onun üstüne eklenir
 * (src/domain/roles.ts). Rol her istekte veritabanından okunduğu için
 * değişiklik kişinin bir sonraki isteğinde geçerli olur. Her değişiklik
 * denetim izine yazılır.
 */
const RANK: Record<string, number> = { USER: 0, TEAM_MEMBER: 1, MANAGER: 2, ADMIN: 3 };

const select = {
  id: true, name: true, email: true, role: true, baseRole: true, roleGrant: true, roleGrantAt: true,
  departmentId: true, roleGrantBy: { select: { name: true } },
} as const;

type Row = { roleGrantBy: { name: string } | null } & Record<string, unknown>;
const view = ({ roleGrantBy, ...u }: Row) => ({ ...u, grantedBy: roleGrantBy?.name ?? null });

export default async function roleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole(Role.ADMIN));

  /** Yetkili kişiler: etkin rolü ekip yöneticisi / sistem yöneticisi olanlar ve yetki verilmişler. */
  app.get('/api/admin/roles', async () => {
    const rows = await prisma.user.findMany({
      where: { active: true, OR: [{ role: { in: [Role.MANAGER, Role.ADMIN] } }, { roleGrant: { not: null } }] },
      orderBy: { name: 'asc' },
      select,
    });
    return {
      items: rows.map(view),
      /** Rolün dizin kaynağı: arayüz "AD grubundan" gibi yazar. */
      directory: env.ldapConfigured ? 'AD' : env.entraConfigured ? 'Entra' : null,
    };
  });

  app.put('/api/admin/roles/:userId', async (req) => {
    const actor = actorOf(req);
    const { userId } = req.params as { userId: string };
    const body = z.object({ role: z.enum(GRANTABLE).nullable() }).safeParse(req.body);
    if (!body.success) throw badRequest('Geçersiz yetki.');
    // Kendini düşürüp sistemi yöneticisiz bırakmasın; yetkiyi işlem yapan da tutar.
    if (userId === actor.id) throw badRequest('Kendi yetkinizi değiştiremezsiniz; başka bir sistem yöneticisinden isteyin.');

    const user = await prisma.user.findFirst({
      where: { id: userId, active: true },
      select: { id: true, role: true, baseRole: true, roleGrant: true, departmentId: true },
    });
    if (!user) throw notFound('Kişi');
    const grant = body.data.role;
    if (grant === null && !user.roleGrant) throw badRequest('Bu kişiye uygulamada verilmiş bir yetki yok; rolü kurumsal dizinden geliyor.');
    if (grant && RANK[grant]! <= RANK[user.baseRole]!) throw badRequest('Kişi bu yetkiye kurumsal dizinden zaten sahip.');
    if (grant === Role.MANAGER && !user.departmentId) {
      throw badRequest('Kişinin ekibi yok, ekip yöneticisi yapılamaz. Önce bir ekibe (AD grubuna) eklenmeli.');
    }

    const role = effectiveRole(user.baseRole, grant, user.departmentId);
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: user.id },
        data: {
          roleGrant: grant,
          roleGrantAt: grant ? new Date() : null,
          roleGrantById: grant ? actor.id : null,
          role,
        },
        select,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: grant ? 'role.grant' : 'role.revoke',
          entity: 'User',
          entityId: user.id,
          before: toJsonText({ role: user.role, roleGrant: user.roleGrant }),
          after: toJsonText({ role, roleGrant: grant }),
          ip: req.ip,
        },
      });
      return u;
    });
    req.log.info({ by: actor.id, userId: user.id, grant, role }, 'yetki değişti');
    return { user: view(updated) };
  });
}
