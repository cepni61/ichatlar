import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * Erişim kapısı (ACCESS_CODE) açıkken giriş sayfası kendi yazı tiplerini
 * yükleyebilmeli: kapı statik dosyaları da kapatıyordu, yazı tipleri uygulamaya
 * taşınınca giriş sayfası onlarsız açılırdı. Veri uçları kapalı kalır.
 *
 * env.ts içe aktarılırken okunur: değişken uygulama yüklenmeden önce verilir.
 */
// Test dosyaları aynı süreçte sırayla çalışır: değişken dosya bitince geri alınır.
const before = process.env.ACCESS_CODE;
process.env.ACCESS_CODE = 'deneme-kodu';

let app: FastifyInstance;
beforeAll(async () => {
  const h = await import('./helpers.js');
  app = await h.makeApp();
});
afterAll(async () => {
  await app.close();
  if (before === undefined) delete process.env.ACCESS_CODE;
  else process.env.ACCESS_CODE = before;
});

describe('erişim kapısı', () => {
  it('kod girilmeden yazı tipleri açık', async () => {
    const css = await app.inject({ method: 'GET', url: '/fonts/fonts.css' });
    expect(css.statusCode).toBe(200);
    const woff = await app.inject({ method: 'GET', url: '/fonts/inter-latin-wght-normal.woff2' });
    expect(woff.statusCode).toBe(200);
  });

  it('kod girilmeden veri uçları ve uygulama kapalı', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/bootstrap' })).statusCode).toBe(401);
    const js = await app.inject({ method: 'GET', url: '/api-store.js' });
    expect(js.statusCode).toBe(302);
  });

  it('giriş sayfası uygulamanın yazı tiplerini kullanır', async () => {
    const res = await app.inject({ method: 'GET', url: '/giris' });
    expect(res.body).toContain('/fonts/fonts.css');
    expect(res.body).not.toContain('fonts.googleapis.com');
  });
});
