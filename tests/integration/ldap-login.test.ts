import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Active Directory girişi. Gerçek AD yok: ldapts istemcisi sahte bir dizinle
 * değiştirilir (süzgeç sınıfları gerçek). Ayarlar env.ts içe aktarılmadan
 * ÖNCE verilir (bkz. dev-login.test.ts).
 */
const AD = vi.hoisted(() => ({
  /** bağlanma adı (küçük harf) → kişi */
  people: new Map<string, { password: string; data?: string; entry: Record<string, unknown> }>(),
  binds: [] as string[],
  down: false,
}));

vi.mock('ldapts', async (orig) => {
  const real = await orig<typeof import('ldapts')>();
  class Client {
    private who: string | null = null;
    async bind(name: string, password: string) {
      AD.binds.push(name);
      if (AD.down) throw new Error('connect ECONNREFUSED');
      const p = AD.people.get(name.toLowerCase());
      if (!p || p.password !== password || p.data) {
        const err = new Error(`80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data ${p?.data ?? '52e'}, v4563`);
        throw Object.assign(err, { code: 49 });
      }
      this.who = name.toLowerCase();
    }
    async search() {
      const p = this.who ? AD.people.get(this.who) : undefined;
      return { searchEntries: p ? [p.entry] : [], searchReferences: [] };
    }
    async unbind() {}
  }
  return { ...real, Client };
});

const keys = ['LDAP_URL', 'LDAP_DOMAIN', 'LDAP_BASE_DN', 'LDAP_ADMIN_GROUP', 'LDAP_MANAGER_GROUP'] as const;
const before = keys.map((k) => process.env[k]);
Object.assign(process.env, {
  LDAP_URL: 'ldaps://dc.test.local',
  LDAP_DOMAIN: 'TEST',
  LDAP_BASE_DN: 'DC=test,DC=local',
  LDAP_ADMIN_GROUP: 'IcHatlar-Sistem',
  LDAP_MANAGER_GROUP: 'CN=IcHatlar-Yoneticiler,OU=Gruplar,DC=test,DC=local',
});

let app: FastifyInstance;
let h: typeof import('./helpers.js');
let Role: typeof import('../../src/domain/enums.js').Role;

beforeAll(async () => {
  h = await import('./helpers.js');
  ({ Role } = await import('../../src/domain/enums.js'));
  app = await h.makeApp();
});
afterAll(async () => {
  await app.close();
  keys.forEach((k, i) => (before[i] === undefined ? delete process.env[k] : (process.env[k] = before[i])));
});
beforeEach(async () => {
  await h.resetDb();
  AD.people.clear();
  AD.binds.length = 0;
  AD.down = false;
});

const grp = (cn: string) => `CN=${cn},OU=Gruplar,DC=test,DC=local`;
function person(sam: string, groups: string[], extra: { password?: string; data?: string } = {}) {
  const entry = {
    dn: `CN=${sam},OU=Kisiler,DC=test,DC=local`,
    objectGUID: Buffer.from(sam.padEnd(16, '0').slice(0, 16)),
    mail: `${sam}@test.com.tr`,
    displayName: 'Ayşe Kaya',
    memberOf: groups,
  };
  AD.people.set(`test\\${sam}`.toLowerCase(), { password: extra.password ?? 'Parola-1', data: extra.data, entry });
  return entry;
}

// Giriş IP başına dakikada 10 deneme: her çağrı ayrı adresten (sınırın kendi testi aşağıda).
let ip = 0;
const login = (username: string, password = 'Parola-1', returnTo = '/#/kayit/KAY-1', remoteAddress = `10.9.0.${++ip % 250}`) =>
  app.inject({
    method: 'POST',
    url: '/giris',
    remoteAddress,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ username, password, returnTo }).toString(),
  });

async function teams() {
  const bt = await h.createDept('Bilgi Teknolojileri');
  const destek = await h.createDept('Destek', bt.id);
  await h.prisma.department.update({ where: { id: destek.id }, data: { entraGroupId: 'IcHatlar-BT-Destek' } });
  return { bt, destek };
}

