import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { EventType, RecordStatus } from '../domain/enums.js';
import { fromJsonText } from '../lib/dialect.js';
import { mlDb } from './db.js';
import {
  DEFAULT_PARAMS,
  FEATURE_VERSION,
  evaluate,
  featurize,
  predict,
  train,
  type Doc,
  type Model,
  type Params,
  type Prediction,
} from './classifier.js';

/**
 * ML servisi: departman modelini eğitir, ML veritabanına yazar ve her
 * kontrol çağrısını, önerileri ve sonuçlarını ayrı tablolarda kayda geçirir.
 *
 * Ana kural: ML veritabanı yardımcıdır. Yazma hatası ana iş akışını (kayıt
 * açma, yönlendirme) asla bozmaz — günlüğe uyarı düşer, akış devam eder.
 */

const ALGORITHM = 'multinomial-nb';
/** Karşılaştırma için saklanan eski model sürümü sayısı. */
const KEEP_VERSIONS = 10;

/**
 * Etiketi güvenilir kayıtlar eğitime girer:
 *  - YENI hariç: ekibin henüz görmediği kayıtta seçilen ekip doğrulanmamıştır;
 *    birkaç dakika sonra başka ekibe yönlendirilebilir. Ekipten biri üzerine
 *    aldığında etiket doğrulanmış sayılır.
 *  - REDDEDILDI hariç: "yanlış ekip" mi "yapılamaz" mı belli değil.
 */
const EXCLUDED_FROM_TRAINING = [RecordStatus.YENI, RecordStatus.REDDEDILDI];

interface ActiveModel {
  id: string | null;
  model: Model;
  fingerprint: string;
  accuracy: number | null;
  top3: number | null;
  trainedAt: Date;
}

let active: ActiveModel | null = null;
let training: Promise<ActiveModel | null> | null = null;

// ─────────────────────────────────────────────────────────────── eğitim

async function loadTrainingData(params: Params) {
  const [departments, records] = await Promise.all([
    prisma.department.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { order: 'asc' },
    }),
    prisma.record.findMany({
      where: { status: { notIn: EXCLUDED_FROM_TRAINING } },
      select: {
        code: true,
        title: true,
        description: true,
        departmentId: true,
        events: { where: { type: EventType.FORWARD }, select: { meta: true } },
      },
      orderBy: { code: 'asc' },
    }),
  ]);

  const activeIds = new Set(departments.map((d) => d.id));
  const docs: Doc[] = records
    .filter((r) => activeIds.has(r.departmentId))
    .map((r) => ({
      code: r.code,
      departmentId: r.departmentId,
      features: featurize(r.title, r.description, params),
      corrected: r.events.some(
        (e) => fromJsonText<{ departmentId?: string | null }>(e.meta)?.departmentId,
      ),
    }));

  // Parmak izi yalnızca eğitimi etkileyen alanlardan: durum değişikliği gibi
  // alakasız güncellemeler her seferinde yeni sürüm üretmesin.
  const h = createHash('sha256');
  h.update(`f${FEATURE_VERSION}|${JSON.stringify(params)}`);
  h.update(departments.map((d) => d.id).join(','));
  for (const r of records) {
    if (activeIds.has(r.departmentId)) h.update(`\n${r.code}|${r.departmentId}|${r.title}|${r.description}`);
  }

  return { departments, docs, fingerprint: h.digest('hex').slice(0, 32) };
}

