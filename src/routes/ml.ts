import type { FastifyInstance } from 'fastify';
import { Role } from '../domain/enums.js';
import { requireRole } from '../auth/guard.js';
import { ensureModel, mlStats } from '../ml/service.js';

export default async function mlRoutes(app: FastifyInstance) {
  /**
   * Modelin durumu: hangi sürüm etkin, eğitim isabeti (birini-dışarıda-bırak)
   * ve sahadaki gerçek isabet (önerilen ekip ↔ yönlendirmeyle doğrulanmış ekip).
   */
  app.get('/api/ml/stats', { preHandler: requireRole(Role.MANAGER, Role.ADMIN) }, async () => mlStats());

  /** Veri değişmemiş olsa bile modeli yeniden eğitir ve yeni sürüm yazar. */
  app.post('/api/ml/train', { preHandler: requireRole(Role.ADMIN) }, async (req) => {
    await ensureModel(req.log, { force: true });
    return mlStats();
  });
}
