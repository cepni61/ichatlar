/**
 * Öneri kaydının yapısı. Bilgi talebi bir soruna yanıt arar; öneri bir
 * değişiklik teklif eder. Bu yüzden öneri formu farklıdır:
 *   - mevcut durum (şu an nasıl), öneri (ne değişsin), beklenen fayda
 *   - öncelik yok (SLA iç olarak Normal: ilk değerlendirme hedefi)
 *   - ML kontrolü yok (benzer çözüm aramak bir fikre uymuyor)
 *
 * Alanlar kayıtta `details` (JSON metni) olarak durur; raporlanabilsin diye
 * fayda kategorileri sabit anahtarlardır. `description` aynı içeriğin okunur
 * birleşimidir — arama, ML ekip önerisi ve eski ekranlar onu kullanır.
 */
export const BENEFITS = {
  maliyet: 'Maliyet tasarrufu',
  zaman: 'Zaman ve verimlilik',
  kalite: 'Kalite',
  calisan: 'Çalışan deneyimi',
  hasta: 'Hasta / müşteri deneyimi',
  guvenlik: 'İş güvenliği ve uyum',
  surdurulebilirlik: 'Sürdürülebilirlik',
} as const;

export type BenefitKey = keyof typeof BENEFITS;
export const BENEFIT_KEYS = Object.keys(BENEFITS) as [BenefitKey, ...BenefitKey[]];

export interface SuggestionDetails {
  current: string;
  proposal: string;
  benefits: BenefitKey[];
  benefitNote?: string;
}

/** Yapısal alanlardan okunur açıklama metni. */
export function composeDescription(d: SuggestionDetails): string {
  const benefits = d.benefits.map((k) => BENEFITS[k]).join(', ');
  return [
    `Mevcut durum: ${d.current}`,
    `Öneri: ${d.proposal}`,
    `Beklenen fayda: ${benefits}${d.benefitNote ? ` — ${d.benefitNote}` : ''}`,
  ].join('\n\n');
}

/** Kayıttaki JSON metnini güvenle okur; bozuk ya da boşsa null. */
export function parseDetails(text: string | null | undefined): SuggestionDetails | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<SuggestionDetails>;
    if (typeof v.current !== 'string' || typeof v.proposal !== 'string' || !Array.isArray(v.benefits)) return null;
    return {
      current: v.current,
      proposal: v.proposal,
      benefits: v.benefits.filter((k): k is BenefitKey => k in BENEFITS),
      ...(v.benefitNote ? { benefitNote: String(v.benefitNote) } : {}),
    };
  } catch {
    return null;
  }
}
