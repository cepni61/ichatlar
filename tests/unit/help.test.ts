import { describe, expect, it } from 'vitest';
import { HelpKind, LINK_WINDOW_MS, SESSION_IDLE_MS, sessionUsable, shouldMerge } from '../../src/domain/help.js';

const now = new Date('2026-10-11T10:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('yardım oturumu', () => {
  const s = { userId: 'u1', recordId: null, lastActivityAt: ago(SESSION_IDLE_MS - 1000) };

  it('yalnızca sahibinin, kayda bağlanmamış ve süresi geçmemiş oturumu sürer', () => {
    expect(sessionUsable(s, 'u1', now, 'query')).toBe(true);
    expect(sessionUsable(s, 'u2', now, 'query')).toBe(false);
    expect(sessionUsable({ ...s, recordId: 'r1' }, 'u1', now, 'query')).toBe(false);
    expect(sessionUsable({ ...s, userId: null }, 'u1', now, 'query')).toBe(false);
    expect(sessionUsable({ ...s, lastActivityAt: ago(SESSION_IDLE_MS + 1000) }, 'u1', now, 'query')).toBe(false);
    expect(sessionUsable(null, 'u1', now, 'query')).toBe(false);
  });

  it('kayıt bağlarken 24 saate kadar geriye bakar', () => {
    const old = { ...s, lastActivityAt: ago(2 * 60 * 60 * 1000) };
    expect(sessionUsable(old, 'u1', now, 'query')).toBe(false);
    expect(sessionUsable(old, 'u1', now, 'link')).toBe(true);
    expect(sessionUsable({ ...s, lastActivityAt: ago(LINK_WINDOW_MS + 1000) }, 'u1', now, 'link')).toBe(false);
  });
});

describe('sorgu birleştirme', () => {
  const prev = (o: Partial<{ kind: string; text: string | null; at: Date; touched: boolean }> = {}) =>
    ({ kind: HelpKind.ARAMA, text: 'izin', at: ago(5000), touched: false, ...o });

  it('arama: 10 sn içinde ve biri ötekinin önekiyse birleşir (Türkçe harf duyarsız)', () => {
    expect(shouldMerge(prev(), { kind: HelpKind.ARAMA, text: 'izin talebi' }, now)).toBe(true);
    expect(shouldMerge(prev({ text: 'izin talebi' }), { kind: HelpKind.ARAMA, text: 'izin' }, now)).toBe(true);
    expect(shouldMerge(prev(), { kind: HelpKind.ARAMA, text: 'İZİN tal' }, now)).toBe(true);
    expect(shouldMerge(prev(), { kind: HelpKind.ARAMA, text: 'vpn' }, now)).toBe(false);
    expect(shouldMerge(prev({ at: ago(11_000) }), { kind: HelpKind.ARAMA, text: 'izin talebi' }, now)).toBe(false);
  });

  it('ML taraması: 60 sn içinde metin değişse de birleşir', () => {
    const ml = prev({ kind: HelpKind.ML_TARAMA, text: 'VPN kopuyor', at: ago(50_000) });
    expect(shouldMerge(ml, { kind: HelpKind.ML_TARAMA, text: 'Evden VPN bağlantısı kopuyor' }, now)).toBe(true);
    expect(shouldMerge({ ...ml, at: ago(61_000) }, { kind: HelpKind.ML_TARAMA, text: 'x' }, now)).toBe(false);
  });

  it('sonuca dokunulduysa, tür farklıysa, asistan sorusuysa ya da önceki yoksa birleşmez', () => {
    expect(shouldMerge(prev({ touched: true }), { kind: HelpKind.ARAMA, text: 'izin talebi' }, now)).toBe(false);
    expect(shouldMerge(prev(), { kind: HelpKind.ML_TARAMA, text: 'izin' }, now)).toBe(false);
    expect(shouldMerge(prev({ kind: HelpKind.ASISTAN }), { kind: HelpKind.ASISTAN, text: 'izin' }, now)).toBe(false);
    expect(shouldMerge(null, { kind: HelpKind.ARAMA, text: 'izin' }, now)).toBe(false);
  });
});
