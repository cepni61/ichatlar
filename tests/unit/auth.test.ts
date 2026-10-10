import { describe, expect, it, vi } from 'vitest';
import { safeReturnTo } from '../../src/auth/entra.js';

describe('giriş sonrası dönüş adresi', () => {
  it('başka siteye çıkan adresleri reddeder', () => {
    // Tarayıcı sekme ve satır sonunu adresten siler: "/\t/evil.com" → "//evil.com".
    for (const v of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', 'https://evil.com', 42]) {
      expect(safeReturnTo(v)).toBe('/');
    }
  });

  it('uygulama içi adresi aynen bırakır', () => {
    expect(safeReturnTo('/#/kayit/KAY-1')).toBe('/#/kayit/KAY-1');
  });
});

describe('geliştirme girişi', () => {
  it('Entra yapılandırılınca DEV_AUTH_BYPASS açık olsa da kapanır', async () => {
    const keys = ['DEV_AUTH_BYPASS', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET'] as const;
    const before = keys.map((k) => process.env[k]);
    Object.assign(process.env, { DEV_AUTH_BYPASS: 'true', ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', ENTRA_CLIENT_SECRET: 's' });
    try {
      vi.resetModules();
      const { env } = await import('../../src/env.js');
      expect(env.devAuth).toBe(false);
    } finally {
      keys.forEach((k, i) => (before[i] === undefined ? delete process.env[k] : (process.env[k] = before[i])));
      vi.resetModules();
    }
  });
});
