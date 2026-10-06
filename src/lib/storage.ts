import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { env } from '../env.js';

/**
 * Ek dosyaların diskte saklanması. Dosya içeriği veritabanına girmez; satırda
 * yalnızca depolama anahtarı durur.
 *
 * Anahtar sunucuda üretilir (yıl/ay/rastgele-kimlik). Kullanıcının verdiği dosya
 * adı diske HİÇ yansımaz: yol geçişi (../), aynı adla üzerine yazma ve
 * çalıştırılabilir uzantı sorunları baştan olmaz. Ad yalnızca veritabanında,
 * indirmede gösterilmek için tutulur.
 *
 * S3 / Azure Blob'a geçilecekse bu dosyanın üç fonksiyonu değişir; çağıran kod aynı kalır.
 */

const root = () => path.resolve(env.STORAGE_DIR);

/** Anahtarı mutlak yola çevirir; kök dışına çıkan anahtarı reddeder. */
function resolveKey(key: string): string {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error('Geçersiz depolama anahtarı');
  return full;
}

/** Akışı diske yazar, anahtar ve gerçek boyutu döner. */
export async function saveStream(stream: Readable): Promise<{ key: string; size: number }> {
  const now = new Date();
  const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const key = `${dir}/${randomUUID()}`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await pipeline(stream, createWriteStream(full, { flags: 'wx' }));
  const { size } = await stat(full);
  return { key, size };
}

export function openStream(key: string): Readable {
  return createReadStream(resolveKey(key));
}

export async function remove(key: string): Promise<void> {
  await rm(resolveKey(key), { force: true });
}
