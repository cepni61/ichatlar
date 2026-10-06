import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

/**
 * PostgreSQL'e özgü iki davranış tek yerde: harf duyarsız arama ve satır kilidi.
 * Uygulama yalnızca PostgreSQL destekler (bkz. prisma/schema.prisma).
 */

/**
 * Harf duyarsız "içeriyor" süzgeci (ILIKE). Türkçe harflerin ("İZİN" = "izin")
 * doğru eşleşmesi veritabanının tr-TR ICU yerel ayarıyla kurulmasına bağlıdır —
 * kurulum belgesindeki CREATE DATABASE komutu bunu yapar.
 */
export function containsFilter(value: string): Prisma.StringFilter {
  return { contains: value, mode: 'insensitive' };
}

/**
 * Kaydı yazma işlemi süresince kilitler: iki kişi aynı anda "Üzerime Al"
 * derse yalnızca biri kazanır (`SELECT … FOR UPDATE`).
 * Kaydın var olup olmadığını da doğrular; yoksa null döner.
 */
export async function lockRecordByCode(
  tx: Prisma.TransactionClient,
  code: string,
): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Record" WHERE code = ${code} FOR UPDATE
  `;
  return rows[0] ?? null;
}

/** JSON alanlar metin kolonda saklanır; yazarken metne çevrilir, okurken geri. */
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

export { prisma };
