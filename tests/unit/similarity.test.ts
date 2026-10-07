import { describe, expect, it } from 'vitest';
import { surfaceForms, tokenize } from '../../src/domain/similarity.js';

describe('eşleşme gerekçesi', () => {
  it('katlanmış token kullanıcının yazdığı Türkçe biçime döner', () => {
    const text = 'VPN Bağlantısı evden KOPUYOR, e-posta İmzası';
    const surface = surfaceForms(text);
    expect(tokenize(text).map((t) => surface.get(t))).toEqual([
      'vpn', 'bağlantısı', 'evden', 'kopuyor', 'posta', 'imzası',
    ]);
  });
});