/** ML veritabanındaki etkin sürümü belleğe geri kurar — açılışta yeniden eğitmeden. */
async function restore(fingerprint: string): Promise<ActiveModel | null> {
  const ml = mlDb();
  if (!ml) return null;
  const v = await ml.modelVersion.findFirst({
    where: { active: true, dataFingerprint: fingerprint, algorithm: ALGORITHM },
    include: { priors: true, terms: true },
  });
  if (!v) return null;

  // params sütunu model parametrelerinin yanında ölçümleri de taşır; ayır.
  type Stored = Partial<Params> & { top3?: number; perDepartment?: unknown };
  const { top3: storedTop3, perDepartment: _per, ...storedParams } = fromJsonText<Stored>(v.params) ?? {};
  const params: Params = { ...DEFAULT_PARAMS, ...storedParams };
  const counts = new Map<string, Map<string, number>>();
  for (const t of v.terms) {
    let row = counts.get(t.term);
    if (!row) counts.set(t.term, (row = new Map()));
    row.set(t.departmentId, t.count);
  }
  const departments = v.priors.map((p) => ({
    id: p.departmentId,
    name: p.departmentName,
    docCount: p.docCount,
    tokenCount: p.tokenCount,
  }));
  return {
    id: v.id,
    fingerprint,
    accuracy: v.accuracy,
    top3: storedTop3 ?? null,
    trainedAt: v.trainedAt,
    model: {
      params,
      departments,
      counts,
      totalDocs: departments.reduce((a, d) => a + d.docCount, 0),
      vocabSize: counts.size,
    },
  };
}

async function persist(
  model: Model,
  docs: Doc[],
  fingerprint: string,
  ev: ReturnType<typeof evaluate>,
): Promise<string | null> {
  const ml = mlDb();
  if (!ml) return null;

  const id = await ml.$transaction(
    async (tx) => {
      await tx.modelVersion.updateMany({ where: { active: true }, data: { active: false } });

      const v = await tx.modelVersion.create({
        data: {
          algorithm: ALGORITHM,
          docCount: model.totalDocs,
          vocabSize: model.vocabSize,
          accuracy: ev.accuracy,
          params: JSON.stringify({ ...model.params, top3: ev.top3, perDepartment: ev.perDepartment }),
          dataFingerprint: fingerprint,
          active: true,
        },
        select: { id: true },
      });

      await tx.departmentPrior.createMany({
        data: model.departments.map((d) => ({
          modelId: v.id,
          departmentId: d.id,
          departmentName: d.name,
          docCount: d.docCount,
          tokenCount: d.tokenCount,
        })),
      });

      const terms: { modelId: string; term: string; departmentId: string; count: number }[] = [];
      for (const [term, row] of model.counts) {
        for (const [departmentId, count] of row) terms.push({ modelId: v.id, term, departmentId, count });
      }
      await tx.termWeight.createMany({ data: terms });

      await tx.trainingSample.createMany({
        data: docs.map((d) => ({
          modelId: v.id,
          recordCode: d.code,
          departmentId: d.departmentId,
          corrected: d.corrected,
          looPredicted: ev.predicted.get(d.code) ?? null,
        })),
      });

      return v.id;
    },
    { timeout: 30_000 },
  );

  // Eski sürümleri buda; bunlara bağlı Inference satırları modelId=null ile kalır.
  const old = await ml.modelVersion.findMany({
    where: { active: false },
    orderBy: { trainedAt: 'desc' },
    skip: KEEP_VERSIONS - 1,
    select: { id: true },
  });
  if (old.length) await ml.modelVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });

  return id;
}

/**
 * Model güncel değilse eğitir. Veri değişmediyse hiçbir şey yapmaz; açılışta
 * ML veritabanındaki etkin sürümü yükler. Aynı anda iki eğitim başlamaz.
 */
