import { EventType, NotificationType } from '../domain/enums.js';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { OPEN_STATUSES } from '../domain/constants.js';
import { pruneSessions } from '../auth/session.js';
import { notifySlaBreach } from '../lib/notify.js';
import { pruneDraftAttachments } from '../routes/attachments.js';
import { expireGrants } from '../routes/grants.js';

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
      department2Id: true,
      assigneeId: true,
      department: { select: { name: true } },
      department2: { select: { name: true } },
    },
    take: 500,
  });

  if (breached.length === 0) return { breached: 0 };

  let notified = 0;
  for (const rec of breached) {
    // İşaret, akış olayı ve bildirimler tek işlemde: biri yazılıp diğeri
    // kalırsa ya bildirimsiz ihlal ya da ihlalsiz bildirim oluşurdu.
    notified += await prisma.$transaction(async (tx) => {
      // Koşullu işaret: iki gözcü aynı anda çalışırsa olay ikinci kez düşmez.
      const marked = await tx.record.updateMany({ where: { id: rec.id, slaBreachedAt: null }, data: { slaBreachedAt: now } });
      if (marked.count === 0) return 0;
      const count = await notifySlaBreach(tx, rec);
      const teams = rec.department2 ? `${rec.department.name} ve ${rec.department2.name} ekiplerinden` : `${rec.department.name} ekibinden`;
      await tx.recordEvent.create({
        data: {
          recordId: rec.id,
          type: EventType.SLA_BREACH,
          // byId boş: bu bir sistem olayı, kişi değil.
          text: count
            ? `Hedef süre aşıldı. ${teams} ${count} kişiye bildirim gönderildi.`
            : `Hedef süre aşıldı. ${rec.department.name} ekibinde bildirilecek etkin kullanıcı bulunamadı.`,
          at: now,
        },
      });
      return count;
    });
  }

  log.warn(
    { count: breached.length, notified, codes: breached.map((r) => r.code) },
    'SLA hedefi aşan kayıtlar',
  );

  // E-posta / Teams eklenecekse kaynak Notification tablosu (bkz. lib/notify.ts).

  return { breached: breached.length, notified };
}

/**
 * Bildirim tablosundan önce işaretlenmiş, hâlâ açık ve gecikmiş kayıtlar için
 * eksik bildirimleri tamamlar. Akışa olay düşmez (ihlal olayı zaten var).
 * Tekrar çalışması zararsız: notifySlaBreach aynı kişiye ikinci kez yazmaz.
 */
export async function backfillSlaNotifications(log: FastifyBaseLogger) {
  const missing = await prisma.record.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      slaBreachedAt: { not: null },
      notifications: { none: { type: NotificationType.SLA_BREACH } },
    },
    select: { id: true, code: true, departmentId: true, department2Id: true, assigneeId: true },
    take: 500,
  });
  let notified = 0;
  for (const rec of missing) {
    notified += await prisma.$transaction((tx) => notifySlaBreach(tx, rec));
  }
  if (missing.length) log.info({ records: missing.length, notified }, 'eksik SLA bildirimleri tamamlandı');
  return { records: missing.length, notified };
}

/** Zamanlanmış işleri başlatır. */
export function startJobs(log: FastifyBaseLogger) {
  const FIVE_MIN = 5 * 60 * 1000;
  const DAILY = 24 * 60 * 60 * 1000;

  const slaTimer = setInterval(() => {
    checkSlaBreaches(log).catch((err) => log.error({ err }, 'SLA gözcüsü hata verdi'));
    // Süreli yetkiler (vekâlet): süresi dolan kaldırılır, etkin rol düzelir.
    expireGrants(log).catch((err) => log.error({ err }, 'yetki süresi işi hata verdi'));
  }, FIVE_MIN);

  const pruneTimer = setInterval(() => {
    pruneSessions()
      .then((n) => n && log.info({ removed: n }, 'süresi geçmiş oturumlar silindi'))
      .catch((err) => log.error({ err }, 'oturum temizliği hata verdi'));
    pruneDraftAttachments()
      .then((n) => n && log.info({ removed: n }, 'gönderilmemiş taslak ekler silindi'))
      .catch((err) => log.error({ err }, 'taslak ek temizliği hata verdi'));
  }, DAILY);

  // Açılışta bir kez: önce yeni ihlaller, sonra eski ihlallerin eksik bildirimleri.
  checkSlaBreaches(log)
    .then(() => backfillSlaNotifications(log))
    .catch((err) => log.error({ err }, 'SLA gözcüsü hata verdi'));
  expireGrants(log).catch((err) => log.error({ err }, 'yetki süresi işi hata verdi'));

  return () => {
    clearInterval(slaTimer);
    clearInterval(pruneTimer);
  };
}
