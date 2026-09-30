import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { safeReturnTo } from '../auth/entra.js';
import { createSession, setSessionCookie } from '../auth/session.js';

/**
 * Test yayını için erişim kapısı ve geliştirme giriş sayfası.
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
  if (pathname === '/giris') return;
  if (pathname.startsWith('/api/')) {
    return reply.code(401).send({ error: { code: 'GATE', message: 'Erişim kodu gerekli.' } });
  }
  const returnTo = safeReturnTo(req.method === 'GET' ? req.url : '/');
  return reply.redirect('/giris?returnTo=' + encodeURIComponent(returnTo));
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Yönetici',
  MANAGER: 'Ekip yöneticisi',
  TEAM_MEMBER: 'Ekip üyesi',
  USER: 'Çalışan',
};

async function renderPage(opts: { needCode: boolean; returnTo: string; error?: string }) {
  const users = env.devAuth
    ? await prisma.user.findMany({
        where: { active: true },
        orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
        select: { email: true, name: true, role: true, department: { select: { name: true } } },
      })
    : [];

  // Kişiler ekiplerine göre gruplanır; ekibi olmayanlar en üstte.
  const groups = new Map<string, typeof users>();
  for (const u of users) {
    const key = u.department?.name ?? 'Genel';
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  const options = [...groups]
    .map(
      ([dept, list]) =>
        `<optgroup label="${esc(dept)}">` +
        list
          .map((u) => `<option value="${esc(u.email)}">${esc(u.name)} · ${esc(ROLE_LABEL[u.role] ?? u.role)}</option>`)
          .join('') +
        '</optgroup>',
    )
    .join('');

  const codeField = opts.needCode
    ? `<label for="code">Erişim kodu</label>
       <input id="code" name="code" type="password" autocomplete="off" required autofocus
              placeholder="Size iletilen kod">`
    : '';
  const userField = env.devAuth
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--em-900:#04372c;--em-800:#065f46;--em-700:#047857;--em-600:#059669;--em-100:#d1fae5;--em-50:#ecfdf5;
    --text:#0d2620;--text-2:#3f5b53;--muted:#6f8880;--line:rgba(6,95,70,.14);--danger:#c92a2a;--dangerbg:#fdeceb}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;
    font:15px/1.5 Inter,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--text);
    background:linear-gradient(160deg,var(--em-900) 0%,var(--em-700) 42%,#e9f6f0 42.1%,#fff 100%)}
  main{width:100%;max-width:400px;background:#fff;border-radius:20px;padding:32px 28px 26px;
    box-shadow:0 24px 60px rgba(3,43,33,.22),0 3px 10px rgba(3,43,33,.08)}
  .mark{display:flex;align-items:center;gap:10px;margin-bottom:22px}
  .mark span{width:34px;height:34px;border-radius:10px;background:var(--em-700);color:#fff;
    display:grid;place-items:center;font-weight:700;letter-spacing:-.02em}
  .mark b{font-size:17px;letter-spacing:-.015em}
  .mark small{display:block;font-size:12px;color:var(--muted);font-weight:500}
  h1{font-size:21px;letter-spacing:-.02em;margin:0 0 4px}
  .lead{color:var(--text-2);margin:0 0 20px}
  label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
  input,select{width:100%;font:inherit;color:inherit;padding:11px 12px;border:1px solid var(--line);
    border-radius:10px;background:#fff;outline:none}
  input:focus,select:focus{border-color:var(--em-600);box-shadow:0 0 0 3px rgba(5,150,105,.15)}
  .hint{font-size:12.5px;color:var(--muted);margin:8px 0 0}
  .err{background:var(--dangerbg);color:var(--danger);border-radius:10px;padding:9px 12px;font-size:13.5px;margin:0 0 6px}
  button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:10px;background:var(--em-700);
    color:#fff;font:600 15px Inter,sans-serif;cursor:pointer}
  button:hover{background:var(--em-800)}
  button:focus-visible{outline:3px solid var(--em-100);outline-offset:2px}
</style>
</head>
<body>
<main>
  <div class="mark"><span>İH</span><div><b>İç Hatlar</b><small>Bilgi ve öneri kayıtları · test</small></div></div>
  <h1>Giriş</h1>
  <p class="lead">${opts.needCode ? 'Devam etmek için size iletilen erişim kodunu girin.' : 'Devam etmek için kullanıcı seçin.'}</p>
  ${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ''}
  <form method="post" action="/giris">
    <input type="hidden" name="returnTo" value="${esc(opts.returnTo)}">
    ${codeField}
    ${userField}
    <button type="submit">Giriş yap</button>
  </form>
</main>
</body>
</html>`;
}

const postBody = z.object({
  code: z.string().optional(),
  email: z.string().email().optional(),
  returnTo: z.string().optional(),
});

export default async function gateRoutes(app: FastifyInstance) {
  // Sayfadaki düz HTML formu için; yalnızca bu eklentinin rotalarında geçerli.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  app.get('/giris', async (req, reply) => {
    const returnTo = safeReturnTo((req.query as Record<string, unknown>)?.returnTo);
    const needCode = !passedGate(req);
    if (!needCode && req.user) return reply.redirect(returnTo);
    // Entra bağlıysa kapıdan sonra kimlik doğrulamayı Entra yapar.
    if (!needCode && !env.devAuth) return reply.redirect('/auth/login?returnTo=' + encodeURIComponent(returnTo));
    return reply.type('text/html; charset=utf-8').send(await renderPage({ needCode, returnTo }));
  });

  app.post(
    '/giris',
    // Kod tahminini yavaşlat: IP başına dakikada 10 deneme.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = postBody.safeParse(req.body ?? {});
      const data = parsed.success ? parsed.data : {};
      const returnTo = safeReturnTo(data.returnTo);
      let needCode = !passedGate(req);
      const html = (error: string, status: number) =>
        renderPage({ needCode, returnTo, error }).then((page) =>
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
          secure: env.isProd || req.protocol === 'https',
          signed: true,
          maxAge: GATE_DAYS * 24 * 60 * 60,
        });
        needCode = false; // kod doğruysa kullanıcı hatasında tekrar sorulmasın
      }

      if (!env.devAuth) return reply.redirect('/auth/login?returnTo=' + encodeURIComponent(returnTo));

      const user = data.email
        ? await prisma.user.findUnique({
            where: { email: data.email.toLocaleLowerCase('tr-TR') },
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
