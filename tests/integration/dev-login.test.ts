import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/*
 * Test ortamı (pilot) girişi. Entra yokken herkes sessizce varsayılan
 * kullanıcıyla açılıyordu: kişi listeden kendini seçmeyi unutursa kaydı
 * başkasının adına açıyordu. Artık giriş önce "Kim olarak gireceksiniz?"
 * seçicisine gider.
 *
 * env.ts içe aktarılırken okunur; geliştirme girişini bu dosyaya özel açmak
 * için değişken, uygulama dinamik olarak yüklenmeden ÖNCE verilir (vitest her
 * test dosyasını ayrı modül kaydıyla çalıştırır).
 */
process.env.DEV_AUTH_BYPASS = 'true';

let app: FastifyInstance;
let h: typeof import('./helpers.js');

beforeAll(async () => {
  h = await import('./helpers.js');
  app = await h.makeApp();
});
afterAll(async () => {
  await app.close();
});

describe('test ortamı girişi', () => {
  beforeEach(async () => {
    await h.resetDb();
  });

  it('oturumsuz giriş, varsayılan kullanıcıya değil kişi seçiciye gider', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/login?returnTo=%2F%23%2Fkayit%2FKAY-1' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/giris?returnTo=' + encodeURIComponent('/#/kayit/KAY-1'));
  });

  it('kişi seçici etkin kullanıcıları listeler', async () => {
    const d = await h.createDept('İnsan Kaynakları');
    await h.createUser({ name: 'Ayşe Kaya', departmentId: d.id });
    await h.createUser({ name: 'Pasif Kişi', departmentId: d.id, active: false });

    const res = await app.inject({ method: 'GET', url: '/giris' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Kim olarak gireceksiniz?');
    expect(res.body).toContain('Ayşe Kaya');
    expect(res.body).not.toContain('Pasif Kişi');
  });

  it('giriş formu adres parçasını (#/kayit/…) dönüş adresine ekler', async () => {
    // Parça sunucuya gelmez; form gönderilince kaybolmasın diye sayfa onu
    // gizli returnTo alanına kendisi ekler.
    const res = await app.inject({ method: 'GET', url: '/giris?returnTo=%2F' });
    expect(res.body).toContain('location.hash');
    expect(res.body).toMatch(/name="returnTo"/);
  });

  it('seçilen kişiyle oturum açar ve istenen sayfaya döner', async () => {
    const u = await h.createUser({ name: 'Ayşe Kaya' });
    const res = await app.inject({
      method: 'POST',
      url: '/giris',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ email: u.email, returnTo: '/#/kayit/KAY-1' }).toString(),
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/#/kayit/KAY-1');
    const { SESSION_COOKIE } = await import('../../src/auth/session.js');
    expect(String(res.headers['set-cookie'])).toContain(SESSION_COOKIE + '=');
  });
});
