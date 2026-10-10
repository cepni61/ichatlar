import { Issuer, generators, type Client } from 'openid-client';
import type { DirectoryClaims, DirectoryPolicy } from './directory.js';
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

export async function exchangeCode(
  currentUrl: string,
  tx: AuthTransaction,
): Promise<DirectoryClaims> {
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

/** Entra grupları: ekip ENTRA_USE_GROUPS ile, yönetici ENTRA_ADMIN_GROUP_ID ile. */
export const entraPolicy = (): DirectoryPolicy => ({
  useGroups: env.ENTRA_USE_GROUPS,
  adminGroup: env.ENTRA_ADMIN_GROUP_ID,
  managerGroup: '',
  authoritative: false,
});

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
