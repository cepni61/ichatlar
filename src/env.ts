import { existsSync } from 'node:fs';
import { z } from 'zod';
import { envFlag } from './lib/flag.js';
import { parseWorkHours } from './domain/work-hours.js';

/**
 * .env dosyasını ek bağımlılık olmadan yükler (Node ≥ 20.12 yerleşik
 * process.loadEnvFile). Betikte `--env-file` bayrağını unutmak ya da
 * komutu elle çalıştırmak yapılandırmayı sessizce boş bırakmasın diye
 * yükleme kodun içinde yapılır. Zaten tanımlı değişkenler ezilmez.
 */
const loadEnvFile = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
if (typeof loadEnvFile === 'function' && existsSync('.env')) {
  try {
    loadEnvFile('.env');
  } catch {
    // Bozuk .env sunucuyu durdurmasın; aşağıdaki doğrulama zaten uyarır.
  }
}

/**
 * Ortam değişkenleri açılışta doğrulanır. Eksik bir ayarla ayağa kalkıp
 * ilk istekte patlamak yerine, sunucu hiç başlamaz.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Sunucunun dinlediği adres. 0.0.0.0: ağdaki diğer bilgisayarlar da
   * erişir (http://<ip>:3000). 127.0.0.1: yalnızca bu bilgisayar ve aynı
   * makinedeki tünel (Cloudflare) erişir.
   */
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),

  /** Ayrı ML veritabanı (prisma/ml/schema.prisma). Yol o dosyaya göre çözülür. */
  ML_DATABASE_URL: z.string().min(1).default('file:../../var/ichatlar-ml.db'),
  ML_RETRAIN_MINUTES: z.coerce.number().int().positive().default(30),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET en az 32 karakter olmalı'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),

  ENTRA_TENANT_ID: z.string().default(''),
  ENTRA_CLIENT_ID: z.string().default(''),
  ENTRA_CLIENT_SECRET: z.string().default(''),
  ENTRA_USE_GROUPS: envFlag(false),
  ENTRA_ADMIN_GROUP_ID: z.string().default(''),

  /**
   * Active Directory girişi (Entra yerine). LDAP_URL doluysa kişi giriş
   * sayfasında Windows kullanıcı adı ve parolasıyla girer; ekip ve rol AD
   * gruplarından gelir (bkz. src/auth/ldap.ts).
   */
  LDAP_URL: z
    .string()
    .trim()
    .default('')
    .refine((v) => !v || /^ldaps?:\/\/[^\s/]+\/?$/i.test(v), 'ldaps://sunucu:636 biçiminde olmalı'),
  /** Etki alanının kısa (NetBIOS) adı: kullanıcı "ECZACIBASI\ad" olarak bağlanır. */
  LDAP_DOMAIN: z.string().trim().default(''),
  /** Kişinin aranacağı kök, ör. DC=eczacibasi,DC=local */
  LDAP_BASE_DN: z.string().trim().default(''),
  /** Bu AD grubundakiler sistem yöneticisi olur (grubun adı ya da DN'i). */
  LDAP_ADMIN_GROUP: z.string().trim().default(''),
  /** Bu AD grubundakiler, üyesi oldukları ekibin yöneticisi olur. */
  LDAP_MANAGER_GROUP: z.string().trim().default(''),

  DEV_AUTH_BYPASS: envFlag(false),

  /** Kuruluşun adı — arayüzde başlıkta ve alt bilgide görünür. Boşsa yalnızca ürün adı. */
  ORG_NAME: z.string().trim().max(80).default(''),

  /** Doluysa uygulamaya girmeden önce bu kod sorulur (internete açık test yayını). */
  ACCESS_CODE: z.string().trim().default(''),

  /** Kurumsal arama kaynağı (Cortex). Boşsa arama yalnızca Bilgi Bankası ve kayıtlarla çalışır. */
  CORTEX_URL: z.string().trim().default(''),
  CORTEX_TOKEN: z.string().trim().default(''),
  CORTEX_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),

  /** Çözülen kayıt, açan kişi bu kadar mesai saati yanıt vermezse kendiliğinden kapanır; 0 = kapalı. */
  AUTO_CLOSE_HOURS: z.coerce.number().int().min(0).max(240).default(4),
  /** Mesai saatleri (hafta içi, İstanbul saati). */
  WORK_HOURS: z.string().trim().default('08:00-17:00').refine((v) => {
    try { parseWorkHours(v); return true; } catch { return false; }
  }, 'SS:DD-SS:DD biçiminde olmalı, başlangıç bitişten önce (ör. 08:00-17:00)'),

  STORAGE_DIR: z.string().default('./var/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(10),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  console.error('Ortam değişkenleri geçersiz:\n' + lines.join('\n'));
  process.exit(1);
}

const raw = parsed.data;

// Prisma ML istemcisi adresi doğrudan process.env'den okur; .env'de satır
// yoksa varsayılan buradan gitsin.
process.env.ML_DATABASE_URL ??= raw.ML_DATABASE_URL;

const isProd = raw.NODE_ENV === 'production';
const entraConfigured = Boolean(raw.ENTRA_TENANT_ID && raw.ENTRA_CLIENT_ID && raw.ENTRA_CLIENT_SECRET);
const ldapConfigured = Boolean(raw.LDAP_URL);
/** Çerezlerin Secure işareti ve HTTPS başlıkları buna bağlı: ilk kurulum HTTP olabilir. */
const httpsSite = raw.APP_URL.startsWith('https://');

const fail = (message: string) => {
  console.error(message);
  process.exit(1);
};
if (ldapConfigured && (!raw.LDAP_DOMAIN || !raw.LDAP_BASE_DN)) fail('LDAP_URL doluyken LDAP_DOMAIN ve LDAP_BASE_DN zorunludur.');
if (ldapConfigured && entraConfigured) fail('Giriş için ya Entra ya LDAP ayarlanmalı, ikisi birden değil.');
// Üretimde kurumsal giriş zorunlu, geliştirme kısayolu kapalı.
if (isProd && !entraConfigured && !ldapConfigured) {
  fail('Üretimde giriş yöntemi zorunlu: LDAP_URL (Active Directory) ya da ENTRA_TENANT_ID/CLIENT_ID/CLIENT_SECRET.');
}
if (isProd && ldapConfigured && !httpsSite) {
  console.warn('UYARI: APP_URL https değil; Windows parolaları tarayıcıdan sunucuya şifresiz gider.');
}
if (isProd && raw.LDAP_URL.toLowerCase().startsWith('ldap://')) {
  console.warn('UYARI: LDAP_URL ldap:// ile başlıyor; parolalar etki alanı denetleyicisine şifresiz gider. ldaps:// kullanın.');
}

export const env = {
  ...raw,
  isProd,
  entraConfigured,
  ldapConfigured,
  httpsSite,
  /** Geliştirme girişi yalnızca üretim dışında ve kurumsal giriş yokken açılır. */
  devAuth: !isProd && !entraConfigured && !ldapConfigured && raw.DEV_AUTH_BYPASS,
  maxUploadBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
  workDay: parseWorkHours(raw.WORK_HOURS),
  sessionTtlMs: raw.SESSION_TTL_HOURS * 60 * 60 * 1000,
} as const;

export type Env = typeof env;
