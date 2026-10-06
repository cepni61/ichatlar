import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { actorOf, requireUser } from '../auth/guard.js';
import { can } from '../domain/permissions.js';
import { badRequest } from '../lib/errors.js';

const LIMIT = 30;

const readBody = z.object({
  /** Boşsa kişinin tüm okunmamış bildirimleri okundu sayılır. */
  ids: z.array(z.string().min(1).max(64)).max(100).optional(),
});

/**
 * Üst çubuktaki zil. Bildirim kişiye özeldir; sorgu her zaman oturumdaki
 * kullanıcıyla süzülür, başkasının bildirimi ne listelenir ne okundu yapılır.
 */
export default async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/notifications', async (req) => {
    const actor = actorOf(req);

    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: actor.id },
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
        select: {
          id: true,
          type: true,
          text: true,
          createdAt: true,
          readAt: true,
          record: {
            select: {
              code: true,
              title: true,
              status: true,
              departmentId: true,
              department2Id: true,
              createdById: true,
              assigneeId: true,
              anonymous: true,
            },
          },
        },
      }),
      prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
    ]);

    // Bildirim yazıldıktan sonra kayıt başka ekibe yönlendirilmiş olabilir.
    // Kişi artık kaydı göremiyorsa başlığı da görmemeli: yalnızca kod kalır.
    const items = rows.map((n) => {
      const visible = n.record ? can('view', n.record, actor) : false;
      return {
        id: n.id,
        type: n.type,
        text: n.text,
        createdAt: n.createdAt,
        read: n.readAt != null,
        record: n.record
          ? { code: n.record.code, title: visible ? n.record.title : null, canOpen: visible }
          : null,
      };
    });

    return { unread, items };
  });

  app.post('/api/notifications/read', async (req) => {
    const actor = actorOf(req);
    const parsed = readBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);

    const { count } = await prisma.notification.updateMany({
      where: {
        userId: actor.id,
        readAt: null,
        ...(parsed.data.ids ? { id: { in: parsed.data.ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return { updated: count };
  });
}
