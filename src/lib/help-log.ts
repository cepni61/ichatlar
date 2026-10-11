import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { HelpChannel, HelpKind, HelpSource, sessionUsable, shouldMerge } from '../domain/help.js';

/**
 * Kayıt önleme günlüğünün yazımı (docs/RAPOR.md). Günlük yardımın kendisini
 * bozmaz: yazılamazsa uyarı düşülür, çağıran sonuçları yine döner.
 */

type Db = Prisma.TransactionClient | PrismaClient;

export interface HelpHit {
  source: HelpSource;
  /** KAYIT: kayıt kodu; BILGI_BANKASI: "BB-<seq>". */
  code?: string | null;
  url?: string | null;
  title?: string | null;
  similarity?: number | null;
}

export interface HelpQueryInput {
  userId: string;
  sessionId?: string | null;
  channel: HelpChannel;
  kind: HelpKind;
  title?: string | null;
  text?: string | null;
  recordType?: 'BILGI' | 'ONERI' | null;
  selectedTeamId?: string | null;
  predictedTeamId?: string | null;
  confidence?: number | null;
  lowConfidence?: boolean | null;
  durationMs?: number | null;
  mlInferenceId?: string | null;
  hits: HelpHit[];
}

/** Gelen oturum sürdürülebilirse onu, değilse yeni bir oturumun kimliğini döner. */
export async function openSession(
  db: Db, userId: string, sessionId: string | null, channel: HelpChannel, now: Date, purpose: 'query' | 'link',
): Promise<string> {
  if (sessionId) {
    const s = await db.helpSession.findUnique({
      where: { id: sessionId }, select: { userId: true, recordId: true, lastActivityAt: true },
    });
    if (sessionUsable(s, userId, now, purpose)) return sessionId;
  }
  const created = await db.helpSession.create({
    data: { userId, channel, startedAt: now, lastActivityAt: now }, select: { id: true },
  });
  return created.id;
}

/** Sonuçların hedef kolonları (kayıt / madde kimliği ya da dış bağlantı), hits ile aynı sırada. */
async function resolveTargets(db: Db, hits: HelpHit[]) {
  const codes = hits.filter((h) => h.source === HelpSource.KAYIT && h.code).map((h) => h.code!);
  const seqs = hits
    .filter((h) => h.source === HelpSource.BILGI_BANKASI && h.code)
    .map((h) => Number(h.code!.replace(/^BB-/, '')))
    .filter(Number.isInteger);
  const recs = codes.length ? await db.record.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } }) : [];
  const kbs = seqs.length ? await db.kbArticle.findMany({ where: { seq: { in: seqs } }, select: { id: true, seq: true } }) : [];
  const recId = new Map(recs.map((r) => [r.code, r.id]));
  const kbId = new Map(kbs.map((k) => [`BB-${k.seq}`, k.id]));
  return hits.map((h) => ({
    recordId: h.source === HelpSource.KAYIT ? recId.get(h.code ?? '') ?? null : null,
    kbArticleId: h.source === HelpSource.BILGI_BANKASI ? kbId.get(h.code ?? '') ?? null : null,
    externalUrl: h.source === HelpSource.CORTEX ? h.url ?? null : null,
    externalTitle: h.source === HelpSource.CORTEX ? h.title ?? null : null,
  }));
}

export async function logHelpQuery(
  log: FastifyBaseLogger, q: HelpQueryInput,
): Promise<{ sessionId: string; resultIds: string[] } | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      const sessionId = await openSession(tx, q.userId, q.sessionId ?? null, q.channel, now, 'query');

      // Formdan gelen ekip kimliği doğrulanmamış girdi: yoksa boş yazılır (FK).
      const teamIds = [q.selectedTeamId, q.predictedTeamId].filter((x): x is string => Boolean(x));
      const known = new Set(
        teamIds.length
          ? (await tx.department.findMany({ where: { id: { in: teamIds } }, select: { id: true } })).map((d) => d.id)
          : [],
      );

      const prev = await tx.helpQuery.findFirst({
        where: { sessionId },
        orderBy: { at: 'desc' },
        select: {
          id: true, kind: true, text: true, at: true,
          results: { where: { OR: [{ openedAt: { not: null } }, { helpfulAt: { not: null } }] }, select: { id: true }, take: 1 },
        },
      });
      const merge = shouldMerge(
        prev && { kind: prev.kind, text: prev.text, at: prev.at, touched: prev.results.length > 0 },
        { kind: q.kind, text: q.text ?? null },
        now,
      );

      const data = {
        at: now,
        kind: q.kind,
        title: q.title ?? null,
        text: q.text ?? null,
        recordType: q.recordType ?? null,
        selectedTeamId: q.selectedTeamId && known.has(q.selectedTeamId) ? q.selectedTeamId : null,
        predictedTeamId: q.predictedTeamId && known.has(q.predictedTeamId) ? q.predictedTeamId : null,
        confidence: q.confidence ?? null,
        lowConfidence: q.lowConfidence ?? null,
        resultCount: q.hits.length,
        durationMs: q.durationMs == null ? null : Math.round(q.durationMs),
        mlInferenceId: q.mlInferenceId ?? null,
      };

      let queryId: string;
      if (merge && prev) {
        await tx.helpResult.deleteMany({ where: { queryId: prev.id } });
        await tx.helpQuery.update({ where: { id: prev.id }, data });
        queryId = prev.id;
      } else {
        queryId = (await tx.helpQuery.create({ data: { ...data, sessionId }, select: { id: true } })).id;
      }

      const targets = await resolveTargets(tx, q.hits);
      const resultIds: string[] = [];
      for (const [i, h] of q.hits.entries()) {
        const r = await tx.helpResult.create({
          data: { queryId, rank: i + 1, source: h.source, ...targets[i]!, similarity: h.similarity ?? null },
          select: { id: true },
        });
        resultIds.push(r.id);
      }
      await tx.helpSession.update({ where: { id: sessionId }, data: { lastActivityAt: now } });
      return { sessionId, resultIds };
    });
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'yardım günlüğü yazılamadı');
    return null;
  }
}
