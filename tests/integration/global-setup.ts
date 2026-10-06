import { execSync } from 'node:child_process';
import path from 'node:path';
import { startLocalPostgres, stopLocalPostgres } from '../../scripts/local-db.js';
import { assertTestDatabase, TEST_DATABASE_URL } from '../test-db.js';

/**
 * Test veritabanını hazırlar: eksik göçleri uygular (`migrate deploy`;
 * veritabanı yoksa oluşturur). Veri silmez — tablolar her testten önce
 * helpers.ts → resetDb ile boşaltılır. Tohum verisi yüklenmez.
 *
 * Adres vitest.config.ts'teki test.env'den DEĞİL, doğrudan test-db.ts'ten
 * alınır: test.env yalnızca test işçilerine uygulanır, bu hazırlık adımına
 * geçmez. O değer olmasa Prisma .env'deki asıl veritabanına düşerdi.
 *
 * TEST_DATABASE_URL verilmemişse yerel gömülü PostgreSQL kullanılır; kapalıysa
 * burada açılır ve testler bitince yeniden kapatılır.
 */
export default function setup() {
  assertTestDatabase(TEST_DATABASE_URL);
  const root = path.resolve(import.meta.dirname, '..', '..');
  const startedHere = process.env.TEST_DATABASE_URL ? false : startLocalPostgres();

  execSync('npx prisma migrate deploy', {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  return () => {
    if (startedHere) stopLocalPostgres();
  };
}
