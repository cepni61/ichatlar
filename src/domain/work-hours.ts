/**
 * Mesai saati hesabı: çözülen kaydın kendiliğinden kapanma zamanı
 * (kullanıcı isteği, 2026-10-12: 4 mesai saati; hafta içi, resmi tatil yok).
 */

export interface WorkDay {
  /** Günün başından dakika (08:00 → 480). */
  startMin: number;
  endMin: number;
}

/** "08:00-17:00" → { startMin: 480, endMin: 1020 }. */
export function parseWorkHours(text: string): WorkDay {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`Mesai saati "SS:DD-SS:DD" biçiminde olmalı: ${text}`);
  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const endMin = Number(m[3]) * 60 + Number(m[4]);
  if (startMin >= endMin || endMin > 24 * 60) throw new Error(`Mesai başlangıcı bitişten önce olmalı: ${text}`);
  return { startMin, endMin };
}

// shortcut: İstanbul'da 2016'dan beri yaz saati yok, sabit +03:00; başka saat dilimi gerekirse Intl ile hesaplanmalı.
const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

/** Başlangıçtan itibaren yalnızca hafta içi mesai saatlerini sayarak `hours` ekler. */
export function addWorkingHours(start: Date, hours: number, day: WorkDay): Date {
  let remaining = hours * 60;
  // Yerel (İstanbul) saatini UTC gibi tutarak gün ve dakika hesaplanır.
  let local = start.getTime() + OFFSET_MS;
  for (let guard = 0; guard < 3660; guard++) {
    const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
    const weekday = new Date(dayStart).getUTCDay();
    const minute = (local - dayStart) / MIN_MS;
    if (weekday === 0 || weekday === 6 || minute >= day.endMin) {
      local = dayStart + DAY_MS + day.startMin * MIN_MS;
      continue;
    }
    if (minute < day.startMin) local = dayStart + day.startMin * MIN_MS;
    const left = day.endMin - (local - dayStart) / MIN_MS;
    if (remaining <= left) return new Date(local + remaining * MIN_MS - OFFSET_MS);
    remaining -= left;
    local = dayStart + DAY_MS + day.startMin * MIN_MS;
  }
  throw new Error('Mesai saati hesaplanamadı');
}

/** Çözülen kaydın kendiliğinden kapanacağı an; süre 0 ise kural kapalıdır. */
export function autoCloseDeadline(from: Date, hours: number, day: WorkDay): Date | null {
  return hours > 0 ? addWorkingHours(from, hours, day) : null;
}
