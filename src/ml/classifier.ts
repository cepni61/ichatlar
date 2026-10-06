import { tokenize } from '../domain/similarity.js';

/**
 * Departman sınıflandırıcısı — Multinomial Naive Bayes.
 *
 * Neden bu yöntem: az veriyle (birkaç yüz kayıt) kararlı çalışır, eğitimi
 * milisaniyeler sürer ve açıklanabilir — "bu kayıt İK'ya gidiyor çünkü
 * 'bordro', 'izin' kelimeleri İK kayıtlarında yoğun" diyebiliyoruz. Veri
 * on binleri bulduğunda gömme (embedding) tabanlı bir modele geçilebilir;
 * ML veritabanındaki kayıtlar (Inference/Outcome) o geçişin eğitim verisidir.
 *
 * Bu dosya saf: veritabanına dokunmaz. Eğitim/kayıt işleri service.ts'te.
 */

export interface Params {
  /** Laplace yumuşatma katsayısı — görülmemiş kelime olasılığını sıfır yapmaz. */
  alpha: number;
  /** Başlıktaki kelime açıklamadakinin kaç katı sayılır. Başlık konuyu özetler. */
  titleWeight: number;
  /**
   * Kök uzunluğu. Türkçe eklemeli bir dil: "bordro / bordrom / bordroya"
   * aynı kavram. İlk 5 harfi almak (sabit önek kökleme) Türkçe bilgi
   * erişiminde biçimbilimsel kökleyicilere yakın sonuç veren bilinen, ucuz
   * bir yöntemdir.
   */
  stemLength: number;
  /**
   * Sıcaklık. Naive Bayes olasılıkları aşırı emindir (%99 gibi). Eğitim
   * verisi üzerinde birini-dışarıda-bırak ile ölçülüp gerçek isabetle
   * uyumlu olacak şekilde seçilir (temperature scaling).
   */
  temperature: number;
  /**
   * Ön olasılığın ağırlığı (0 = tüm ekipler eşit, 1 = klasik Naive Bayes).
   * Klasik hâlde kayıtların çoğunu alan ekip (İK) zayıf kanıtı eziyor ve
   * azınlık ekiplerin kayıtları da İK'ya öneriliyordu.
   */
  priorWeight: number;
}

/**
 * Varsayılanlar iki veri setinde (canlı veritabanı + 100 kayıtlık seed)
 * birini-dışarıda-bırak ile tarandı; seçim ölçütü "hiçbir ölçütte
 * gerilemeyen, ekip ortalamasını artıran" ayar oldu. Klasik NB'ye göre ilk
 * öneri isabeti ve ekip ortalaması iki sette de arttı, ilk-3 isabeti aynı
 * kaldı. Veri büyüdükçe Outcome tablosundaki gerçek sonuçlarla tekrar
 * ayarlanmalı — bu boyutta farklar birkaç kayıt düzeyinde.
 */
export const DEFAULT_PARAMS: Params = {
  alpha: 0.25,
  titleWeight: 3,
  stemLength: 5,
  temperature: 1,
  priorWeight: 0,
};

/**
 * Özellik çıkarımı (featurize, GENERIC listesi) her değiştiğinde artırılır.
 * Eğitim parmak izine girer: aksi hâlde veri aynı diye eski kurallarla
 * eğitilmiş model ML veritabanından geri yüklenirdi.
 */
export const FEATURE_VERSION = 5;

/** Güven bunun altındaysa öneri "emin değilim" diye sunulur. */
export const LOW_CONFIDENCE = 0.5;

export interface Features {
  /** kök → ağırlıklı sıklık */
  weights: Map<string, number>;
  /** kök → metindeki ilk hâli (gerekçe gösterirken "yıllık" yazmak için, "yilli" değil) */
  surface: Map<string, string>;
  total: number;
}

export const stem = (w: string, n: number) => (w.length > n ? w.slice(0, n) : w);

/**
 * Talep dilinin her ekipte geçen kalıpları — ekip ayırt etmez. Benzerlik
 * motorunun durak listesine EK olarak yalnızca sınıflandırıcıda elenir:
 * az veride "görünüyor" gibi bir kelime tesadüfen tek ekipte yoğunlaşıp
 * yanlış bir gerekçeye dönüşüyor. Liste dilbilgisel (fiil kalıpları, zaman
 * ifadeleri), veriden seçilmedi. Karşılaştırma katlanmış tam kelimeyle
 * yapılır, kökle değil: "öğrenmek" elenir, "öğrenci" (staj) kalır.
 */
