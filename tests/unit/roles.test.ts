import { describe, expect, it } from 'vitest';
import { effectiveRole } from '../../src/domain/roles.js';

describe('etkin rol', () => {
  it('dizin rolü ile verilen yetkinin yükseği', () => {
    expect(effectiveRole('TEAM_MEMBER', 'MANAGER', 'ekip')).toBe('MANAGER');
    expect(effectiveRole('USER', 'ADMIN', null)).toBe('ADMIN');
    // AD'den gelen yöneticilik, uygulamadaki daha düşük yetkiyle düşmez.
    expect(effectiveRole('ADMIN', 'MANAGER', 'ekip')).toBe('ADMIN');
    expect(effectiveRole('MANAGER', null, 'ekip')).toBe('MANAGER');
  });

  it('ekibi olmayana verilen ekip yöneticiliği işlemez', () => {
    expect(effectiveRole('USER', 'MANAGER', null)).toBe('USER');
  });
});
