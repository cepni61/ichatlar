import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { actorOf, requireUser } from '../auth/guard.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * Yardım sonucuyla etkileşim (kayıt önleme günlüğü): bağlantıya tıklama,
 * "Bu çözüm işime yaradı" ve geri alınması. Yalnızca sonucu kendi
 * oturumunda olan kişi yazabilir.
 */
const body = z.object({ action: z.enum(['open', 'helpful', 'unhelpful']) });

export default async function helpRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.post('/api/help/results/:id', async (req, reply) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) throw badRequest('Geçersiz istek.');
    const { id } = req.params as { id: string };
    const actor = actorOf(req);

    const r = await prisma.helpResult.findUnique({
      where: { id },
      select: { openedAt: true, query: { select: { sessionId: true, session: { select: { userId: true } } } } },
    });
    if (!r || r.query.session.userId !== actor.id) throw notFound('Sonuç');

    const now = new Date();
    const action = parsed.data.action;
    const data =
      action === 'open' ? (r.openedAt ? null : { openedAt: now })
        : { helpfulAt: action === 'helpful' ? now : null };
    await prisma.$transaction([
      ...(data ? [prisma.helpResult.update({ where: { id }, data })] : []),
      prisma.helpSession.update({ where: { id: r.query.sessionId }, data: { lastActivityAt: now } }),
    ]);
    reply.code(204);
  });
}
