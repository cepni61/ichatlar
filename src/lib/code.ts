import type { Prisma } from '@prisma/client';

/**
 * Kayıt numarası: KAY-2026-0001, yıl bazlı sıfırlanır.
 *
 * Sayaç veritabanında tutulur ve artırma kaydın oluşturulmasıyla aynı
 * işlemin içinde yapılır. `upsert` + `increment` atomiktir; iki kullanıcı
 * aynı anda kayıt açtığında aynı numarayı almazlar. Uygulama tarafında
 * "en büyük numarayı bul, bir ekle" yaklaşımı bu garantiyi vermez.
 */
export async function nextRecordCode(tx: Prisma.TransactionClient, now = new Date()): Promise<string> {
  const year = now.getFullYear();

  const counter = await tx.counter.upsert({
    where: { year },
    create: { year, seq: 1 },
    update: { seq: { increment: 1 } },
    select: { seq: true },
  });

  return `KAY-${year}-${String(counter.seq).padStart(4, '0')}`;
}
