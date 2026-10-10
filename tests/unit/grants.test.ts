import { describe, expect, it } from 'vitest';
import { effectiveRole } from '../../src/domain/grants.js';

describe('etkin rol', () => {
  it('dizin rolü ile geçerli rol yetkilerinin en yükseği', () => {
    expect(effectiveRole('TEAM_MEMBER', ['MANAGER'], 'ekip')).toBe('MANAGER');
    expect(effectiveRole('USER', ['MANAGER', 'ADMIN'], 'ekip')).toBe('ADMIN');
    // AD'den gelen yöneticilik, daha düşük verilmiş yetkiyle düşmez.
    expect(effectiveRole('ADMIN', ['MANAGER'], 'ekip')).toBe('ADMIN');
    expect(effectiveRole('MANAGER', [], 'ekip')).toBe('MANAGER');
  });

  it('ekibi olmayana verilen ekip yöneticiliği işlemez', () => {
    expect(effectiveRole('USER', ['MANAGER'], null)).toBe('USER');
  });
});
