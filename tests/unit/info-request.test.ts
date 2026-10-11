import { describe, expect, it } from 'vitest';
import { statusAfterInfo } from '../../src/domain/info-request.js';

describe('ek bilgi yanıtından sonra durum', () => {
  it('istekten önceki açık duruma döner', () => {
    expect(statusAfterInfo('BILGI', 'CALISILIYOR')).toBe('CALISILIYOR');
    expect(statusAfterInfo('BILGI', 'INCELENIYOR')).toBe('INCELENIYOR');
    expect(statusAfterInfo('BILGI', 'YENI')).toBe('YENI');
    expect(statusAfterInfo('ONERI', 'DEGERLENDIRILIYOR')).toBe('DEGERLENDIRILIYOR');
  });

  it('dönülemeyen ya da anlamsız durumda iş sürüyor sayılır', () => {
    expect(statusAfterInfo('BILGI', 'UZERIME_ALINDI')).toBe('CALISILIYOR');
    expect(statusAfterInfo('BILGI', 'EK_BILGI')).toBe('CALISILIYOR');
    expect(statusAfterInfo('BILGI', 'COZULDU')).toBe('CALISILIYOR');
    expect(statusAfterInfo('ONERI', 'EK_BILGI')).toBe('DEGERLENDIRILIYOR');
  });
});
