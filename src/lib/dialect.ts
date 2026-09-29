import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

/**
 * Veritabanı lehçesi arasındaki iki gerçek farkı tek yerde toplar. Şemanın
 * geri kalanı zaten taşınabilir; PostgreSQL'e geçerken schema.prisma'daki
 * provider satırı ve DATABASE_URL dışında değişecek yer burası değil — burası
 * ikisini de zaten biliyor.
 */
export type Dialect = 'sqlite' | 'postgresql';

/** DATABASE_URL biçiminden anlaşılır: `file:` → SQLite. */
export const dialect: Dialect = (process.env.DATABASE_URL ?? '').startsWith('file:')
  ? 'sqlite'
  : 'postgresql';

/**
 * Harf duyarsız "içeriyor" süzgeci.
 *
 * PostgreSQL'de `mode: 'insensitive'` gerekir. SQLite bu argümanı hiç
 * tanımaz ve hata verir; onun yerine LIKE zaten ASCII için duyarsızdır.
 *
 * Uyarı: SQLite'ın yerleşik LIKE'ı Türkçe harflerde duyarsız DEĞİL — "İZİN"
 * ile "izin" eşleşmez. Arama alanı bu yüzden kullanıcı girdisini olduğu gibi
 * ve küçük harfe çevrilmiş hâliyle iki kez dener. PostgreSQL'e geçince
 * `mode: 'insensitive'` bunu doğru şekilde halleder.
 */
export function containsFilter(value: string): { contains: string } {
  // Dönüş tipi bilinçli olarak dar: SQLite istemci tipinde `mode` alanı yok,
  // PostgreSQL'de ise gerekli. Cast yalnızca bu farkı köprülemek için.
  if (dialect === 'postgresql') {
    return { contains: value, mode: 'insensitive' } as unknown as { contains: string };
  }
  return { contains: value };
}

/** SQLite için: aynı alanda hem verilen hâli hem küçük harfli hâli denenir. */
export function containsVariants(value: string): string[] {
  if (dialect === 'postgresql') return [value];
  const lower = value.toLocaleLowerCase('tr-TR');
  const upper = value.toLocaleUpperCase('tr-TR');
  return [...new Set([value, lower, upper])];
}

/**
 * Kaydı yazma işlemi süresince kilitler.
 *
 * PostgreSQL'de `SELECT … FOR UPDATE` gerekir: iki kişi aynı anda "Üzerime Al"
 * derse yalnızca biri kazanmalı. SQLite'ta bu sözdizimi yok ama gerek de yok —
 * SQLite tek yazar modelidir, işlem boyunca veritabanı zaten serileştirilir.
 *
 * Kaydın var olup olmadığını da doğrular; yoksa null döner.
 */
export async function lockRecordByCode(
  tx: Prisma.TransactionClient,
  code: string,
): Promise<{ id: string } | null> {
  if (dialect === 'postgresql') {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Record" WHERE code = ${code} FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  const row = await tx.record.findUnique({ where: { code }, select: { id: true } });
  return row ?? null;
}

/** JSON alanları lehçeden bağımsız tutmak için metne çevirip geri okur. */
export const toJsonText = (value: unknown): string | null =>
  value === undefined || value === null ? null : JSON.stringify(value);

export const fromJsonText = <T = unknown>(text: string | null): T | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

/** Açılışta bir kez günlüğe yazılır — hangi veritabanında olduğumuz belli olsun. */
export function describeDialect(): string {
  return dialect === 'sqlite'
    ? 'SQLite (dosya tabanlı, geliştirme/deneme)'
    : 'PostgreSQL';
}

export { prisma };
