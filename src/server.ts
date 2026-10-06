import { env } from './env.js';
import { prisma, disconnect } from './db.js';
import { buildApp } from './app.js';
import { startJobs } from './jobs/slaWatcher.js';
import { connectMl, disconnectMl } from './ml/db.js';
import { ensureModel, startMlJobs } from './ml/service.js';

const app = await buildApp();

// Bağlantı kontrolü zamanlanmış işlerden ÖNCE: veritabanı yoksa SLA gözcüsü
// anlamsız hata yığmadan çıkıyoruz.
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  app.log.error(
    'Veritabanına bağlanılamadı (' +
      env.DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@') +
      '). `docker compose up -d` çalıştırıp DATABASE_URL değerini kontrol edin.',
  );
  process.exit(1);
}

const stopJobs = startJobs(app.log);

// ML veritabanı ayrı ve yardımcı: bağlanamazsa uygulama yine açılır.
// Model açılışta bir kez hazırlanır (veri değişmediyse ML veritabanından yüklenir).
await connectMl(app.log);
await ensureModel(app.log).catch((err) => app.log.error({ err }, 'ML modeli hazırlanamadı'));
const stopMlJobs = startMlJobs(app.log);

async function shutdown(signal: string) {
  app.log.info({ signal }, 'kapatılıyor');
  stopJobs();
  stopMlJobs();
  await app.close();
  await disconnect();
  await disconnectMl();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.PORT, host: '0.0.0.0' });

if (env.devAuth) {
  app.log.warn(
    `Geliştirme girişi açık: ${env.APP_URL}/auth/dev-login?email=omer.uygun@ornek.com ` +
      `(kullanıcılar: ${env.APP_URL}/auth/dev-users)`,
  );
}