const GENERIC = new Set([
  'talebi', 'talebim', 'talebimiz', 'talepler', 'bilgi', 'bilgisi', 'bilgilendirme',
  'gorunuyor', 'gorunmuyor', 'yapilmis', 'yapildi', 'yapilmasi', 'yapilabilir', 'edilebilir',
  'gerekiyor', 'gerekli', 'gereken', 'lazim', 'mumkun', 'musunuz', 'misiniz', 'miyim',
  'ogrenmek', 'ogrenebilir', 'istiyoruz', 'isterim', 'ederim', 'ederiz', 'edebilir',
  'yardimci', 'olur', 'olursa', 'olsun', 'sekilde', 'konuda', 'durumu', 'durumunu',
  'hangi', 'nedir', 'neden', 'nerede', 'hala', 'henuz', 'gecen', 'hafta', 'bugun', 'yarin',
  'yeni', 'ekip', 'ekibi', 'ekibimiz', 'ekibimize', 'ekibimizin', 'departman', 'departmanimiz',
  'tarafima', 'tarafimiza', 'kendi', 'sadece', 'yine', 'artik', 'simdi', 'once',
  // Not: "gözden geçirilmesi" de genel görünüyor ama elemek iki veri setinde de
  // isabeti düşürdü (ilk-3: %75,6→%73,2 ve %81,3→%78,8) — bu yüzden listede yok.
]);

/**
 * Yokluk eki (-sız/-siz/-suz/-süz) kelimenin anlamını tersine çevirir:
 * "reçetesiz" (OTC) ile "reçete" sabit önek köklemede aynı köke ("recet")
 * düşüyor ve tüketici sağlığı ile geri ödeme kayıtları karışıyordu. Eki taşıyan
 * kelime kökü + "~" olarak ayrı bir özellik olur. Katlanmış hâlde: sız→siz, süz→suz.
 */
const PRIVATIVE = /^(.{3,})(siz|suz)$/;

const featureKey = (tok: string, n: number) => {
  const m = PRIVATIVE.exec(tok);
  return m ? `${stem(m[1]!, n)}~` : stem(tok, n);
};

export function featurize(title: string, description: string, p: Params = DEFAULT_PARAMS): Features {
  const weights = new Map<string, number>();
  const surface = new Map<string, string>();
  let total = 0;

  const add = (text: string, w: number) => {
    // Metni önce özgün hâliyle kelimelere bölüyoruz: gerekçede kullanıcının
    // yazdığı kelime görünsün. (Önce küçültmek İngilizce "Intranet"i Türkçe
    // kuralla "ıntranet" yapıyordu.) tokenize() tek kelimeyi katlar ve eler.
    for (const raw of String(text ?? '').split(/[^\p{L}\p{N}]+/u)) {
      const tok = tokenize(raw)[0];
      if (!tok || GENERIC.has(tok)) continue;
      const s = featureKey(tok, p.stemLength);
      weights.set(s, (weights.get(s) ?? 0) + w);
      if (!surface.has(s)) surface.set(s, raw);
      total += w;
    }
  };

  add(title, p.titleWeight);
  add(description, 1);
  return { weights, surface, total };
}

export interface Doc {
  code: string;
  departmentId: string;
  features: Features;
  /** Kayıt yönlendirilmiş, etiket düzeltilmiş. */
  corrected: boolean;
}

export interface DepartmentStat {
  id: string;
  name: string;
  docCount: number;
  tokenCount: number;
}

export interface Model {
  params: Params;
  departments: DepartmentStat[];
  /** kök → (ekip → ağırlıklı sıklık) */
  counts: Map<string, Map<string, number>>;
  totalDocs: number;
  vocabSize: number;
}

export function train(
  docs: Doc[],
  departments: { id: string; name: string }[],
  params: Params = DEFAULT_PARAMS,
): Model {
  const stats = new Map<string, DepartmentStat>(
    departments.map((d) => [d.id, { id: d.id, name: d.name, docCount: 0, tokenCount: 0 }]),
  );
  const counts = new Map<string, Map<string, number>>();

  for (const doc of docs) {
    const st = stats.get(doc.departmentId);
    if (!st) continue; // pasif ekip — öneri olarak sunulamaz
    st.docCount += 1;
    st.tokenCount += doc.features.total;
    for (const [t, w] of doc.features.weights) {
      let row = counts.get(t);
      if (!row) counts.set(t, (row = new Map()));
      row.set(doc.departmentId, (row.get(doc.departmentId) ?? 0) + w);
    }
  }

  return {
    params,
    departments: [...stats.values()],
    counts,
    totalDocs: [...stats.values()].reduce((a, s) => a + s.docCount, 0),
    vocabSize: counts.size,
  };
}

interface Scored {
  id: string;
  name: string;
  score: number;
  /** kök → bu ekibe katkısı (ekipler ortalamasına göre) */
  contrib: Map<string, number>;
}

/**
 * Ham log-olasılıklar. `exclude` verilirse o kayıt modelden çıkarılmış gibi
 * hesaplanır — birini-dışarıda-bırak testi için, modeli yeniden eğitmeden.
 */