describe('Active Directory girişi', () => {
  it('giriş sayfası kişi listesi değil kullanıcı adı ve parola sorar; /auth/login oraya gider', async () => {
    const page = (await app.inject({ method: 'GET', url: '/giris' })).body;
    expect(page).toContain('name="username"');
    expect(page).toContain('type="password"');
    expect(page).not.toContain('Kim olarak gireceksiniz?');
    expect(page).not.toContain('test ortamı');
    const res = await app.inject({ method: 'GET', url: '/auth/login?returnTo=%2F' });
    expect(res.headers.location).toBe('/giris?returnTo=%2F');
  });

  it('doğru parolayla oturum açılır; ekip ve yöneticilik AD gruplarından gelir', async () => {
    const { destek } = await teams();
    person('ayse.kaya', [grp('IcHatlar-BT-Destek'), grp('IcHatlar-Yoneticiler'), grp('Domain Admins')]);

    const res = await login('ayse.kaya');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/#/kayit/KAY-1');
    expect(AD.binds).toEqual(['TEST\\ayse.kaya']);
    const { SESSION_COOKIE } = await import('../../src/auth/session.js');
    expect(String(res.headers['set-cookie'])).toContain(SESSION_COOKIE + '=');

    const u = await h.prisma.user.findUniqueOrThrow({ where: { email: 'ayse.kaya@test.com.tr' } });
    expect(u).toMatchObject({ name: 'Ayşe Kaya', departmentId: destek.id, role: Role.MANAGER });
    expect(u.entraOid).toMatch(/^ad:[0-9a-f]{32}$/);
  });

  it('gruplar değişince bir sonraki girişte ekip ve rol de değişir', async () => {
    const { destek } = await teams();
    const e = person('ayse.kaya', [grp('IcHatlar-BT-Destek'), grp('IcHatlar-Yoneticiler')]);
    await login('ayse.kaya');

    e.memberOf = [grp('IcHatlar-BT-Destek')];
    await login('ayse.kaya');
    expect(await h.prisma.user.findFirstOrThrow()).toMatchObject({ departmentId: destek.id, role: Role.TEAM_MEMBER });

    e.memberOf = [grp('IcHatlar-Sistem')];
    await login('ayse.kaya');
    expect(await h.prisma.user.findFirstOrThrow()).toMatchObject({ departmentId: null, role: Role.ADMIN });

    e.memberOf = [];
    await login('ayse.kaya');
    expect(await h.prisma.user.findFirstOrThrow()).toMatchObject({ departmentId: null, role: Role.USER });
  });

  it('"ALAN\\ad" ve e-posta biçimi kabul edilir', async () => {
    const p = person('ayse.kaya', []);
    expect((await login('BASKA\\ayse.kaya')).statusCode).toBe(302);
    AD.people.set('ayse.kaya@test.local', { password: 'Parola-1', entry: p });
    expect((await login('ayse.kaya@test.local')).statusCode).toBe(302);
    expect(AD.binds).toEqual(['TEST\\ayse.kaya', 'ayse.kaya@test.local']);
    expect(await h.prisma.user.count()).toBe(1); // aynı kişi (objectGUID)
  });

  it('hatalı ya da boş parola, süzgeç karakterli ad: oturum yok; boş parola sunucuya hiç gitmez', async () => {
    person('ayse.kaya', []);
    const wrong = await login('ayse.kaya', 'yanlis');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toContain('Kullanıcı adı veya parola hatalı.');
    expect(wrong.body).toContain('value="ayse.kaya"'); // ad formda kalır
    expect(wrong.headers['set-cookie']).toBeUndefined();

    AD.binds.length = 0;
    // Boş parola AD'de kimliksiz bağlanma sayılır ve başarılı döner.
    expect((await login('ayse.kaya', '')).statusCode).toBe(401);
    expect((await login('*)(objectClass=*', 'x')).statusCode).toBe(401);
    expect(AD.binds).toEqual([]);
    expect(await h.prisma.user.count()).toBe(0);
  });

  it('kilitli ve parolası dolmuş hesap nedenini söyler; sunucu yoksa 503', async () => {
    person('kilitli', [], { data: '775' });
    expect((await login('kilitli')).body).toContain('kilitlendi');
    person('eski', [], { data: '532' });
    expect((await login('eski')).body).toContain('süresi dolmuş');
    AD.down = true;
    const res = await login('kilitli');
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('ulaşılamıyor');
  });

  it('aynı adresten dakikada 10\'dan fazla deneme reddedilir, sayfa olarak', async () => {
    person('ayse.kaya', []);
    for (let i = 0; i < 10; i++) expect((await login('ayse.kaya', 'yanlis', '/', '10.8.8.8')).statusCode).toBe(401);
    const res = await login('ayse.kaya', 'Parola-1', '/', '10.8.8.8');
    expect(res.statusCode).toBe(429);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Çok fazla deneme');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('İç Hatlar\'da devre dışı bırakılan kişi AD parolası doğru olsa da giremez', async () => {
    person('ayse.kaya', []);
    await login('ayse.kaya');
    await h.prisma.user.updateMany({ data: { active: false } });
    const res = await login('ayse.kaya');
    expect(res.statusCode).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
