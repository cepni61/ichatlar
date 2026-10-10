import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { safeReturnTo } from '../auth/entra.js';
import { createSession, setSessionCookie } from '../auth/session.js';
import { upsertUserFromClaims } from '../auth/directory.js';
import { ldapLogin, ldapPolicy, type LdapFailure } from '../auth/ldap.js';

/**
 * Giriş sayfası: Active Directory girişi (kullanıcı adı + parola), test
 * yayını için erişim kapısı ve geliştirme ortamının kişi seçicisi.
 *
 * ACCESS_CODE doluysa (ör. uygulama Cloudflare tüneliyle internete açıldığında)
 * kodu girmeyen hiçbir isteğe — statik dosyalar dahil — cevap verilmez.
 * Çerez kodun kendisini değil özetini taşır; kod değişince eski çerezler düşer.
 */
const GATE_COOKIE = 'ih_gate';
const GATE_DAYS = 30;

const digest = (s: string) => createHash('sha256').update(s).digest();
const gateToken = () => digest('ih-gate|' + env.ACCESS_CODE).toString('hex');
const gateEnabled = () => env.ACCESS_CODE.length > 0;

function passedGate(req: FastifyRequest) {
  if (!gateEnabled()) return true;
  const raw = req.cookies[GATE_COOKIE];
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value === gateToken();
}

