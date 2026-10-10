import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/*
 * Entra girişinde kullanıcı eşleme ve yazma isteklerinde köken kontrolü.
 * Yönetici grubu env.ts içe aktarılırken okunur; uygulama dinamik
 * yüklenmeden ÖNCE verilir (bkz. dev-login.test.ts).
 */
const ADMIN_GROUP = 'grp-yonetici';
const before = process.env.ENTRA_ADMIN_GROUP_ID;
process.env.ENTRA_ADMIN_GROUP_ID = ADMIN_GROUP;

let app: FastifyInstance;
let h: typeof import('./helpers.js');
let entra: typeof import('../../src/auth/entra.js');
let Role: typeof import('../../src/domain/enums.js').Role;

beforeAll(async () => {
  h = await import('./helpers.js');
  entra = await import('../../src/auth/entra.js');
  ({ Role } = await import('../../src/domain/enums.js'));
  app = await h.makeApp();
});
afterAll(async () => {
  await app.close();
  if (before === undefined) delete process.env.ENTRA_ADMIN_GROUP_ID;
  else process.env.ENTRA_ADMIN_GROUP_ID = before;
});
beforeEach(async () => {
  await h.resetDb();
});

const claimsOf = (u: { entraOid: string; email: string; name: string }, groups: string[] = []) => ({
  oid: u.entraOid,
  email: u.email,
  name: u.name,
  groups,
});

describe('Entra girişinde kullanıcı eşleme', () => {
  it('devre dışı bırakılan kişi girişle yeniden açılmaz', async () => {
    const u = await h.createUser({ name: 'Eski Çalışan', active: false });
    const out = await entra.upsertUserFromClaims(claimsOf(u));
    expect(out.active).toBe(false);
  });

  it('yönetici grubundan çıkarılan kişi yöneticiliğini kaybeder', async () => {
    const d = await h.createDept('Bilgi Teknolojileri');
    const u = await h.createUser({ name: 'Eski Yönetici', role: Role.ADMIN, departmentId: d.id });
    await entra.upsertUserFromClaims(claimsOf(u, ['baska-grup']));
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.role).toBe(Role.TEAM_MEMBER);
  });

  it('grup listesi gelmezse yöneticiliğe dokunulmaz', async () => {
    const u = await h.createUser({ name: 'Yönetici', role: Role.ADMIN });
    await entra.upsertUserFromClaims(claimsOf(u, []));
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe(Role.ADMIN);
  });

  it('aynı e-postayla yeni Entra kimliği gelince eski satır kapanır, yenisi açılır', async () => {
    const old = await h.createUser({ name: 'Ayşe Kaya' });
    const out = await entra.upsertUserFromClaims({ oid: 'yeni-oid', email: old.email, name: 'Ayşe Kaya', groups: [] });
    expect(out.id).not.toBe(old.id);
    const prev = await h.prisma.user.findUniqueOrThrow({ where: { id: old.id } });
    expect(prev.active).toBe(false);
    expect(prev.email).not.toBe(old.email);
  });
});

describe('yazma isteklerinde köken kontrolü', () => {
  it('başka siteden gelen POST reddedilir', async () => {
    for (const headers of [
      { origin: 'https://kardes.example.com' },
      { 'sec-fetch-site': 'same-site', origin: 'https://kardes.example.com' },
      { 'sec-fetch-site': 'cross-site', origin: 'null' },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/auth/logout', headers });
      expect(res.statusCode, JSON.stringify(headers)).toBe(403);
    }
  });

  it('aynı sitedeki form gönderimi Origin "null" gelse de geçer (Referrer-Policy no-referrer)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout', headers: { 'sec-fetch-site': 'same-origin', origin: 'null' } });
    expect(res.statusCode).toBe(200);
  });

  it('uygulamanın kendi kökeninden ve Origin başlığı olmadan geçer', async () => {
    // İkincisi tünel: APP_URL localhost kalsa da tarayıcı tünel adresinden gelir.
    const tunnel = { host: 'ornek.trycloudflare.com', origin: 'https://ornek.trycloudflare.com' };
    for (const headers of [{ origin: 'http://localhost:3000' }, tunnel, {}]) {
      const res = await app.inject({ method: 'POST', url: '/auth/logout', headers });
      expect(res.statusCode).toBe(200);
    }
  });
});
