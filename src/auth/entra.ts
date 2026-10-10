import { Issuer, generators, type Client } from 'openid-client';
import { Role } from '../domain/enums.js';
import { prisma } from '../db.js';
import { env } from '../env.js';

/**
 * Microsoft Entra ID ile kurumsal giriş — OIDC yetkilendirme kodu akışı,
 * PKCE ile.
 *
 * BT'den istenecekler .env.example içinde listelidir. Redirect URI
 * `${APP_URL}/auth/callback` ile birebir aynı olmak zorundadır.
 */

let clientPromise: Promise<Client> | null = null;

function discoveryUrl() {
  return `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0/.well-known/openid-configuration`;
}

export async function entraClient(): Promise<Client> {
  if (!env.entraConfigured) throw new Error('Entra ID yapılandırılmamış');
  if (!clientPromise) {
    clientPromise = Issuer.discover(discoveryUrl()).then(
      (issuer) =>
        new issuer.Client({
          client_id: env.ENTRA_CLIENT_ID,
          client_secret: env.ENTRA_CLIENT_SECRET,
          redirect_uris: [`${env.APP_URL}/auth/callback`],
          response_types: ['code'],
        }),
    ).catch((e) => {
      // Geçici ağ hatası kalıcı olmasın: sonraki giriş keşfi yeniden dener.
      clientPromise = null;
      throw e;
    });
  }
  return clientPromise;
}

export interface AuthTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

/**
 * state / nonce / code_verifier istemci tarafında değil, kısa ömürlü imzalı
 * bir çerezde taşınır. Sunucu belleğinde tutmak çok örnekli dağıtımda
 * (birden fazla pod) çalışmazdı.
 */
export function newTransaction(returnTo: string): AuthTransaction {
  return {
    state: generators.state(),
    nonce: generators.nonce(),
    codeVerifier: generators.codeVerifier(),
    returnTo,
  };
}

export async function authorizationUrl(tx: AuthTransaction) {
  const client = await entraClient();
  return client.authorizationUrl({
    scope: 'openid profile email',
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: generators.codeChallenge(tx.codeVerifier),
    code_challenge_method: 'S256',
    // Kullanıcının tarayıcıda zaten açık kurumsal hesabı varsa sessiz geçer.
    response_mode: 'query',
  });
}

export interface EntraClaims {
  oid: string;
  email: string;
  name: string;
  groups: string[];
}

export async function exchangeCode(
  currentUrl: string,
  tx: AuthTransaction,
): Promise<EntraClaims> {
  const client = await entraClient();

  const params = client.callbackParams(currentUrl);
  const tokenSet = await client.callback(`${env.APP_URL}/auth/callback`, params, {
    state: tx.state,
    nonce: tx.nonce,
    code_verifier: tx.codeVerifier,
  });

  const claims = tokenSet.claims();

  const oid = (claims.oid as string | undefined) ?? claims.sub;
  const email =
    (claims.email as string | undefined) ??
    (claims.preferred_username as string | undefined) ??
    '';
  const name = (claims.name as string | undefined) ?? email;

  if (!oid) throw new Error('Kimlik belirteci oid içermiyor');
  if (!email) throw new Error('Kimlik belirteci e-posta içermiyor');

  const groups = Array.isArray(claims.groups) ? (claims.groups as string[]) : [];

  return { oid, email: email.toLowerCase(), name, groups };
}

/**
 * Kullanıcı ilk girişte oluşturulur, sonraki girişlerde ad/e-posta tazelenir.
 * Kimliğin anahtarı oid — e-posta değişse bile aynı kullanıcı kalır.
 *
 * Rol ve departman:
 *  - ENTRA_USE_GROUPS açıksa grup kimlikleri Department.entraGroupId ile
 *    eşleştirilir, eşleşen kullanıcı o ekibin üyesi olur.
 *  - Kapalıysa kullanıcı departmansız ve USER rolüyle açılır; yönetici
 *    ekranından atanır. Yetkinin sessizce genişlemesi bundan iyidir.
 */
export async function upsertUserFromClaims(claims: EntraClaims) {
  let departmentId: string | null = null;
  let role: Role = Role.USER;

  if (env.ENTRA_USE_GROUPS && claims.groups.length) {
    const dept = await prisma.department.findFirst({
      where: { entraGroupId: { in: claims.groups }, active: true },
      select: { id: true },
    });
    if (dept) {
      departmentId = dept.id;
      role = Role.TEAM_MEMBER;
    }
  }

  if (env.ENTRA_ADMIN_GROUP_ID && claims.groups.includes(env.ENTRA_ADMIN_GROUP_ID)) {
    role = Role.ADMIN;
  }

  const existing = await prisma.user.findUnique({
    where: { entraOid: claims.oid },
    select: { id: true, role: true, departmentId: true },
  });

  // Yönetici grubu tanımlı ve belirteç grupları taşıyorsa yöneticilik gruptan
  // gelir: gruptan çıkarılan kişi bir sonraki girişte yöneticiliğini kaybeder.
  // Grup listesi boşsa (çok grup → Entra listeyi göndermez) dokunulmaz.
  const leftAdminGroup =
    !!env.ENTRA_ADMIN_GROUP_ID && claims.groups.length > 0 && !claims.groups.includes(env.ENTRA_ADMIN_GROUP_ID);

  if (existing) {
    // Elle verilmiş rolü ve departmanı ezmiyoruz: yönetici birine MANAGER
    // dediyse her girişte TEAM_MEMBER'a düşmesi doğru olmaz. Devre dışı
    // bırakılan kişi girişle yeniden açılmaz.
    const demoted = existing.role === Role.ADMIN && leftAdminGroup;
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        email: await freeEmail(claims.email, existing.id),
        name: claims.name,
        lastLoginAt: new Date(),
        ...(existing.departmentId == null && departmentId ? { departmentId } : {}),
        ...(existing.role === Role.USER && role !== Role.USER ? { role } : {}),
        ...(demoted ? { role: existing.departmentId ? Role.TEAM_MEMBER : role } : {}),
      },
      select: { id: true, active: true },
    });
  }

  return prisma.user.create({
    data: {
      entraOid: claims.oid,
      email: await freeEmail(claims.email, null),
      name: claims.name,
      role,
      departmentId,
      lastLoginAt: new Date(),
    },
    select: { id: true, active: true },
  });
}

/**
 * E-posta benzersiz; aynı adres başka bir Entra kimliğindeyse (işten ayrılıp
 * yeniden gelen, adresi devralınan kişi) eski satır kapatılır ve adresi
 * boşaltılır. Eski kayıtların sahibi olarak geçmişte kalır.
 */
async function freeEmail(email: string, selfId: string | null) {
  const other = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (other && other.id !== selfId) {
    await prisma.user.update({
      where: { id: other.id },
      data: { email: `${email}#eski-${other.id}`, active: false },
    });
  }
  return email;
}

/** Dönüş adresinin açık yönlendirme (open redirect) olmadığını doğrular. */
export function safeReturnTo(value: unknown): string {
  // "/\evil.com" tarayıcıda "//evil.com" gibi yorumlanır; ters bölü de reddedilir.
  // Tarayıcı sekme/satır sonunu adresten siler: "/\t/evil.com" → "//evil.com".
  if (
    typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') ||
    value.includes('\\') || /[\x00-\x1f\x7f]/.test(value)
  ) {
    return '/';
  }
  return value;
}
