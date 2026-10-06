import { describe, expect, it } from 'vitest';
import { envFlag } from '../../src/lib/flag.js';

const parse = (v: string | undefined, fallback = false) => envFlag(fallback).safeParse(v);

describe('.env açık/kapalı ayarı', () => {
  it('"false" ayarı KAPATIR (z.coerce.boolean bunu açıyordu)', () => {
    expect(parse('false')).toMatchObject({ success: true, data: false });
    expect(parse('FALSE', true)).toMatchObject({ success: true, data: false });
    expect(parse('0', true)).toMatchObject({ success: true, data: false });
    expect(parse('hayır', true)).toMatchObject({ success: true, data: false });
  });

  it('tanınan doğru değerler açar', () => {
    for (const v of ['true', 'True', '1', 'yes', 'on', 'evet', ' true ']) {
      expect(parse(v)).toMatchObject({ success: true, data: true });
    }
  });

  it('boş veya yoksa varsayılan', () => {
    expect(parse(undefined, true)).toMatchObject({ success: true, data: true });
    expect(parse('', true)).toMatchObject({ success: true, data: true });
    expect(parse('', false)).toMatchObject({ success: true, data: false });
  });

  it('yazım hatası sessizce yorumlanmaz, hata verir', () => {
    expect(parse('ture').success).toBe(false);
    expect(parse('açık').success).toBe(false);
  });
});
