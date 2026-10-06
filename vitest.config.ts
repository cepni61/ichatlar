import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/test-db.js';

/**
 * İki katman:
 *   unit        → tests/unit — veritabanı yok, saf iş kuralları (yetki, geçişler).
 *   integration → tests/integration — gerçek Fastify + ayrı bir PostgreSQL test
 *                 veritabanı (ichatlar_test). Asıl veriye dokunmaz; her
 *                 çalıştırmada sıfırlanır.
 *
 * Test veritabanı varsayılan olarak yerel gömülü PostgreSQL'dedir (gerekirse
 * global-setup başlatır). Başka bir sunucu için TEST_DATABASE_URL verin —
 * içindeki veritabanı her çalıştırmada SİLİNİP yeniden kurulur.
 *
 * Ortam değişkenleri env.ts içe aktarılmadan önce burada verilir; env.ts
 * .env dosyasını okusa da zaten tanımlı değişkenleri ezmez.
 */
const testEnv = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: TEST_DATABASE_URL,
  ML_DATABASE_URL: 'file:../../var/test-ml.db',
  SESSION_SECRET: 'test-only-secret-test-only-secret-test-only-secret',
  DEV_AUTH_BYPASS: '',
  ACCESS_CODE: '',
  ENTRA_TENANT_ID: '',
  ENTRA_CLIENT_ID: '',
  ENTRA_CLIENT_SECRET: '',
};

export default defineConfig({
  test: {
    env: testEnv,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          // Tek SQLite dosyası paylaşılıyor: dosyalar tek süreçte sırayla çalışsın.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 20000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
