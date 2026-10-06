import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Test veritabanını her çalıştırmada sıfırdan kurar: dosyayı siler, göçleri
 * uygular. Tohum verisi YÜKLENMEZ — her test kendi kayıtlarını oluşturur, böylece
 * sonuç demo verisindeki bir değişiklikle kırılmaz.
 */
export default function setup() {
  const root = path.resolve(import.meta.dirname, '..', '..');
  for (const f of ['test.db', 'test.db-journal']) rmSync(path.join(root, 'var', f), { force: true });

  execSync('npx prisma migrate deploy', {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: 'file:../var/test.db' },
  });
}
