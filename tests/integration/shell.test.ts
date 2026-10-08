import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '../../src/domain/enums.js';
import { createDept, createUser, loginAs, makeApp, resetDb } from './helpers.js';

/*
 * Arayüz kabuğu: açılış verisi ve ana sayfaya giriş. Ekranlar adres
 * çubuğunda "#/kayit/KAY-…" biçiminde tutulur; parça (#…) sunucuya hiç
 * gelmediği için oturumsuz açılışta tarayıcı tarafında korunmalı.
 */

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe('ana sayfa', () => {
  beforeEach(resetDb);

  it('oturumsuz açılışta adres parçasını (#/kayit/…) girişe taşıyan sayfa döner', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('/auth/login?returnTo=');
    expect(res.body).toContain('location.hash');
  });

  it('oturum varsa uygulama açılır', async () => {
    const u = await createUser({ name: 'Ayşe' });
    const res = await app.inject({ method: 'GET', url: '/', headers: await loginAs(app, u.id) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="detailBody"');
  });
});

describe('açılış verisi', () => {
  beforeEach(resetDb);

  it('"üzerine alınmış" durumu herkese aynı adla görünür: Sahiplenildi', async () => {
    const d = await createDept('İnsan Kaynakları');
    const u = await createUser({ name: 'Ayşe', role: Role.TEAM_MEMBER, departmentId: d.id });
    const res = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: await loginAs(app, u.id) });
    const st = (res.json().statuses as { id: string; label: string }[]).find((s) => s.id === 'uzerime_alindi');
    expect(st?.label).toBe('Sahiplenildi');
  });

  it('öncelikler hedef süreyle birlikte uyarı eşiğini de taşır', async () => {
    // Arayüz "süre yaklaşıyor" rengini sunucuyla aynı eşikten hesaplasın
    // (eşik Yönetim'den değişebiliyor; arayüzde sabit 0.7 vardı).
    const u = await createUser({ name: 'Ayşe' });
    const { prisma } = await import('./helpers.js');
    await prisma.slaRule.upsert({
      where: { priority: 'YUKSEK' },
      update: { hours: 20, warnRatio: 0.8 },
      create: { priority: 'YUKSEK', hours: 20, warnRatio: 0.8 },
    });
    const { invalidateSlaCache } = await import('../../src/domain/sla.js');
    invalidateSlaCache();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: await loginAs(app, u.id) });
      const p = (res.json().priorities as { id: string; sla: number; warn: number }[]).find((x) => x.id === 'yuksek');
      expect(p).toMatchObject({ sla: 20, warn: 0.8 });
    } finally {
      // Kurallar resetDb ile silinmiyor: sonraki testler varsayılanı görsün.
      await prisma.slaRule.update({ where: { priority: 'YUKSEK' }, data: { hours: 24, warnRatio: 0.7 } });
      invalidateSlaCache();
    }
  });
});