export async function ensureModel(log: FastifyBaseLogger, opts: { force?: boolean } = {}) {
  if (training) return training;

  training = (async () => {
    const t0 = performance.now();
    const params = { ...DEFAULT_PARAMS };
    const { departments, docs, fingerprint } = await loadTrainingData(params);

    if (!opts.force && active?.fingerprint === fingerprint) return active;

    if (!opts.force) {
      const restored = await restore(fingerprint).catch(() => null);
      if (restored) {
        log.info({ modelId: restored.id, docs: restored.model.totalDocs }, 'ML modeli veritabanından yüklendi');
        return (active = restored);
      }
    }

    if (docs.length === 0) {
      log.warn('ML: eğitilecek kayıt yok (YENİ ve REDDEDİLDİ dışında kayıt gerekiyor).');
      return (active = null);
    }

    // İlk geçiş: sıcaklığı ölçmek için; ikinci geçiş gerek yok, yalnızca parametre değişiyor.
    const model = train(docs, departments, params);
    const ev = evaluate(model, docs);
    model.params.temperature = ev.temperature;

    let id: string | null = null;
    try {
      id = await persist(model, docs, fingerprint, ev);
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'ML modeli veritabanına yazılamadı; bellekteki model kullanılıyor');
    }

    log.info(
      {
        modelId: id,
        docs: model.totalDocs,
        vocab: model.vocabSize,
        accuracy: Math.round(ev.accuracy * 1000) / 10,
        top3: Math.round(ev.top3 * 1000) / 10,
        temperature: ev.temperature,
        ms: Math.round(performance.now() - t0),
      },
      'ML departman modeli eğitildi',
    );

    return (active = { id, model, fingerprint, accuracy: ev.accuracy, top3: ev.top3, trainedAt: new Date() });
  })().finally(() => {
    training = null;
  });

  return training;
}

/** Zamanlanmış yeniden eğitim — veri değişmediyse maliyeti bir sorgu. */
export function startMlJobs(log: FastifyBaseLogger) {
  const timer = setInterval(
    () => {
      ensureModel(log).catch((err) => log.error({ err }, 'ML yeniden eğitimi hata verdi'));
    },
    env.ML_RETRAIN_MINUTES * 60 * 1000,
  );
  return () => clearInterval(timer);
}

// ─────────────────────────────────────────────────────────────── tahmin

export interface DepartmentSuggestion {
  modelId: string | null;
  knownTerms: number;
  lowConfidence: boolean;
  /** İlk 3 ekip, olasılığa göre azalan. */
  candidates: Prediction[];
  /** Tüm ekipler — ML veritabanına yazılır. */
  all: Prediction[];
}

export function suggestDepartment(title: string, description: string): DepartmentSuggestion | null {
  if (!active) return null;
  const f = featurize(title, description, active.model.params);
  const r = predict(active.model, f);
  return {
    modelId: active.id,
    knownTerms: r.knownTerms,
    lowConfidence: r.lowConfidence,
    candidates: r.ranked.slice(0, 3),
    all: r.ranked,
  };
}

// ─────────────────────────────────────────────────────────── kayıt tutma

interface MatchLog {
  code: string;
  title: string;
  departmentId: string;
  percent: number;
  terms: string[];
}

