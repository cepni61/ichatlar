import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth/guard.js';
import { Role } from '../domain/enums.js';
import { KB_KINDS } from '../domain/kb.js';
import { findSimilar, fold, tokenize } from '../domain/similarity.js';
import { badRequest } from '../lib/errors.js';
import { cortexSearch } from '../lib/cortex.js';
import { suggestDepartment } from '../ml/service.js';

/**
 * Arama sekmesi: iki ayrı arama.
 *
 *  Kişi araması — ad, unvan ve ekip eşleşmesine ek olarak ML: sorgunun hangi
 *  ekibin işi olduğu (departman modeli) ve benzer kayıtları kimin çözdüğü.
 *  "bordro" yazan kişi adında bordro geçmese de İK'da bordro kayıtlarını
 *  çözen kişiyi bulur.
 *
 *  Uygulama / Süreç / Bilgi araması — Bilgi Bankası (uygulama ve süreç
 *  bağlantıları, hazır yanıtlar), çözülmüş kayıtlar ve (yapılandırılmışsa)
 *  Cortex. Sorgu boşsa örnek sonuçlar döner.
 */
const query = z.object({ q: z.string().trim().max(120).default('') });

export default async function searchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/search/people', async (req) => {
    const p = query.safeParse(req.query);
    if (!p.success) throw badRequest('Geçersiz arama.');
    const q = p.data.q;

    const users = await prisma.user.findMany({
      where: { active: true, departmentId: { not: null } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, title: true, email: true, role: true, department: { select: { id: true, name: true } } },
    });
    const view = (u: (typeof users)[number], reason: string | null) => ({
      id: u.id, name: u.name, title: u.title, email: u.email,
      department: u.department, reason,
    });

    // Boş sorgu: örnek kişiler — önce yöneticiler, her ekipten biri.
    if (!q) {
      const seen = new Set<string>();
      const sample = [...users]
        .sort((a, b) => Number(b.role === Role.MANAGER) - Number(a.role === Role.MANAGER))
        .filter((u) => (seen.has(u.department!.id) ? false : (seen.add(u.department!.id), true)))
        .slice(0, 8);
      return { items: sample.map((u) => view(u, null)), sample: true };
    }

    const fq = fold(q);
    const qTokens = new Set(tokenize(q));

    // ML 1: sorgu hangi ekibin işi?
    const sug = suggestDepartment(q, '');
    const prob = new Map<string, number>();
    if (sug && !sug.lowConfidence) for (const c of sug.candidates) prob.set(c.departmentId, c.probability);

    // ML 2: benzer kayıtları kim çözdü?
    const similar = (await findSimilar({ title: q, description: '' }, 10)).filter((m) => m.source === 'kayit');
    const solvers = new Map<string, number>();
    if (similar.length) {
      const recs = await prisma.record.findMany({
        where: { code: { in: similar.map((m) => m.code) }, assigneeId: { not: null } },
        select: { assigneeId: true },
      });
      for (const r of recs) solvers.set(r.assigneeId!, (solvers.get(r.assigneeId!) ?? 0) + 1);
    }

    const scored = users.map((u) => {
      let score = 0;
      const why: string[] = [];
      const name = fold(u.name);
      if (name.includes(fq)) { score += 6; why.push('Ad eşleşmesi'); }
      else if (fq.split(' ').some((w) => w.length >= 2 && name.split(' ').some((n) => n.startsWith(w)))) { score += 3; why.push('Ad eşleşmesi'); }

      const titleHits = u.title ? tokenize(u.title).filter((t) => qTokens.has(t)).length : 0;
      if (titleHits) { score += 2 * titleHits; why.push('Unvan: ' + u.title); }

      const deptHits = tokenize(u.department!.name).filter((t) => qTokens.has(t)).length;
      if (deptHits) { score += 1.5; why.push(u.department!.name + ' ekibi'); }

      const pr = prob.get(u.department!.id) ?? 0;
      if (pr >= 0.2) { score += 3 * pr; if (!deptHits) why.push(`Konu ${u.department!.name} ekibinin işi (%${Math.round(pr * 100)})`); }

      const solved = solvers.get(u.id) ?? 0;
      if (solved) { score += 1.5 * solved; why.push(`Benzer ${solved} kaydı çözdü`); }

      if (score > 0 && u.role === Role.MANAGER) score += 0.2; // eşitlikte ekip yöneticisi önce
      return { u, score, why };
    });

    const items = scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.u.name.localeCompare(b.u.name, 'tr'))
      .slice(0, 8)
      .map((x) => view(x.u, x.why.slice(0, 2).join(' · ') || null));
    return { items, sample: false };
  });

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
    const recordHits = similar
      .filter((m) => m.source === 'kayit')
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
