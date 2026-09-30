import { existsSync } from 'node:fs';
import { z } from 'zod';

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
  ENTRA_USE_GROUPS: z.coerce.boolean().default(false),
  ENTRA_ADMIN_GROUP_ID: z.string().default(''),

  DEV_AUTH_BYPASS: z.coerce.boolean().default(false),

  /** Doluysa uygulamaya girmeden önce bu kod sorulur (internete açık test yayını). */
  ACCESS_CODE: z.string().trim().default(''),

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

// Üretimde Entra zorunlu, geliştirme kısayolu kapalı.
if (isProd && !entraConfigured) {
  console.error('Üretimde ENTRA_TENANT_ID, ENTRA_CLIENT_ID ve ENTRA_CLIENT_SECRET zorunludur.');
  process.exit(1);
}

export const env = {
  ...raw,
  isProd,
  entraConfigured,
  /** Geliştirme girişi yalnızca üretim dışında ve Entra yokken açılır. */
  devAuth: !isProd && raw.DEV_AUTH_BYPASS,
  maxUploadBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
  sessionTtlMs: raw.SESSION_TTL_HOURS * 60 * 60 * 1000,
} as const;

export type Env = typeof env;
