import type { Prisma } from '@prisma/client';
import { NotificationType, Role } from '../domain/enums.js';

/**
 * Bildirimler. Şimdilik tek kanal var: uygulama içi (Notification tablosu,
 * üst çubuktaki zil). E-posta veya Teams eklenecekse kaynak yine bu tablo
 * olur — kanal, yazılan satırları okuyup gönderen ayrı bir iş olarak eklenir.
 */

type Tx = Prisma.TransactionClient;

/**
 * SLA ihlalinde kim bilgilendirilir:
 *   - kayıt birinin üzerindeyse o kişi,
 *   - kimsenin üzerinde değilse ekibin tamamı (kayıt ekibe düşer, sahiplenen yok),
 *   - her durumda ekibin yöneticileri.
 * Pasif kullanıcılar atlanır. Kaydı açan kişi bilgilendirilmez: gecikme
 * onun yapabileceği bir şey değil.
 */
export async function slaBreachRecipients(
  tx: Tx,
  rec: { departmentId: string; assigneeId: string | null },
): Promise<string[]> {
  const roles = rec.assigneeId ? [Role.MANAGER] : [Role.TEAM_MEMBER, Role.MANAGER];
  const team = await tx.user.findMany({
    where: { departmentId: rec.departmentId, active: true, role: { in: roles } },
    select: { id: true },
  });
  const ids = new Set(team.map((u) => u.id));

  if (rec.assigneeId) {
    const owner = await tx.user.findFirst({
      where: { id: rec.assigneeId, active: true },
      select: { id: true },
    });
    if (owner) ids.add(owner.id);
  }
  return [...ids];
}

/**
 * SLA ihlal bildirimlerini yazar; aynı kişiye ikinci kez yazmaz. Yazılan alıcı sayısını döner.
 * Metne kayıt başlığı kopyalanmaz: başlık kişisel veri taşıyabilir, kayıt
 * imha edilirken bildirimde unutulan bir kopyası kalmasın. Arayüz başlığı
 * kayıttan okur.
 */
export async function notifySlaBreach(
  tx: Tx,
  rec: { id: string; code: string; departmentId: string; assigneeId: string | null },
): Promise<number> {
  const recipients = await slaBreachRecipients(tx, rec);
  if (recipients.length === 0) return 0;

  // Benzersizlik (userId, recordId, type) üzerinde; gözcü aynı kaydı iki kez
  // işlerse ikinci yazım sessizce atlanır. createMany + skipDuplicates SQLite'ta
  // desteklenmediği için önce mevcutlar süzülür.
  const existing = await tx.notification.findMany({
    where: { recordId: rec.id, type: NotificationType.SLA_BREACH, userId: { in: recipients } },
    select: { userId: true },
  });
  const done = new Set(existing.map((n) => n.userId));
  const fresh = recipients.filter((id) => !done.has(id));

  for (const userId of fresh) {
    await tx.notification.create({
      data: {
        userId,
        recordId: rec.id,
        type: NotificationType.SLA_BREACH,
        text: `${rec.code} SLA hedefini aştı.`,
      },
    });
  }
  return fresh.length;
}
