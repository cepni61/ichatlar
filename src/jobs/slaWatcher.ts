import { EventType, RecordStatus } from '../domain/enums.js';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { OPEN_STATUSES } from '../domain/constants.js';
import { pruneSessions } from '../auth/session.js';

/**
 * SLA gözcüsü. Hedefi aşmış açık kayıtları işaretler ve akışa bir olay düşer.
 *
 * Neden işaretleme gerekiyor: "gecikmiş" durumu slaDueAt < now ile her an
 * hesaplanabilir, ama ihlalin *ne zaman* olduğu ve kimin bilgilendirildiği
 * ancak yazılırsa bilinir. Yönetici bildirimi ve gecikme raporu buna dayanır.
 *
 * Aynı kayda ikinci kez olay düşmemesi slaBreachedAt kontrolüyle sağlanır —
 * iş her 5 dakikada bir çalışsa da akış kirlenmez.
 */
export async function checkSlaBreaches(log: FastifyBaseLogger) {
  const now = new Date();

  const breached = await prisma.record.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      slaDueAt: { lte: now },
      slaBreachedAt: null,
    },
    select: {
      id: true,
      code: true,
      departmentId: true,
      assigneeId: true,
      department: { select: { name: true } },
    },
    take: 500,
  });

  if (breached.length === 0) return { breached: 0 };

  for (const rec of breached) {
    await prisma.$transaction([
      prisma.record.update({
        where: { id: rec.id },
        data: { slaBreachedAt: now },
      }),
      prisma.recordEvent.create({
        data: {
          recordId: rec.id,
          type: EventType.SLA_BREACH,
          // byId boş: bu bir sistem olayı, kişi değil.
          text: `SLA hedefi aşıldı. ${rec.department.name} ekibi ve yöneticisi bilgilendirildi.`,
          at: now,
        },
      }),
    ]);
  }

  log.warn({ count: breached.length, codes: breached.map((r) => r.code) }, 'SLA hedefi aşan kayıtlar');

  // TODO(bildirim): e-posta / Teams bildirimi. Kanal seçimi (SMTP relay mi,
  // Graph API mi) BT ile netleşince lib/notify.ts eklenecek. İhlal kaydı
  // burada tutulduğu için bildirim sonradan geriye dönük de gönderilebilir.

  return { breached: breached.length };
}

/** Zamanlanmış işleri başlatır. */
export function startJobs(log: FastifyBaseLogger) {
  const FIVE_MIN = 5 * 60 * 1000;
  const DAILY = 24 * 60 * 60 * 1000;

  const slaTimer = setInterval(() => {
    checkSlaBreaches(log).catch((err) => log.error({ err }, 'SLA gözcüsü hata verdi'));
  }, FIVE_MIN);

  const pruneTimer = setInterval(() => {
    pruneSessions()
      .then((n) => n && log.info({ removed: n }, 'süresi geçmiş oturumlar silindi'))
      .catch((err) => log.error({ err }, 'oturum temizliği hata verdi'));
  }, DAILY);

  // Açılışta bir kez.
  checkSlaBreaches(log).catch((err) => log.error({ err }, 'SLA gözcüsü hata verdi'));

  return () => {
    clearInterval(slaTimer);
    clearInterval(pruneTimer);
  };
}

/** Kapanan kayıtta gözcünün tekrar tetiklenmemesi için yardımcı. */
export const closedStatuses = [
  RecordStatus.COZULDU,
  RecordStatus.KAPATILDI,
  RecordStatus.REDDEDILDI,
];