/** Kök düzeyde onRequest kancası: kapıdan geçmeyen istek /giris'e gider. */
export async function gateHook(req: FastifyRequest, reply: FastifyReply) {
  if (passedGate(req)) return;
  const pathname = req.url.split('?')[0] ?? '/';
  // Giriş sayfası kendi yazı tiplerini yükleyebilsin; yazı tipi dosyası veri taşımaz.
  if (pathname === '/giris' || pathname.startsWith('/fonts/')) return;
  if (pathname.startsWith('/api/')) {
    return reply.code(401).send({ error: { code: 'GATE', message: 'Erişim kodu gerekli.' } });
  }
  const returnTo = safeReturnTo(req.method === 'GET' ? req.url : '/');
  return reply.redirect('/giris?returnTo=' + encodeURIComponent(returnTo));
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ROLE_LABEL: Record<string, string> = {
  // "Yönetici" ekip yöneticisiyle karışıyordu; sistem yöneticisi bulunamıyordu.
  ADMIN: 'Sistem yöneticisi',
  MANAGER: 'Ekip yöneticisi',
  TEAM_MEMBER: 'Ekip üyesi',
  USER: 'Çalışan',
};

const LDAP_MESSAGE: Record<LdapFailure, string> = {
  credentials: 'Kullanıcı adı veya parola hatalı.',
  locked: 'Hesabınız çok sayıda hatalı deneme nedeniyle kilitlendi. Bir süre sonra tekrar deneyin ya da BT ile görüşün.',
  expired: 'Parolanızın süresi dolmuş. Windows\'ta parolanızı değiştirip tekrar deneyin.',
  disabled: 'Kurumsal hesabınız devre dışı. BT ile görüşün.',
  notFound: 'Hesabınız kurumsal dizinde bulunamadı. BT ile görüşün.',
  unavailable: 'Kimlik sunucusuna şu an ulaşılamıyor. Birkaç dakika sonra tekrar deneyin.',
};

async function renderPage(opts: { needCode: boolean; returnTo: string; error?: string; username?: string }) {
  const users = env.devAuth
    ? await prisma.user.findMany({
        where: { active: true },
        orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
        select: {
          email: true, name: true, role: true,
          department: { select: { name: true, order: true, parent: { select: { name: true, order: true } } } },
        },
      })
    : [];
  // Departman sırası, sonra ekip sırası, sonra ad (ekipler departmanlarının altında).
  users.sort((a, b) => {
    const ra = a.department?.parent?.order ?? a.department?.order ?? 1e9;
    const rb = b.department?.parent?.order ?? b.department?.order ?? 1e9;
    const ta = a.department?.parent ? a.department.order : 0;
    const tb = b.department?.parent ? b.department.order : 0;
    return ra - rb || ta - tb || a.name.localeCompare(b.name, 'tr');
  });

  // Kişiler departmanlarına göre gruplanır, yanlarında ekipleri yazar. Sistem
  // yöneticileri ayrı grupta ve en üstte: ekipsiz oldukları için sıralamada
  // listenin dibinde kalıyorlardı. Ekibi atanmamış diğer kişiler en sonda.
  const SYS = 'Sistem yönetimi';
  const NONE = 'Ekibi atanmamış';
  const groups = new Map<string, typeof users>([[SYS, []]]);
  for (const u of users) {
    const key = u.role === 'ADMIN' ? SYS : u.department?.parent?.name ?? u.department?.name ?? NONE;
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  const none = groups.get(NONE);
  if (none) { groups.delete(NONE); groups.set(NONE, none); }
  if (!groups.get(SYS)!.length) groups.delete(SYS);
  const options = [...groups]
    .map(
      ([dept, list]) =>
        `<optgroup label="${esc(dept)}">` +
        list
          .map((u) => {
            const team = u.role !== 'ADMIN' && u.department ? ` — ${esc(u.department.name)}` : '';
            return `<option value="${esc(u.email)}">${esc(u.name)}${team} · ${esc(ROLE_LABEL[u.role] ?? u.role)}</option>`;
          })
          .join('') +
        '</optgroup>',
    )
    .join('');

  const codeField = opts.needCode
    ? `<label for="code">Erişim kodu</label>
       <input id="code" name="code" type="password" autocomplete="off" required autofocus
              placeholder="Size iletilen kod">`
    : '';
  const ldapField = `<label for="username">Kullanıcı adı</label>
       <input id="username" name="username" autocomplete="username" required maxlength="128"
              ${opts.needCode ? '' : 'autofocus'} value="${esc(opts.username ?? '')}" placeholder="Windows kullanıcı adınız">
       <label for="password">Parola</label>
       <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256">
       <p class="hint">Bilgisayarınıza girerken kullandığınız kullanıcı adı ve parola.</p>`;
  const userField = env.ldapConfigured
    ? ldapField
    : env.devAuth
    ? `<label for="email">Kim olarak gireceksiniz?</label>
       <select id="email" name="email" required ${opts.needCode ? '' : 'autofocus'}>
         <option value="" disabled selected>Kullanıcı seçin</option>${options}
       </select>
       <p class="hint">Test ortamı: kullanıcılar örnek kişilerdir, parola sorulmaz.
       Rol değiştirmek için çıkış yapıp başka biriyle girin.</p>`
    : '';

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>İç Hatlar · Giriş</title>
<link rel="stylesheet" href="/fonts/fonts.css">
<style>
  /* Uygulamanın aydınlık temasıyla aynı marka: lacivert metin, mavi vurgu.
     (Eskiden yeşil "İH" rozetiyle başka bir ürün gibi açılıyordu.) */
  :root{--text:#12275c;--text-2:#3f4f75;--muted:#5f6b85;--line:#d6deec;--bg:#f6f8fc;
    --blue:#2563eb;--blue-2:#1d4ed8;--ring:rgba(37,99,235,.22);--danger:#b42318;--dangerbg:#fdeceb}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;
    font:15px/1.5 Inter,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--text);
    background:radial-gradient(900px 460px at 50% -8%,#e3ecfd 0%,rgba(227,236,253,0) 70%),var(--bg)}
  main{width:100%;max-width:400px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:30px 28px 26px;
    box-shadow:0 18px 44px rgba(18,39,92,.12),0 4px 12px rgba(18,39,92,.06)}
  .mark{display:flex;align-items:center;gap:12px;margin-bottom:22px}
  .mark svg{width:44px;height:44px;flex-shrink:0}
  .mark b{display:block;font-size:18px;font-weight:700;letter-spacing:-.015em}
  .mark small{display:block;font-size:12.5px;color:var(--muted);font-weight:500}
  h1{font-size:21px;letter-spacing:-.02em;margin:0 0 4px}
  .lead{color:var(--text-2);margin:0 0 20px}
  label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
  input,select{width:100%;font:inherit;color:inherit;padding:11px 12px;border:1px solid var(--line);
    border-radius:10px;background:#fff;outline:none}
  input:focus,select:focus{border-color:var(--blue);box-shadow:0 0 0 3px var(--ring)}
  .hint{font-size:12.5px;color:var(--muted);margin:8px 0 0}
  .err{background:var(--dangerbg);color:var(--danger);border-radius:10px;padding:9px 12px;font-size:13.5px;margin:0 0 6px}
  button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:10px;background:var(--blue);
    color:#fff;font:600 15px Inter,sans-serif;cursor:pointer}
  button:hover{background:var(--blue-2)}
  button:focus-visible{outline:3px solid var(--ring);outline-offset:2px}
</style>
</head>
<body>
<main>
  <div class="mark"><svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="50" cy="50" r="34" stroke="#2563eb" stroke-width="1.6" stroke-dasharray="3 3" opacity=".55"/><circle cx="50" cy="50" r="21" stroke="#3b82f6" stroke-width="3.4" opacity=".3"/><path d="M50 29V19M50 81V71M29 50H19M81 50H71M35.2 35.2l-7-7M64.8 64.8l7 7M64.8 35.2l7-7M35.2 64.8l-7 7" stroke="#2563eb" stroke-width="1.7" opacity=".5"/><circle cx="50" cy="16" r="11" fill="#fff" stroke="#2563eb" stroke-width="2.6"/><path d="M46.4 19.4c0-1.7 1.5-2.6 3.6-2.6s3.6.9 3.6 2.6M50 15.4a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8" fill="#2563eb"/><circle cx="76" cy="27" r="11" fill="#fff" stroke="#f59e0b" stroke-width="2.6"/><path d="M76 21.5a4 4 0 0 0-2.3 7.3v1.4h4.6v-1.4A4 4 0 0 0 76 21.5M74.4 32h3.2" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/><circle cx="84" cy="55" r="11" fill="#fff" stroke="#4caf3f" stroke-width="2.6"/><path d="M80 55.2l2.9 2.9 5.3-5.6" stroke="#4caf3f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="84" r="11" fill="#fff" stroke="#2563eb" stroke-width="2.6"/><path d="M46.6 78.6h5l2 2v6.8h-7z" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/><path d="M48.4 83h3.2M48.4 85.2h3.2" stroke="#2563eb" stroke-width="1.5" stroke-linecap="round"/><circle cx="18" cy="66" r="11" fill="#fff" stroke="#7c4ddb" stroke-width="2.6"/><circle cx="18" cy="66" r="2.6" stroke="#7c4ddb" stroke-width="2"/><path d="M18 60.4v-1.8M18 73.4v-1.8M23.6 66h1.8M10.6 66h1.8M21.9 62.1l1.3-1.3M12.8 71.2l1.3-1.3M21.9 69.9l1.3 1.3M12.8 60.8l1.3 1.3" stroke="#7c4ddb" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="31" r="11" fill="#fff" stroke="#0d9c92" stroke-width="2.6"/><path d="M13.4 34.4v-4M17 34.4v-7.6M20.6 34.4v-5.6" stroke="#0d9c92" stroke-width="2.4" stroke-linecap="round"/><circle cx="50" cy="50" r="14.5" fill="#12275c"/><path d="M43.5 44.5h13a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-5.2l-3.6 3.2v-3.2h-4.2a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2" fill="#fff"/><circle cx="46.6" cy="49.8" r="1.35" fill="#12275c"/><circle cx="50" cy="49.8" r="1.35" fill="#12275c"/><circle cx="53.4" cy="49.8" r="1.35" fill="#12275c"/></svg><div><b>İç Hatlar</b><small>Bilgi ve Öneri Sistemi${env.devAuth ? ' · test ortamı' : ''}</small></div></div>
  <h1>Giriş</h1>
  <p class="lead">${
    opts.needCode
      ? 'Devam etmek için size iletilen erişim kodunu girin.'
      : env.ldapConfigured ? 'Kurumsal hesabınızla giriş yapın.' : 'Devam etmek için kullanıcı seçin.'
  }</p>
  ${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ''}
  <form method="post" action="/giris">
    <input type="hidden" name="returnTo" value="${esc(opts.returnTo)}">
    ${codeField}
    ${userField}
    <button type="submit">Giriş yap</button>
  </form>
</main>
<script>
  // Ekran adres parçasında (#/kayit/KAY-…) durur ve sunucuya gelmez; form
  // gönderilince kaybolmasın diye dönüş adresine eklenir.
  (function () {
    var i = document.querySelector('input[name="returnTo"]');
    if (i && location.hash && i.value.indexOf('#') < 0) i.value += location.hash;
  })();
</script>
</body>
</html>`;
}

const postBody = z.object({
  code: z.string().optional(),
  email: z.string().email().optional(),
  username: z.string().max(128).optional(),
  password: z.string().max(256).optional(),
  returnTo: z.string().optional(),
});

export default async function gateRoutes(app: FastifyInstance) {
  // Sayfadaki düz HTML formu için; yalnızca bu eklentinin rotalarında geçerli.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  // Hız sınırına takılan kişi ham JSON değil giriş sayfasını görsün. Diğer
  // hatalar üstteki genel işleyiciye gider.
  app.setErrorHandler(async (err, req, reply) => {
    if ((err as { statusCode?: number }).statusCode !== 429) throw err;
    const page = await renderPage({
      needCode: !passedGate(req),
      returnTo: '/',
      error: 'Çok fazla deneme yapıldı. Bir dakika sonra tekrar deneyin.',
    });
    return reply.code(429).type('text/html; charset=utf-8').send(page);
  });

  app.get('/giris', async (req, reply) => {
    const returnTo = safeReturnTo((req.query as Record<string, unknown>)?.returnTo);
    const needCode = !passedGate(req);
    if (!needCode && req.user) return reply.redirect(returnTo);
    // Entra bağlıysa kapıdan sonra kimlik doğrulamayı Entra yapar.
    if (!needCode && !env.devAuth && !env.ldapConfigured) return reply.redirect('/auth/login?returnTo=' + encodeURIComponent(returnTo));
    return reply.type('text/html; charset=utf-8').send(await renderPage({ needCode, returnTo }));
  });

  app.post(
    '/giris',
    // Kod ve parola tahminini yavaşlat: IP başına dakikada 10 deneme.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = postBody.safeParse(req.body ?? {});
      const data = parsed.success ? parsed.data : {};
      const returnTo = safeReturnTo(data.returnTo);
      let needCode = !passedGate(req);
      const html = (error: string, status: number) =>
        renderPage({ needCode, returnTo, error, username: data.username }).then((page) =>
          reply.code(status).type('text/html; charset=utf-8').send(page),
        );

      if (needCode) {
        const ok = timingSafeEqual(digest((data.code ?? '').trim()), digest(env.ACCESS_CODE));
        if (!ok) {
          req.log.warn({ ip: req.ip }, 'hatalı erişim kodu');
          return html('Erişim kodu hatalı.', 401);
        }
        reply.setCookie(GATE_COOKIE, gateToken(), {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: env.httpsSite,
          signed: true,
          maxAge: GATE_DAYS * 24 * 60 * 60,
        });
        needCode = false; // kod doğruysa kullanıcı hatasında tekrar sorulmasın
      }

      if (env.ldapConfigured) {
        const out = await ldapLogin(data.username ?? '', data.password ?? '', req.log);
        if (!out.ok) {
          req.log.warn({ username: data.username, reason: out.reason, ip: req.ip }, 'AD girişi başarısız');
          return html(LDAP_MESSAGE[out.reason], out.reason === 'unavailable' ? 503 : 401);
        }
        const user = await upsertUserFromClaims(out.claims, ldapPolicy());
        if (!user.active) return html('Hesabınız İç Hatlar\'da devre dışı. Sistem yöneticisine başvurun.', 403);
        const session = await createSession(user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
        setSessionCookie(reply, session.id, session.expiresAt);
        req.log.info({ userId: user.id, email: out.claims.email }, 'giriş yapıldı (AD)');
        return reply.redirect(returnTo);
      }

      if (!env.devAuth) return reply.redirect('/auth/login?returnTo=' + encodeURIComponent(returnTo));

      const user = data.email
        ? await prisma.user.findUnique({
            where: { email: data.email.toLowerCase() },
            select: { id: true, active: true },
          })
        : null;
      if (!user || !user.active) return html('Listeden bir kullanıcı seçin.', 400);

      const session = await createSession(user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
      setSessionCookie(reply, session.id, session.expiresAt);
      req.log.warn({ email: data.email }, 'GELİŞTİRME girişi kullanıldı (giriş sayfası)');
      return reply.redirect(returnTo);
    },
  );
}
