import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { EventType, RecordStatus } from '../domain/enums.js';
import { lockRecordByCode, toJsonText } from '../lib/dialect.js';

/**
 * Çözülmüş kayıt, açan kişi süresinde (mesai saatiyle) kapatmaz ya da yeniden
 * açmazsa sistem tarafından kapatılır (kullanıcı isteği, 2026-10-12). Süre
 * çözümde yazılır (Record.autoCloseAt); bu kuraldan önce çözülmüş kayıtlarda
 * boş olduğu için onlara dokunulmaz.
 */
export async function autoCloseResolved(log: FastifyBaseLogger): Promise<number> {
  const due = await prisma.record.findMany({
    where: { status: RecordStatus.COZULDU, autoCloseAt: { lte: new Date() } },
    select: { code: true },
    take: 200,
  });
  let closed = 0;
  for (const { code } of due) {
    const done = await prisma.$transaction(async (tx) => {
      // Açan tam bu anda yeniden açıyorsa onun işlemi geçerli olsun: kilitten sonra yeniden bakılır.
      if (!(await lockRecordByCode(tx, code))) return false;
      const now = new Date();
      const r = await tx.record.findUnique({ where: { code }, select: { id: true, status: true, autoCloseAt: true } });
      if (!r || r.status !== RecordStatus.COZULDU || !r.autoCloseAt || r.autoCloseAt > now) return false;
      await tx.record.update({
        where: { id: r.id },
        data: { status: RecordStatus.KAPATILDI, closedAt: now, autoCloseAt: null, updatedAt: now },
      });
      await tx.recordEvent.create({
        data: {
          recordId: r.id, type: EventType.STATUS, at: now, byId: null,
          fromStatus: RecordStatus.COZULDU, toStatus: RecordStatus.KAPATILDI, meta: { auto: true },
          text: 'Açan kişi süresinde yanıt vermediği için kayıt kendiliğinden kapatıldı.',
        },
      });
      await tx.auditLog.create({
        data: { actorId: null, action: 'record.autoClose', entity: 'Record', entityId: r.id, after: toJsonText({ status: RecordStatus.KAPATILDI }) },
      });
      return true;
    });
    if (done) closed++;
  }
  if (closed) log.info({ closed }, 'çözülmüş kayıtlar kendiliğinden kapatıldı');
  return closed;
}
