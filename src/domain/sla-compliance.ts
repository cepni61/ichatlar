/**
 * SLA uyumu — saf hesap (veritabanı yok, birim testli).
 *
 * Tanım, SLA gözcüsüyle aynı: kayıt hedef süre (slaDueAt) dolmadan açık
 * durumdan çıktıysa (çözüldü / reddedildi / kapatıldı) hedef tutulmuştur.
 *   - Süresi dolmuş açık kayıt     → tutulmadı
 *   - Süresi dolmamış açık kayıt   → henüz sonuçlanmadı, orana girmez
 *   - Kapanmış kayıt               → bitiş anı ≤ hedef ise tutuldu
 *
 * Eskiden kapanmış her kayıt "zamanında" sayılıyordu: hedefi aşıp sonradan
 * çözülen kayıt bile uyumlu görünüyor, oran olduğundan iyi çıkıyordu.
 */
export interface SlaRow {
  slaDueAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
}

/** true: tuttu · false: tutmadı · null: henüz sonuçlanmadı */
export function metSla(r: SlaRow, open: boolean, now: number): boolean | null {
  const due = r.slaDueAt.getTime();
  if (open) return due > now ? null : false;
  const finished = r.resolvedAt ?? r.closedAt;
  return finished ? finished.getTime() <= due : true;
}

/** Sonuçlanmış kayıtlarda hedefi tutanların yüzdesi; sonuçlanan yoksa null. */
export function slaCompliancePct<T extends SlaRow>(rows: T[], isOpen: (r: T) => boolean, now: number): number | null {
  let met = 0;
  let decided = 0;
  for (const r of rows) {
    const m = metSla(r, isOpen(r), now);
    if (m === null) continue;
    decided += 1;
    if (m) met += 1;
  }
  return decided ? Math.round((met / decided) * 100) : null;
}
