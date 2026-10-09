import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth/guard.js';
import { KB_KINDS } from '../domain/kb.js';
import { findSimilar, fold, tokenize } from '../domain/similarity.js';
import { badRequest } from '../lib/errors.js';
import { cortexSearch } from '../lib/cortex.js';

/**
 * Kaynak Bul: uygulama / süreç / bilgi araması — Bilgi Bankası (uygulama ve
 * süreç bağlantıları, hazır yanıtlar), çözülmüş kayıtlar ve (yapılandırılmışsa)
 * Cortex. Sorgu boşsa örnek sonuçlar döner. Kişi araması kullanıcı isteğiyle
 * kaldırıldı (2026-10-10).
 */
const query = z.object({ q: z.string().trim().max(120).default('') });

export default async function searchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/search/resources', async (req) => {
    const p = query.safeParse(req.query);
    if (!p.success) throw badRequest('Geçersiz arama.');
    const q = p.data.q;

    const kb = await prisma.kbArticle.findMany({
      where: { active: true },
      select: {
        seq: true, kind: true, title: true, keywords: true, answer: true, url: true,
        department: { select: { name: true } },
      },
    });
    const kbView = (a: (typeof kb)[number]) => ({
      source: 'kb' as const,
      kind: a.kind,
      kindLabel: KB_KINDS[a.kind as keyof typeof KB_KINDS] ?? a.kind,
      title: a.title,
      text: a.answer,
      url: a.url,
      department: a.department.name,
    });

    // Boş sorgu: örnek sonuçlar — önce uygulama / süreç bağlantıları.
    if (!q) {
      const order = { UYGULAMA: 0, SUREC: 1, BILGI: 2 } as Record<string, number>;
      const sample = [...kb].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3)).slice(0, 6);
      return { items: sample.map(kbView), sample: true, sources: { cortex: 'kapali' } };
    }

    const qTokens = new Set(tokenize(q));
    const fq = fold(q);
    const kbHits = kb
      .map((a) => {
        const head = tokenize(`${a.title} ${a.keywords ?? ''}`);
        const body = tokenize(a.answer);
        let score = 0;
        for (const t of new Set(head)) if (qTokens.has(t)) score += 2;
        for (const t of new Set(body)) if (qTokens.has(t)) score += 0.5;
        if (fold(a.title).includes(fq)) score += 3;
        return { a, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => kbView(x.a));

    const [similar, cortex] = await Promise.all([
      findSimilar({ title: q, description: '' }, 3),
      cortexSearch(q, req.log),
    ]);
    // Aynı soru farklı kişilerden gelmiş olabilir: başlık + çözüm aynıysa tek sonuç.
    const seen = new Set(kbHits.map((k) => fold(k.title)));
    const recordHits = similar
      .filter((m) => m.source === 'kayit')
      .filter((m) => {
        const key = fold(m.title) + '|' + fold(m.resolution);
        if (seen.has(key) || seen.has(fold(m.title))) return false;
        seen.add(key);
        return true;
      })
      .map((m) => ({
        source: 'kayit' as const,
        kind: 'KAYIT',
        kindLabel: 'Çözülmüş kayıt',
        title: m.title,
        text: m.resolution,
        url: null,
        department: m.departmentName,
      }));
    const cortexHits = cortex.items.map((c) => ({
      source: 'cortex' as const,
      kind: 'CORTEX',
      kindLabel: c.kind,
      title: c.title,
      text: c.text,
      url: c.url,
      department: null,
    }));

    return { items: [...kbHits, ...cortexHits, ...recordHits], sample: false, sources: { cortex: cortex.status } };
  });
}
