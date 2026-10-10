import type { FastifyBaseLogger } from 'fastify';
import { AndFilter, Client, EqualityFilter } from 'ldapts';
import { env } from '../env.js';
import type { DirectoryClaims, DirectoryPolicy } from './directory.js';

/**
 * Active Directory ile giriş. Kişi kendi kullanıcı adı ve parolasıyla
 * bağlanır (hizmet hesabı gerekmez), aynı bağlantıyla kendi kaydını okur:
 * e-posta, ad, objectGUID ve doğrudan üyesi olduğu gruplar (memberOf).
 *
 * Ekip ve rol her girişte AD gruplarından yeniden hesaplanır: BT kişiyi
 * gruptan çıkarınca bir sonraki girişte uygulamada da düşer.
 *
 * ldaps:// sertifikası kurumun kendi sertifika otoritesinden imzalıdır;
 * servis Node'u `--use-system-ca` ile başlatır (Windows sertifika deposu).
 */
export const ldapPolicy = (): DirectoryPolicy => ({
  useGroups: true,
  adminGroup: env.LDAP_ADMIN_GROUP,
  managerGroup: env.LDAP_MANAGER_GROUP,
  authoritative: true,
});

export type LdapFailure = 'credentials' | 'locked' | 'expired' | 'disabled' | 'notFound' | 'unavailable';

/**
 * "ouygun", "ECZACIBASI\ouygun" ya da "ouygun@eczacibasi.local". Karakterler
 * sınırlı: bağlanma adına ve arama süzgecine kullanıcı metni karışmasın.
 */
export function parseLogin(input: string) {
  const s = input.trim();
  const name = s.slice(s.lastIndexOf('\\') + 1);
  if (name.includes('@')) {
    return /^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,190}$/.test(name)
      ? { bindName: name, attribute: 'userPrincipalName', value: name }
      : null;
  }
  return /^[A-Za-z0-9._-]{1,64}$/.test(name)
    ? { bindName: `${env.LDAP_DOMAIN}\\${name}`, attribute: 'sAMAccountName', value: name }
    : null;
}

/** AD hata iletisindeki "data 775" alt kodu nedeni söyler. */
function failureOf(err: unknown): LdapFailure {
  if ((err as { code?: number }).code !== 49) return 'unavailable';
  const data = /data ([0-9a-f]{3})/i.exec(String((err as Error).message))?.[1]?.toLowerCase();
  if (data === '775') return 'locked';
  if (data === '532' || data === '773') return 'expired';
  if (data === '533' || data === '701') return 'disabled';
  return 'credentials';
}

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export async function ldapLogin(
  input: string,
  password: string,
  log: FastifyBaseLogger,
): Promise<{ ok: true; claims: DirectoryClaims } | { ok: false; reason: LdapFailure }> {
  const login = parseLogin(input);
  // Boş parola AD'de "kimliksiz bağlanma" sayılır ve BAŞARILI döner: sunucuya hiç gitmez.
  if (!login || !password) return { ok: false, reason: 'credentials' };

  const client = new Client({ url: env.LDAP_URL, timeout: 8000, connectTimeout: 5000, strictDN: false });
  try {
    try {
      await client.bind(login.bindName, password);
    } catch (err) {
      const reason = failureOf(err);
      if (reason === 'unavailable') log.error({ err }, 'LDAP sunucusuna bağlanılamadı');
      return { ok: false, reason };
    }

    const { searchEntries } = await client.search(env.LDAP_BASE_DN, {
      scope: 'sub',
      filter: new AndFilter({
        filters: [
          new EqualityFilter({ attribute: 'objectClass', value: 'user' }),
          new EqualityFilter({ attribute: login.attribute, value: login.value }),
        ],
      }),
      attributes: ['objectGUID', 'mail', 'userPrincipalName', 'displayName', 'cn', 'memberOf'],
      explicitBufferAttributes: ['objectGUID'],
      sizeLimit: 2,
    });
    const e = searchEntries.length === 1 ? searchEntries[0]! : null;
    const guid = e && (first(e.objectGUID) as Buffer | undefined);
    const email = e ? String(first(e.mail) ?? first(e.userPrincipalName) ?? '').toLowerCase() : '';
    if (!e || !guid || !email) return { ok: false, reason: 'notFound' };

    return {
      ok: true,
      claims: {
        oid: 'ad:' + guid.toString('hex'),
        email,
        name: String(first(e.displayName) ?? first(e.cn) ?? login.value),
        groups: ([] as unknown[]).concat(e.memberOf ?? []).map(String),
      },
    };
  } catch (err) {
    log.error({ err }, 'LDAP araması başarısız');
    return { ok: false, reason: 'unavailable' };
  } finally {
    await client.unbind().catch(() => {});
  }
}
