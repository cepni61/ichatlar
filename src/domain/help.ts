import { fold } from './similarity.js';

/**
 * Kayıt önleme günlüğünün kuralları (docs/superpowers/specs/2026-10-11-kayit-onleme-gunlugu-design.md §3, §5).
 * Veritabanına dokunmaz; yazımı src/lib/help-log.ts yapar.
 */

export const HelpChannel = { YENI_KAYIT: 'YENI_KAYIT', KAYNAK_BUL: 'KAYNAK_BUL', ASISTAN: 'ASISTAN' } as const;
export type HelpChannel = (typeof HelpChannel)[keyof typeof HelpChannel];

export const HelpKind = { ML_TARAMA: 'ML_TARAMA', ARAMA: 'ARAMA', ASISTAN: 'ASISTAN' } as const;
export type HelpKind = (typeof HelpKind)[keyof typeof HelpKind];

export const HelpSource = { KAYIT: 'KAYIT', BILGI_BANKASI: 'BILGI_BANKASI', CORTEX: 'CORTEX' } as const;
export type HelpSource = (typeof HelpSource)[keyof typeof HelpSource];

/** Web analitiğindeki olağan oturum sınırı. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Taramadan sonra formu uzun süre yazan kişinin kaydı yine o oturuma bağlansın. */
export const LINK_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Arama her tuşta, ML taraması her 0,9 sn duraklamada çalışıyor; asistan sorusu hiç birleşmez. */
const MERGE_MS: Partial<Record<string, number>> = { [HelpKind.ARAMA]: 10_000, [HelpKind.ML_TARAMA]: 60_000 };

export interface SessionState { userId: string | null; recordId: string | null; lastActivityAt: Date }
export interface QueryState { kind: string; text: string | null; at: Date; touched: boolean }

export function sessionUsable(s: SessionState | null, userId: string, now: Date, purpose: 'query' | 'link'): boolean {
  if (!s || s.userId !== userId || s.recordId) return false;
  const limit = purpose === 'link' ? LINK_WINDOW_MS : SESSION_IDLE_MS;
  return now.getTime() - s.lastActivityAt.getTime() <= limit;
}

/** Yeni sorgu öncekinin devamı mı (aynı taslağın yeni hâli): öyleyse yeni satır açılmaz. */
export function shouldMerge(prev: QueryState | null, next: { kind: string; text: string | null }, now: Date): boolean {
  if (!prev || prev.touched || prev.kind !== next.kind) return false;
  const window = MERGE_MS[next.kind];
  if (!window || now.getTime() - prev.at.getTime() > window) return false;
  if (next.kind !== HelpKind.ARAMA) return true;
  const a = fold(prev.text ?? '');
  const b = fold(next.text ?? '');
  return a.startsWith(b) || b.startsWith(a);
}
