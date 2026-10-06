/**
 * Testlerin kullandığı veritabanı adresi — tek yerde.
 *
 * Varsayılan: yerel gömülü PostgreSQL'deki ichatlar_test. Başka bir sunucu için
 * TEST_DATABASE_URL verin. Testler her testten önce tüm tabloları boşaltır; bu
 * yüzden veritabanı adı "_test" ile bitmek ZORUNDA (assertTestDatabase).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://ichatlar:ichatlar-local@localhost:5433/ichatlar_test?schema=public';

/**
 * Yanlış ayarla (ör. .env'deki asıl veritabanına düşülürse) testlerin gerçek
 * veriyi silmesini engeller.
 */
export function assertTestDatabase(url: string | undefined) {
  const name = url ? new URL(url).pathname.replace(/^\//, '') : '';
  if (!name.endsWith('_test')) {
    throw new Error(
      `Testler yalnızca adı "_test" ile biten veritabanında çalışır; verilen: "${name || '(boş)'}". ` +
        'TEST_DATABASE_URL değerini kontrol edin.',
    );
  }
}
