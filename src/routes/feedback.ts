import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { actorOf, requireRole, requireUser } from '../auth/guard.js';
import { NotificationType, Role } from '../domain/enums.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * Uygulama geri bildirimi: kenar çubuğundaki "Uygulama için geri bildirim"
 * kutusundan serbest metin. Feedback tablosuna yazılır, sistem yöneticilerine
 * zil bildirimi düşer; Yönetim ekranında listelenir.
 *
 * KVKK: metin serbest olduğu için kişisel veri içerebilir; yalnızca sistem
 * yöneticisi okur, gönderen kişi kayıtla ilişkilendirilir.
 */
export default async function feedbackRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.post('/api/feedback', async (req, reply) => {
    const actor = actorOf(req);
    const parsed = z
      .object({
        text: z.string().trim().min(5, 'Geri bildiriminizi en az 5 karakter yazın.').max(2000),
        page: z.string().trim().max(40).nullish(),
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);
    const { text, page } = parsed.data;

    const admins = await prisma.user.findMany({
      where: { role: Role.ADMIN, active: true },
      select: { id: true },
    });
    const snippet = text.length > 80 ? text.slice(0, 80) + '…' : text;

    const row = await prisma.$transaction(async (tx) => {
      const fb = await tx.feedback.create({
        data: { userId: actor.id, text, page: page || null },
        select: { id: true },
      });
      // Kayda bağlı olmayan bildirim: kayıt kimliği boş, her geri bildirim ayrı satır.
      if (admins.length) {
        await tx.notification.createMany({
          data: admins
            .filter((a) => a.id !== actor.id)
            .map((a) => ({
              userId: a.id,
              recordId: null,
              type: NotificationType.FEEDBACK,
              text: `Uygulama geri bildirimi (${req.user!.name}): “${snippet}”`,
            })),
        });
      }
      return fb;
    });
    return reply.code(201).send({ id: row.id });
  });

  app.get('/api/feedback', { preHandler: requireRole(Role.ADMIN) }, async () => {
    const [rows, unread] = await Promise.all([
      prisma.feedback.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true, text: true, page: true, createdAt: true, readAt: true,
          user: { select: { name: true, department: { select: { name: true } } } },
        },
      }),
      prisma.feedback.count({ where: { readAt: null } }),
    ]);
    return {
      unread,
      items: rows.map((r) => ({
        id: r.id,
        text: r.text,
        page: r.page,
        createdAt: r.createdAt,
        read: r.readAt != null,
        user: r.user ? { name: r.user.name, department: r.user.department?.name ?? null } : null,
      })),
    };
  });

  app.post('/api/feedback/:id/read', { preHandler: requireRole(Role.ADMIN) }, async (req) => {
    const { id } = req.params as { id: string };
    const { count } = await prisma.feedback.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
    if (!count && !(await prisma.feedback.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Geri bildirim');
    return { ok: true };
  });
}
