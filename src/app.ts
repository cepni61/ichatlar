import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { attachUser } from './auth/guard.js';
import { AppError, forbidden } from './lib/errors.js';
import { ipKey } from './lib/ip.js';
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
import searchRoutes from './routes/search.js';
import grantRoutes from './routes/grants.js';
import { MAX_FILES } from './domain/attachments.js';
import gateRoutes, { gateHook } from './routes/gate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');

/**
 * Arayüz sürümü: arayüz dosyalarının özeti. Her yanıtta x-ih-build başlığıyla
 * gider; açık sayfa bunun değiştiğini görünce "yeni sürüm — yenile" der.
 * (Sunucu yeni arayüzle yeniden başladığında açık sekmeler saatlerce eski
 * kodla çalışmaya devam ediyordu.) Yalnızca arayüz değişince değişir.
 */
function uiBuild() {
  const h = createHash('sha256');
  for (const f of ['index.html', 'api-store.js', 'modules.js', 'theme.js']) {
    try { h.update(readFileSync(path.join(publicDir, f))); } catch { /* dosya yoksa atla */ }
  }
  return h.digest('hex').slice(0, 12);
}

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
    // Gerçek istemci IP'si hız sınırı ve kayıtlar için X-Forwarded-For'dan
    // gelir. Yalnızca en yakın vekilin eklediği değere güvenilir (`true` en
    // soldakini, yani istemcinin kendi yazdığını alırdı). Geliştirmede vekil
    // aynı makinedeki Cloudflare tüneli.
    trustProxy: env.isProd ? (_addr: string, hop: number) => hop === 0 : 'loopback',
    bodyLimit: 1024 * 1024,
  });

  // Kurum içi ağda düz HTTP ile (ör. http://10.8.7.71:3000) yayın yapılabiliyor.
  // HTTPS'e zorlayan başlıklar orada betikleri ve API çağrılarını https://'e
  // yükseltip kırıyor; arayüz sunucusuz prototip verisine düşüyordu. Bu yüzden
  // yalnızca APP_URL https ise açılırlar.
  const httpsSite = env.httpsSite;

  await app.register(helmet, {
    strictTransportSecurity: httpsSite,
    crossOriginOpenerPolicy: httpsSite,
    // Arayüz tek dosya HTML; stiller ve betikler satır içi. Bu yüzden
    // 'unsafe-inline' gerekiyor. Arayüz parçalanınca CSP sıkılaştırılmalı.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        // Yazı tipleri uygulamadan gelir (public/fonts): dış kaynağa izin yok.
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        formAction: ["'self'", 'https://login.microsoftonline.com'],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: httpsSite ? [] : null,
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
    keyGenerator: (req) => ipKey(req.ip),
  });

  const build = uiBuild();
  app.addHook('onSend', async (_req, reply) => { reply.header('x-ih-build', build); });

  // Çapraz site istek sahteciliği: oturum çerezi SameSite=Lax, ama kardeş alt
  // alan adları "aynı site" sayılır ve çerezi taşır. Güncel tarayıcılar
  // Sec-Fetch-Site gönderir; yoksa Origin'e bakılır. Origin "null" olabilir:
  // Referrer-Policy no-referrer iken aynı sitedeki form gönderimi de öyle
  // gelir. Başlık hiç yoksa istek tarayıcıdan değildir (çerez de taşımaz).
  const appOrigin = new URL(env.APP_URL).origin;
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    const ok = site
      ? site === 'same-origin' || site === 'none'
      : !origin || origin === 'null' || origin === appOrigin || (URL.canParse(origin) && new URL(origin).host === req.host);
    if (!ok) throw forbidden('Başka bir siteden gelen istek reddedildi.');
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
  await app.register(searchRoutes);
  await app.register(grantRoutes);

  /**
   * Arayüz kimlik istiyor. API istekleri 401 döner (arayüz kendisi yönlendirir),
   * sayfa istekleri doğrudan girişe gider.
   */
  app.get('/', async (req, reply) => {
    // Ekran adres çubuğunda "#/kayit/KAY-…" olarak durur ve parça sunucuya
    // gelmez. Düz yönlendirme Entra dönüşünde onu kaybediyordu; küçük bir
    // sayfa parçayı returnTo'ya ekleyip girişe gönderir.
    if (!req.user) {
      return reply.type('text/html; charset=utf-8').send(
        '<!doctype html><meta charset="utf-8"><title>İç Hatlar</title>' +
          '<script>location.replace("/auth/login?returnTo=" + encodeURIComponent("/" + location.hash));</script>' +
          '<noscript><a href="/auth/login?returnTo=/">Giriş yap</a></noscript>',
      );
    }
    return reply.sendFile('index.html');
  });

  return app;
}
