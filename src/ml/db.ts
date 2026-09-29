import { createRequire } from 'node:module';
import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient as MlPrismaClient } from '.prisma/ml-client';

/**
 * ML veritabanı istemcisi — ana veritabanından AYRI (prisma/ml/schema.prisma).
 *
 * Neden createRequire: istemci node_modules/.prisma/ml-client altında üretilir
 * (npm nokta ile başlayan klasörü budamaz). Node'un ESM çözücüsü nokta ile
 * başlayan paket adını reddeder; CommonJS çözücüsü kabul eder. createRequire
 * hem `tsx` ile geliştirmede hem derlenmiş `dist` altında aynı yolu bulur,
 * çünkü node_modules proje kökünde duruyor.
 */
const require = createRequire(import.meta.url);

type MlModule = typeof import('.prisma/ml-client');

let client: MlPrismaClient | null = null;
let ready = false;

function load(): MlPrismaClient | null {
  if (client) return client;
  try {
    const { PrismaClient } = require('.prisma/ml-client') as MlModule;
    client = new PrismaClient({ log: ['warn', 'error'] });
    return client;
  } catch {
    return null;
  }
}

/**
 * Açılışta bir kez çağrılır. ML veritabanı yoksa ya da tablolar kurulmamışsa
 * uygulama DURMAZ: ekip önerisi yine bellekte eğitilen modelle çalışır,
 * yalnızca ML kayıtları yazılmaz. Ana iş akışını yardımcı bir depo yüzünden
 * kilitlemek yanlış olurdu.
 */
export async function connectMl(log: FastifyBaseLogger): Promise<boolean> {
  const c = load();
  if (!c) {
    log.warn('ML istemcisi üretilmemiş (`npm run ml:generate`). ML kayıtları tutulmayacak.');
    return (ready = false);
  }
  try {
    await c.modelVersion.count();
    ready = true;
    log.info('ML veritabanı bağlı');
  } catch (err) {
    ready = false;
    log.warn(
      { err: (err as Error).message },
      'ML veritabanına ulaşılamadı veya kurulmamış (`npm run ml:deploy`). ML kayıtları tutulmayacak.',
    );
  }
  return ready;
}

/** Hazırsa istemciyi, değilse null döner — çağıran taraf sessizce atlar. */
export function mlDb(): MlPrismaClient | null {
  return ready ? client : null;
}

export const mlReady = () => ready;

export async function disconnectMl() {
  if (client) await client.$disconnect();
}