/** Her "ML ile Kontrol Et" çağrısını, ekip önerilerini ve eşleşmeleri yazar. */
export async function logInference(
  log: FastifyBaseLogger,
  input: {
    userId: string;
    title: string;
    description: string;
    type: string | null;
    selectedDepartmentId: string | null;
    durationMs: number;
    suggestion: DepartmentSuggestion | null;
    matches: MatchLog[];
  },
): Promise<string | null> {
  const ml = mlDb();
  if (!ml) return null;

  const s = input.suggestion;
  const top = s?.all[0];
  try {
    const row = await ml.inference.create({
      data: {
        userId: input.userId,
        modelId: s?.modelId ?? null,
        title: input.title,
        description: input.description,
        type: input.type,
        selectedDepartmentId: input.selectedDepartmentId,
        knownTerms: s?.knownTerms ?? 0,
        durationMs: Math.round(input.durationMs),
        predictedDepartmentId: top?.departmentId ?? null,
        confidence: top?.probability ?? null,
        lowConfidence: s?.lowConfidence ?? true,
        predictions: {
          create: (s?.all ?? []).map((p, i) => ({
            rank: i + 1,
            departmentId: p.departmentId,
            departmentName: p.departmentName,
            probability: p.probability,
            terms: JSON.stringify(p.terms),
          })),
        },
        matches: {
          create: input.matches.map((m, i) => ({
            rank: i + 1,
            recordCode: m.code,
            recordTitle: m.title,
            departmentId: m.departmentId,
            percent: m.percent,
            terms: JSON.stringify(m.terms),
          })),
        },
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'ML çalıştırma kaydı yazılamadı');
    return null;
  }
}

/**
 * Kayıt açıldığında sonucu bağlar. Kayıt anonimse çalıştırmadaki kullanıcı
 * kimliği silinir: ML veritabanı başka ekiplerce okunabilir ve Outcome →
 * Inference bağı anonim kaydı açanı ortaya çıkarmamalı.
 */
export async function recordOutcome(
  log: FastifyBaseLogger,
  input: {
    inferenceId: string;
    userId: string;
    recordCode: string;
    finalDepartmentId: string;
    suggestionApplied: boolean;
    anonymous: boolean;
  },
) {
  const ml = mlDb();
  if (!ml) return;
  try {
    const inf = await ml.inference.findUnique({
      where: { id: input.inferenceId },
      select: { userId: true, predictedDepartmentId: true, outcome: { select: { id: true } } },
    });
    // Başkasının çalıştırmasına sonuç yazılamaz; ikinci kez de yazılmaz.
    if (!inf || inf.userId !== input.userId || inf.outcome) return;

    await ml.$transaction([
      ml.outcome.create({
        data: {
          inferenceId: input.inferenceId,
          recordCode: input.recordCode,
          finalDepartmentId: input.finalDepartmentId,
          suggestionApplied: input.suggestionApplied,
          matchedPrediction: inf.predictedDepartmentId === input.finalDepartmentId,
        },
      }),
      ...(input.anonymous
        ? [ml.inference.update({ where: { id: input.inferenceId }, data: { userId: null } })]
        : []),
    ]);
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'ML sonuç kaydı yazılamadı');
  }
}

/** Kayıt başka ekibe yönlendirildi: modelin (ve kullanıcının) hatası kayda geçer. */
export async function recordForward(log: FastifyBaseLogger, recordCode: string, departmentId: string) {
  const ml = mlDb();
  if (!ml) return;
  try {
    await ml.outcome.updateMany({
      where: { recordCode },
      data: { forwardedToDepartmentId: departmentId, forwardedAt: new Date() },
    });
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'ML yönlendirme kaydı yazılamadı');
  }
}

// ─────────────────────────────────────────────────────────────── özet

/** Yönetici için: modelin durumu ve sahadaki gerçek isabeti. */
export async function mlStats() {
  const ml = mlDb();
  const model = active
    ? {
        id: active.id,
        trainedAt: active.trainedAt,
        docCount: active.model.totalDocs,
        vocabSize: active.model.vocabSize,
        looAccuracy: active.accuracy,
        looTop3: active.top3,
        temperature: active.model.params.temperature,
        departments: active.model.departments.map((d) => ({ id: d.id, name: d.name, docCount: d.docCount })),
      }
    : null;

  if (!ml) return { database: false, model, usage: null };

  const [versions, inferences, outcomes] = await Promise.all([
    ml.modelVersion.count(),
    ml.inference.count(),
    ml.outcome.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        suggestionApplied: true,
        matchedPrediction: true,
        finalDepartmentId: true,
        forwardedToDepartmentId: true,
        inference: { select: { predictedDepartmentId: true, lowConfidence: true } },
      },
    }),
  ]);

  const withPrediction = outcomes.filter((o) => o.inference.predictedDepartmentId);
  const correct = withPrediction.filter(
    (o) => (o.forwardedToDepartmentId ?? o.finalDepartmentId) === o.inference.predictedDepartmentId,
  ).length;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

  return {
    database: true,
    model,
    usage: {
      modelVersions: versions,
      checks: inferences,
      recordsOpened: outcomes.length,
      /** Öneriyi görüp kayıt açmaktan vazgeçenler (henüz tamamlanmamış formlar dahil). */
      notOpened: inferences - outcomes.length,
      /** Doğru ekip = yönlendirildiyse yönlendirilen, değilse seçilen. */
      fieldAccuracyPct: pct(correct, withPrediction.length),
      suggestionAppliedPct: pct(outcomes.filter((o) => o.suggestionApplied).length, outcomes.length),
      forwardedPct: pct(outcomes.filter((o) => o.forwardedToDepartmentId).length, outcomes.length),
    },
  };
}
