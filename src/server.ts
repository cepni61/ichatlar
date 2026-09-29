import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { env } from './env.js';
import { prisma, disconnect } from './db.js';
import { attachUser } from './auth/guard.js';
import { AppError } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import bootstrapRoutes from './routes/bootstrap.js';
import recordRoutes from './routes/records.js';
import actionRoutes from './routes/actions.js';
import reportRoutes from './routes/reports.js';
import mlRoutes from './routes/ml.js';
import { startJobs } from './jobs/slaWatcher.js';
import { connectMl, disconnectMl } from './ml/db.js';
import { ensureModel, startMlJobs } from './ml/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');

const app = Fastify({
  logger: {
    level: env.isProd ? 'info' : 'debug',
    transport: env.isProd ? undefined : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
  },
  trustProxy: env.isProd,
  bodyLimit: 1024 * 1024,
});

await app.register(helmet, {
  // Arayüz tek dosya HTML; stiller ve betikler satır içi. Bu yüzden
  // 'unsafe-inline' gerekiyor. Arayüz parçalanınca CSP sıkılaştırılmalı.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      formAction: ["'self'", 'https://login.microsoftonline.com'],
      frameAncestors: ["'none'"],
    },
  },
});

await app.register(cookie, { secret: env.SESSION_SECRET });

await app.register(rateLimit, {
  max: 300,
  timeWindow: '1 minute',
  // Giriş uçları daha sıkı; kaba kuvvet denemesi pahalı olsun.
  keyGenerator: (req) => req.ip,
});

await app.register(fastifyStatic, { root: publicDir, index: ['index.html'] });

/** Her istekte oturumu çözüp req.user'a bağla. */
app.addHook('preHandler', attachUser);

/** Alan hatalarını HTTP'ye çevir; beklenmeyen hatalarda ayrıntı sızdırma. */
app.setErrorHandler((err: unknown, req, reply) => {
  if (err instanceof AppError) {
    return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
  }

  // Fastify doğrulama, gövde ayrıştırma ve hız sınırı hataları statusCode taşır.
  const status = (err as { statusCode?: unknown })?.statusCode;
  const message = err instanceof Error ? err.message : 'Geçersiz istek.';
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return reply.code(status).send({ error: { code: 'BAD_REQUEST', message } });
  }

  req.log.error({ err }, 'beklenmeyen hata');
  return reply.code(500).send({
    error: { code: 'INTERNAL', message: 'Beklenmeyen bir hata oluştu. Kayıt tutuldu.' },
  });
});

await app.register(authRoutes);
await app.register(bootstrapRoutes);
await app.register(recordRoutes);
await app.register(actionRoutes);
await app.register(reportRoutes);
await app.register(mlRoutes);

/**
 * Arayüz kimlik istiyor. API istekleri 401 döner (arayüz kendisi yönlendirir),
 * sayfa istekleri doğrudan girişe gider.
 */
app.get('/', async (req, reply) => {
  if (!req.user) return reply.redirect('/auth/login?returnTo=/');
  return reply.sendFile('index.html');
});

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
