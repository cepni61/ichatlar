import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { attachUser } from './auth/guard.js';
import { AppError } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import bootstrapRoutes from './routes/bootstrap.js';
import recordRoutes from './routes/records.js';
import actionRoutes from './routes/actions.js';
import reportRoutes from './routes/reports.js';
import mlRoutes from './routes/ml.js';
import notificationRoutes from './routes/notifications.js';
import attachmentRoutes from './routes/attachments.js';
import kbRoutes from './routes/kb.js';
import feedbackRoutes from './routes/feedback.js';
import faqRoutes from './routes/faq.js';
import searchRoutes from './routes/search.js';
import { MAX_FILES } from './domain/attachments.js';
import gateRoutes, { gateHook } from './routes/gate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');

/**
 * Uygulamayı kurar ama dinlemeye başlamaz. Sunucu (server.ts) ve testler
 * aynı kurulumu kullanır; testler `app.inject()` ile port açmadan istek atar.
 * Veritabanı kontrolü, zamanlanmış işler ve ML hazırlığı burada DEĞİL —
 * onlar çalışan sürece ait, testte istenmez.
 */
export async function buildApp(opts: { logger?: FastifyServerOptions['logger'] } = {}) {
  const app = Fastify({
    logger: opts.logger ?? {
      level: env.isProd ? 'info' : 'debug',
      transport: env.isProd ? undefined : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
    },
    // Geliştirmede yalnızca aynı makinedeki vekile (Cloudflare tüneli) güven:
    // gerçek istemci IP'si hız sınırı ve kayıtlar için X-Forwarded-For'dan gelir.
    trustProxy: env.isProd ? true : 'loopback',
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

  // Ek dosyalar akış olarak okunur (belleğe toplanmaz). Sınırlar aşılırsa
  // istek reddedilir, yarım dosya diskte bırakılmaz (routes/attachments.ts).
  await app.register(multipart, {
    limits: { fileSize: env.maxUploadBytes, files: MAX_FILES, fields: 10, parts: MAX_FILES + 10 },
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Giriş uçları daha sıkı; kaba kuvvet denemesi pahalı olsun.
    keyGenerator: (req) => req.ip,
  });

  /** ACCESS_CODE doluysa her istek önce erişim kapısından geçer (statik dosyalar dahil). */
  app.addHook('onRequest', gateHook);

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

  await app.register(gateRoutes);
  await app.register(authRoutes);
  await app.register(bootstrapRoutes);
  await app.register(recordRoutes);
  await app.register(actionRoutes);
  await app.register(reportRoutes);
  await app.register(mlRoutes);
  await app.register(notificationRoutes);
  await app.register(attachmentRoutes);
  await app.register(kbRoutes);
  await app.register(feedbackRoutes);
  await app.register(faqRoutes);
  await app.register(searchRoutes);

  /**
   * Arayüz kimlik istiyor. API istekleri 401 döner (arayüz kendisi yönlendirir),
   * sayfa istekleri doğrudan girişe gider.
   */
  app.get('/', async (req, reply) => {
    if (!req.user) return reply.redirect('/auth/login?returnTo=/');
    return reply.sendFile('index.html');
  });

  return app;
}
