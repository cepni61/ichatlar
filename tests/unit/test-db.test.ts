import { describe, expect, it } from 'vitest';
import { assertTestDatabase } from '../test-db.js';

describe('test veritabanı koruması', () => {
  it('adı _test ile biten veritabanını kabul eder', () => {
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5433/ichatlar_test?schema=public')).not.toThrow();
  });

  it('asıl veritabanını ve boş adresi reddeder', () => {
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5433/ichatlar?schema=public')).toThrow(/_test/);
    expect(() => assertTestDatabase('postgresql://u:p@db.kurum.local:5432/ichatlar_test_yedek')).toThrow();
    expect(() => assertTestDatabase(undefined)).toThrow();
  });
});
