import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth/guard.js';
import { RecordStatus, RecordType } from '../domain/enums.js';
import { tokenize } from '../domain/similarity.js';
import { badRequest } from '../lib/errors.js';

/**
 * En sık sorulan talepler. Çözülmüş bilgi talepleri başlık benzerliğiyle
 * kümelenir (aynı soru farklı kişilerden gelmiş), her kümenin en güvenilir
 * çözümü gösterilir: Bilgi Bankası'nda karşılığı varsa o, yoksa "yenilenen
 * kayıt", sonra kapatılmış (çözümü açan onaylamış) ve en yeni çözüm.
 *
 * Kayıt gövdesi ve kimlik dönmez; yalnızca başlık, sayı, ekip ve çözüm —
 * benzer kayıt önerileriyle aynı paylaşım düzeyi.
 */
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / (a.size + b.size - hit);
};

interface Cluster {
  tokens: Set<string>;
  titles: Map<string, number>;
  count: number;
  departmentId: string;
  departmentName: string;
  best: { resolution: string; renewed: boolean; closed: boolean; at: number };
  lastAt: number;
}

export default async function faqRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/faq', async (req) => {
    const q = z.object({ department: z.string().max(64).optional() }).safeParse(req.query);
    if (!q.success) throw badRequest('Geçersiz filtre.');
    const dept = q.data.department;

    const [records, kb] = await Promise.all([
      prisma.record.findMany({
        where: {
          type: RecordType.BILGI,
          status: { in: [RecordStatus.COZULDU, RecordStatus.KAPATILDI] },
          resolution: { not: null },
          ...(dept ? { OR: [{ departmentId: dept }, { department2Id: dept }] } : {}),
        },
        orderBy: { resolvedAt: 'desc' },
        take: 2000,
        select: {
          title: true, resolution: true, status: true, renewed: true, resolvedAt: true,
          departmentId: true, department: { select: { name: true } },
        },
      }),
      prisma.kbArticle.findMany({
        // Her tür: süreç / uygulama maddesi bağlantısıyla en iyi SSS yanıtıdır.
        where: { active: true, ...(dept ? { departmentId: dept } : {}) },
        select: {
          id: true, seq: true, kind: true, title: true, keywords: true, answer: true, url: true,
          departmentId: true, department: { select: { name: true } },
        },
      }),
    ]);

    // Açgözlü kümeleme: başlık kökleri ≥ %50 örtüşen kayıtlar aynı soru.
    const clusters: Cluster[] = [];
    for (const r of records) {
      const tokens = new Set(tokenize(r.title));
      if (!tokens.size) continue;
      let home: Cluster | null = null;
      let bestSim = 0.5;
      for (const c of clusters) {
        const sim = jaccard(tokens, c.tokens);
        if (sim >= bestSim) { bestSim = sim; home = c; }
      }
      const at = r.resolvedAt?.getTime() ?? 0;
      const cand = { resolution: r.resolution!, renewed: r.renewed, closed: r.status === RecordStatus.KAPATILDI, at };
      if (!home) {
        clusters.push({
          tokens, titles: new Map([[r.title, 1]]), count: 1,
          departmentId: r.departmentId, departmentName: r.department.name, best: cand, lastAt: at,
        });
        continue;
      }
      home.count += 1;
      home.titles.set(r.title, (home.titles.get(r.title) ?? 0) + 1);
      home.lastAt = Math.max(home.lastAt, at);
      const rank = (x: Cluster['best']) => (x.renewed ? 2 : 0) + (x.closed ? 1 : 0);
      if (rank(cand) > rank(home.best)) home.best = cand;
    }

    // Yanıtın Bilgi Bankası maddesi — arayüzde "Yanıtı düzenle" bunu açar.
    const kbRef = (a: (typeof kb)[number]) => ({
      id: a.id, code: `BB-${a.seq}`, kind: a.kind, title: a.title, keywords: a.keywords,
      department: { id: a.departmentId, name: a.department.name },
    });

    // Bilgi Bankası karşılığı olan kümede hazır yanıt öne çıkar.
    const kbTokens = kb.map((a) => ({ a, tokens: new Set(tokenize(`${a.title} ${a.keywords ?? ''}`)) }));
    const usedKb = new Set<number>();

    const items = clusters
      .filter((c) => c.count >= 2)
      .sort((x, y) => y.count - x.count || y.lastAt - x.lastAt)
      .slice(0, 25)
      .map((c) => {
        const title = [...c.titles.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0]![0];
        // Eşleşme ölçütü: sorunun köklerinin ne kadarı maddede geçiyor (madde
        // başlığı + anahtar kelimeler). Jaccard uzun anahtar kelime listesini
        // cezalandırıyordu: "Şifre sıfırlama ve hesap kilidi" kendi maddesini
        // bulamıyordu. En az 2 ortak kök ve sorunun %60'ı.
        const match = kbTokens
          .map((k) => {
            let hit = 0;
            for (const t of c.tokens) if (k.tokens.has(t)) hit++;
            return { k, hit, cover: hit / c.tokens.size, sim: jaccard(c.tokens, k.tokens) };
          })
          .filter((x) => x.hit >= Math.min(2, c.tokens.size) && x.cover >= 0.6)
          .sort((x, y) => y.cover - x.cover || y.sim - x.sim)[0];
        if (match) usedKb.add(match.k.a.seq);
        return {
          title,
          count: c.count,
          department: { id: c.departmentId, name: c.departmentName },
          answer: match ? match.k.a.answer : c.best.resolution,
          source: match ? 'kb' : 'kayit',
          verified: Boolean(match) || c.best.renewed,
          url: match?.k.a.url ?? null,
          kb: match ? kbRef(match.k.a) : null,
          lastAt: c.lastAt ? new Date(c.lastAt).toISOString() : null,
        };
      });

    // Henüz sık sorulmamış ama ekibin hazırladığı yanıtlar.
    const ready = kb
      .filter((a) => !usedKb.has(a.seq))
      .map((a) => ({
        title: a.title,
        department: { id: a.departmentId, name: a.department.name },
        answer: a.answer,
        url: a.url,
        kb: kbRef(a),
      }));

    return { items, ready };
  });
}
