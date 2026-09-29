import { RecordStatus } from './enums.js';
import { prisma } from '../db.js';
import { TYPE_TO_SLUG } from './constants.js';

/**
 * Benzer çözülmüş kayıt eşleştirmesi — prototipteki "ML ile Kontrol Et".
 *
 * Skorlama, ichatlar4.html'deki `mlScore` ile BİREBİR aynı tutuldu. İlk
 * sunucu sürümünde formülü "sadeleştirmiştim" ve isabet ciddi düştü:
 * `overlapRatio` terimi kaybolmuştu, havuzdan kapatılmış kayıtlar
 * çıkmıştı, departman/tür bonusları yoktu ve eşik %12'den %22'ye çıkmıştı.
 * Sonuç: 3 eşleşme yerine 1. Prototipin ağırlıkları gerçek veriyle
 * ayarlanmış — dokunmamak doğrusu.
 *
 * Neden `overlapRatio` önemli: Jaccard, aday metin uzun olduğunda kesişimi
 * birleşime bölerek cezalandırır. Uzun açıklamalı bir kayıt, sorgunun tüm
 * kelimelerini içerse bile düşük skor alır. overlapRatio "sorgunun kaçı
 * adayda geçiyor" diye sorar ve bu cezayı uygulamaz; ikisi birlikte hem
 * kesinlik hem duyarlılık verir.
 *
 * Prototipe göre tek iyileştirme: Türkçe harfler ASCII'ye katlanıyor
 * (aşağıda). Prototip yalnızca `İ→i`, `I→ı` çeviriyordu; "yillik" yazan
 * kullanıcı "yıllık" kaydını bulamıyordu.
 *
 * Sunucuya taşınmasının sebebi: eşleşme adayları arasında kullanıcının
 * görmeye yetkili olmadığı kayıtlar var. Yanıtta kayıt gövdesi değil
 * yalnızca başlık + çözüm paylaşılır.
 *
 * Ölçek notu: kayıt sayısı on binleri geçtiğinde bu tarama yavaşlar.
 * O noktada PostgreSQL tam metin arama (tsvector + GIN) veya pgvector ile
 * gömme tabanlı aramaya geçilir; imza aynı kalır.
 */

/** Prototipteki STOPWORDS listesi — alana özgü, kısaltılmadı. */
const STOP_WORDS = [
  've', 'veya', 'ile', 'için', 'gibi', 'kadar', 'daha', 'çok', 'az', 'bir', 'bu', 'şu',
  'da', 'de', 'ki', 'mi', 'mı', 'mu', 'mü', 'ama', 'fakat', 'ancak', 'her', 'hem', 'ise',
  'değil', 'ne', 'nasıl', 'ben', 'biz', 'siz', 'benim', 'bizim', 'olarak', 'göre', 'sonra',
  'önce', 'içinde', 'yani', 'tüm', 'bütün', 'olan', 'olması', 'olmak', 'etmek', 'yapmak',
  'talep', 'öneri', 'öneriyorum', 'istiyorum', 'ediyorum', 'rica', 'lütfen', 'konu',
  'konusunda', 'hakkında', 'ilgili', 'gerekli', 'edilmesini', 'edilmesi', 'yapılmasını',
  'sağlanmasını', 'düşünüyorum', 'var', 'yok', 'ihtiyacım', 'ihtiyaç',
];

/**
 * Türkçe harfleri ASCII karşılıklarına katlar.
 *
 * Kullanıcılar Türkçe karakter kullanmadan da yazıyor: "yillik izin" ile
 * "yıllık izin" aynı token'lara inmezse eşleşme kaçar. Katlama sorguya ve
 * aday metne birlikte uygulandığı için simetrik. `i`/`ı` ayrımı bilinçli
 * olarak feda edilir — arama için doğru takas.
 */
const FOLD: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u',
};

const fold = (s: string) =>
  String(s ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıİöşüâîû]/g, (c) => FOLD[c] ?? c);

// Durak kelimeler de katlanır — yoksa "için" katlandıktan sonra "icin" olur
// ve listeyle eşleşmeyip token olarak kalırdı.
const STOP = new Set(STOP_WORDS.map(fold));

/** Prototipteki mlTokens: en az 3 harf, durak kelimeler dışarıda. */
export function tokenize(text: string): string[] {
  return fold(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  const union = a.size + b.size - hit;
  return union > 0 ? hit / union : 0;
}

/** Sorgunun kaç kelimesi adayda geçiyor. Aday uzunluğunu cezalandırmaz. */
function overlapRatio(arr: string[], set: Set<string>): number {
  if (arr.length === 0) return 0;
  let hit = 0;
  for (const t of arr) if (set.has(t)) hit++;
  return hit / arr.length;
}

export interface SimilarQuery {
  title: string;
  description: string;
  /** Formda seçili ekip — aynı ekibe düşen çözümler biraz öne alınır. */
  department?: string | null;
  /** bilgi | oneri */
  type?: string | null;
}

export interface SimilarMatch {
  code: string;
  type: string;
  title: string;
  description: string;
  resolution: string;
  departmentId: string;
  departmentName: string;
  percent: number;
  /** Eşleşmeyi tetikleyen kelimeler — kullanıcıya gerekçe göstermek için. */
  terms: string[];
}

export async function findSimilar(query: SimilarQuery, limit = 3): Promise<SimilarMatch[]> {
  const qTitleTokens = tokenize(query.title);
  const qDescTokens = tokenize(query.description);
  const qAllTokens = qTitleTokens.concat(qDescTokens);
  if (qAllTokens.length === 0) return [];

  const qTitleSet = new Set(qTitleTokens);
  const qAllSet = new Set(qAllTokens);

  // Havuz: çözülmüş VE çözülüp kapatılmış kayıtların tamamı. Kapatılmış
  // olanlar en değerlisi — çözümün işe yaradığını kaydı açan onaylamış.
  const solved = await prisma.record.findMany({
    where: {
      status: { in: [RecordStatus.COZULDU, RecordStatus.KAPATILDI] },
      resolution: { not: null },
    },
    select: {
      code: true,
      type: true,
      title: true,
      description: true,
      resolution: true,
      departmentId: true,
      department2Id: true,
      department: { select: { name: true } },
    },
    orderBy: { resolvedAt: 'desc' },
    take: 2000,
  });

  const scored = solved.map((r) => {
    const cTitleSet = new Set(tokenize(r.title));
    const cAllSet = new Set(tokenize(r.title).concat(tokenize(r.description)));

    let score =
      0.40 * jaccard(qAllSet, cAllSet) +
      0.35 * jaccard(qTitleSet, cTitleSet) +
      0.25 * overlapRatio(qAllTokens, cAllSet);

    // Alan sinyalleri: aynı ekip ve aynı tür biraz öne alınır.
    if (query.department && (r.departmentId === query.department || r.department2Id === query.department)) {
      score += 0.05;
    }
    if (query.type && TYPE_TO_SLUG[r.type] === query.type) {
      score += 0.05;
    }
    score = Math.max(0, Math.min(1, score));

    const terms: string[] = [];
    for (const w of qAllSet) {
      if (cAllSet.has(w) && terms.length < 4) terms.push(w);
    }

    return {
      code: r.code,
      type: TYPE_TO_SLUG[r.type] ?? r.type,
      title: r.title,
      description: r.description,
      resolution: r.resolution!,
      departmentId: r.departmentId,
      departmentName: r.department.name,
      score,
      percent: Math.round(score * 100),
      terms,
    };
  });

  return scored
    .filter((x) => x.percent >= 12) // prototipteki eşik
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}