function logScores(model: Model, f: Features, exclude?: Doc): { scored: Scored[]; known: number } {
  const { alpha } = model.params;
  const K = model.departments.length;
  const V = Math.max(1, model.vocabSize);
  const N = model.totalDocs - (exclude ? 1 : 0);

  const depts = model.departments.map((d) => {
    const own = exclude && exclude.departmentId === d.id;
    return {
      d,
      docCount: d.docCount - (own ? 1 : 0),
      tokenCount: d.tokenCount - (own ? exclude!.features.total : 0),
    };
  });

  // Sorgunun modelin tanıdığı kökleri ve her ekipteki log p(kök | ekip)
  const known: { t: string; w: number; lp: number[] }[] = [];
  for (const [t, w] of f.weights) {
    const row = model.counts.get(t);
    if (!row) continue;
    const cs = depts.map((x) => {
      let c = row.get(x.d.id) ?? 0;
      if (exclude && exclude.departmentId === x.d.id) c -= exclude.features.weights.get(t) ?? 0;
      return Math.max(0, c);
    });
    if (cs.every((c) => c === 0)) continue; // yalnızca dışarıda bırakılan kayıtta geçiyordu
    known.push({ t, w, lp: cs.map((c, i) => Math.log((c + alpha) / (depts[i]!.tokenCount + alpha * V))) });
  }

  const scored = depts.map((x, i) => {
    let score = model.params.priorWeight * Math.log((x.docCount + 1) / (N + K));
    const contrib = new Map<string, number>();
    for (const k of known) {
      score += k.w * k.lp[i]!;
      const mean = k.lp.reduce((a, b) => a + b, 0) / k.lp.length;
      contrib.set(k.t, k.w * (k.lp[i]! - mean));
    }
    return { id: x.d.id, name: x.d.name, score, contrib };
  });

  return { scored, known: known.length };
}

function softmax(scores: number[], T: number): number[] {
  const m = Math.max(...scores);
  const e = scores.map((s) => Math.exp((s - m) / T));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}

export interface Prediction {
  departmentId: string;
  departmentName: string;
  probability: number;
  /** Bu ekibi işaret eden kelimeler (en güçlü 3). */
  terms: string[];
}

export interface PredictResult {
  ranked: Prediction[];
  knownTerms: number;
  lowConfidence: boolean;
}

export function predict(model: Model, f: Features, exclude?: Doc): PredictResult {
  const { scored, known } = logScores(model, f, exclude);
  if (known === 0 || scored.length === 0) return { ranked: [], knownTerms: 0, lowConfidence: true };

  const probs = softmax(scored.map((s) => s.score), model.params.temperature);
  const ranked = scored
    .map((s, i) => ({
      departmentId: s.id,
      departmentName: s.name,
      probability: probs[i]!,
      terms: [...s.contrib.entries()]
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => f.surface.get(t) ?? t),
    }))
    .sort((a, b) => b.probability - a.probability);

  // Tek tanıdık kelimeyle verilen karar kırılgandır; güven yüksek görünse de işaretle.
  const lowConfidence = ranked[0]!.probability < LOW_CONFIDENCE || known < 2;
  return { ranked, knownTerms: known, lowConfidence };
}

export interface Evaluation {
  /** Birini-dışarıda-bırak doğruluğu (ilk öneri doğru). */
  accuracy: number;
  /** Doğru ekip ilk 3 aday arasında — arayüz 3 aday gösterdiği için anlamlı. */
  top3: number;
  temperature: number;
  /** kayıt kodu → LOO tahmini */
  predicted: Map<string, string | null>;
  perDepartment: Record<string, { total: number; correct: number }>;
}

/**
 * Her kayıt, kendisi çıkarılmış modelle tahmin edilir. Böylece ölçülen isabet
 * "ezber" değil, modelin görmediği kayıttaki başarısıdır. Aynı turda sıcaklık
 * da seçilir: doğru ekibe verilen olasılığın log-kaybını en aza indiren değer.
 */
export function evaluate(model: Model, docs: Doc[]): Evaluation {
  const perDepartment: Evaluation['perDepartment'] = {};
  const predicted = new Map<string, string | null>();
  const rows: { scores: number[]; truth: number }[] = [];
  let correct = 0;
  let inTop3 = 0;
  let counted = 0;

  for (const doc of docs) {
    const idx = model.departments.findIndex((d) => d.id === doc.departmentId);
    if (idx < 0) continue;
    const { scored, known } = logScores(model, doc.features, doc);
    const pd = (perDepartment[doc.departmentId] ??= { total: 0, correct: 0 });
    pd.total += 1;
    counted += 1;

    if (known === 0) {
      predicted.set(doc.code, null);
      continue;
    }
    let best = 0;
    for (let i = 1; i < scored.length; i++) if (scored[i]!.score > scored[best]!.score) best = i;
    predicted.set(doc.code, scored[best]!.id);
    if (best === idx) {
      correct += 1;
      pd.correct += 1;
    }
    const rank = scored.filter((s) => s.score > scored[idx]!.score).length;
    if (rank < 3) inTop3 += 1;
    rows.push({ scores: scored.map((s) => s.score), truth: idx });
  }

  let temperature = 1;
  let bestLoss = Infinity;
  for (const T of [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24]) {
    let loss = 0;
    for (const r of rows) loss -= Math.log(Math.max(1e-12, softmax(r.scores, T)[r.truth]!));
    if (loss < bestLoss) {
      bestLoss = loss;
      temperature = T;
    }
  }

  return {
    accuracy: counted ? correct / counted : 0,
    top3: counted ? inTop3 / counted : 0,
    temperature,
    predicted,
    perDepartment,
  };
}
