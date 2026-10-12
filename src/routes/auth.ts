import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import {
  authorizationUrl,
  entraPolicy,
  exchangeCode,
  newTransaction,
  safeReturnTo,
  type AuthTransaction,
} from '../auth/entra.js';
import { upsertUserFromClaims } from '../auth/directory.js';
import {
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
  SESSION_COOKIE,
} from '../auth/session.js';
import { badRequest, forbidden } from '../lib/errors.js';

const TX_COOKIE = 'ih_txn';

export default async function authRoutes(app: FastifyInstance) {
  /** Girişi başlatır: Entra'ya ya da giriş sayfasına (AD, test ortamı) yönlendirir. */
  app.get('/auth/login', async (req, reply) => {
    const returnTo = safeReturnTo((req.query as Record<string, unknown>)?.returnTo);

    if (env.ldapConfigured || env.devAuth) {
      // AD'de kullanıcı adı ve parola giriş sayfasında sorulur. Test ortamında
      // kişi kim olduğunu kendisi seçer: eskiden herkes sessizce varsayılan
      // kullanıcıyla açılıyor, seçmeyi unutan kaydını başkasının adına açıyordu.
      return reply.redirect('/giris?returnTo=' + encodeURIComponent(returnTo));
    }

    if (!env.entraConfigured) {
      // Yapılandırma yoksa sessizce başarısız olmak yerine ne yapılacağını söyle.
      return reply.code(503).type('text/plain; charset=utf-8').send(
        'Entra ID yapılandırılmamış. .env içinde ENTRA_TENANT_ID, ENTRA_CLIENT_ID ve ' +
          'ENTRA_CLIENT_SECRET doldurulmalı.' +
          (env.devAuth ? '\n\nGeliştirme için: /auth/dev-login?email=...' : ''),
      );
    }

    const tx = newTransaction(returnTo);

    // state/nonce/verifier kısa ömürlü imzalı çerezde taşınır; sunucu
    // belleğinde tutmak çok örnekli dağıtımda çalışmaz.
    reply.setCookie(TX_COOKIE, JSON.stringify(tx), {
      path: '/auth',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.httpsSite,
      signed: true,
      maxAge: 600,
    });

    return reply.redirect(await authorizationUrl(tx));
  });

  /** Entra geri dönüşü: kodu belirteçle değiş, kullanıcıyı eşle, oturum aç. */
  app.get('/auth/callback', async (req, reply) => {
    const raw = req.cookies[TX_COOKIE];
    if (!raw) throw badRequest('Giriş akışı zaman aşımına uğradı, tekrar deneyin.');

    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) throw badRequest('Giriş akışı doğrulanamadı.');

    let tx: AuthTransaction;
    try {
      tx = JSON.parse(unsigned.value) as AuthTransaction;
    } catch {
      throw badRequest('Giriş akışı okunamadı.');
    }
    reply.clearCookie(TX_COOKIE, { path: '/auth' });

    const url = `${env.APP_URL}${req.url}`;
    const claims = await exchangeCode(url, tx);
    const user = await upsertUserFromClaims(claims, entraPolicy());
    // Oturum açılsa da attachUser kapalı hesabı tanımaz; giriş döngüye girerdi.
    if (!user.active) throw forbidden('Hesabınız devre dışı. Sistem yöneticisine başvurun.');

    const session = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, session.id, session.expiresAt);

    app.log.info({ userId: user.id, email: claims.email }, 'giriş yapıldı');
    return reply.redirect(safeReturnTo(tx.returnTo));
  });

  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) await revokeSession(unsigned.value);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  /**
   * Geliştirme girişi. Entra uygulama kaydı beklemeden çalışmak için.
   * env.devAuth yalnızca NODE_ENV=production dışında true olabilir.
   */
  if (env.devAuth) {
    // Arayüzdeki kullanıcı seçici e-posta bilmez (bootstrap e-posta paylaşmaz),
    // kimlikle gelir; elle giriş için e-posta da kabul edilir.
    const q = z
      .object({ email: z.string().email().optional(), userId: z.string().min(1).optional(), returnTo: z.string().optional() })
      .refine((v) => v.email || v.userId);

    app.get('/auth/dev-login', async (req, reply) => {
      const parsed = q.safeParse(req.query);
      if (!parsed.success) throw badRequest('email veya userId parametresi gerekli.');

      const user = await prisma.user.findUnique({
        where: parsed.data.userId
          ? { id: parsed.data.userId }
          : { email: parsed.data.email!.toLowerCase() },
        select: { id: true, active: true, email: true },
      });
      if (!user || !user.active) throw badRequest('Bu e-postayla kullanıcı yok. Önce `npm run db:seed`.');

      const session = await createSession(user.id, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
      setSessionCookie(reply, session.id, session.expiresAt);
      app.log.warn({ email: user.email }, 'GELİŞTİRME girişi kullanıldı');
      return reply.redirect(safeReturnTo(parsed.data.returnTo));
    });

    /** Prototipteki kullanıcı değiştirme kutusunun karşılığı. */
    app.get('/auth/dev-users', async () => {
      const users = await prisma.user.findMany({
        where: { active: true },
        orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
        select: {
          email: true,
          name: true,
          role: true,
          department: { select: { name: true } },
        },
      });
      return { users };
    });
  }
}
