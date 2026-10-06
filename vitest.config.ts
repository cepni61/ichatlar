import { defineConfig } from 'vitest/config';

/**
 * İki katman:
 *   unit        → tests/unit — veritabanı yok, saf iş kuralları (yetki, geçişler).
 *   integration → tests/integration — gerçek Fastify + ayrı bir SQLite test
 *                 veritabanı (var/test.db). Asıl veriye (var/ichatlar.db) dokunmaz.
 *
 * Ortam değişkenleri env.ts içe aktarılmadan önce burada verilir; env.ts
 * .env dosyasını okusa da zaten tanımlı değişkenleri ezmez.
 */
const testEnv = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  // SQLite yolu schema.prisma dosyasına göre çözülür: ../var = proje kökündeki var/
  DATABASE_URL: 'file:../var/test.db',
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
