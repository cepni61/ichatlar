/**
 * Sabit kümeler.
 *
 * Veritabanında PostgreSQL enum'u değil String kolon olarak tutulurlar; tip
 * güvenliği burada sağlanır. Kullanım şekli enum'la aynı (`RecordStatus.YENI`).
 * Yeni bir değer eklemek göç gerektirmez.
 *
 * Kolonlara yazılan değerin geçerliliği `parse*` yardımcılarıyla doğrulanır —
 * enum'un veritabanı seviyesinde verdiği garantinin karşılığı bu.
 */

export const RecordType = {
  BILGI: 'BILGI',
  ONERI: 'ONERI',
} as const;
export type RecordType = (typeof RecordType)[keyof typeof RecordType];

export const Priority = {
  NORMAL: 'NORMAL',
  YUKSEK: 'YUKSEK',
  KRITIK: 'KRITIK',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const RecordStatus = {
  YENI: 'YENI',
  UZERIME_ALINDI: 'UZERIME_ALINDI',
  INCELENIYOR: 'INCELENIYOR',
  CALISILIYOR: 'CALISILIYOR',
  EK_BILGI: 'EK_BILGI',
  COZULDU: 'COZULDU',
  KAPATILDI: 'KAPATILDI',
  REDDEDILDI: 'REDDEDILDI',
  /* Öneri akışı: ekipten biri üzerine alınca "Değerlendiriliyor"; değerlendiren
     sonucu seçer — Değerlendirildi, Fayda Sağladı ya da Uygun Bulunmadı. Bu
     üçü son durumdur (öneri sahibinin ayrıca kapatması gerekmez). */
  DEGERLENDIRILIYOR: 'DEGERLENDIRILIYOR',
  DEGERLENDIRILDI: 'DEGERLENDIRILDI',
  FAYDA_SAGLADI: 'FAYDA_SAGLADI',
  UYGUN_BULUNMADI: 'UYGUN_BULUNMADI',
} as const;
export type RecordStatus = (typeof RecordStatus)[keyof typeof RecordStatus];

export const Role = {
  /** Kayıt açabilir, kendi kayıtlarını görür. */
  USER: 'USER',
  /** Ekibine düşen kayıtları görür, üzerine alır, çözer. */
  TEAM_MEMBER: 'TEAM_MEMBER',
  /** Ekip üyesi yetkileri + raporlar. */
  MANAGER: 'MANAGER',
  /** Tüm kayıtlar, tanımlar ve denetim izi. */
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const EventType = {
  CREATE: 'CREATE',
  ASSIGN: 'ASSIGN',
  FORWARD: 'FORWARD',
  STATUS: 'STATUS',
  COMMENT: 'COMMENT',
  ATTACH: 'ATTACH',
  SLA_BREACH: 'SLA_BREACH',
  REOPEN: 'REOPEN',
  /** Yenilenen kayıt işareti kondu / kaldırıldı (ML hafızası). */
  LEARN: 'LEARN',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export const NotificationType = {
  /** Kayıt SLA hedefini aştı (ekip + yönetici). */
  SLA_BREACH: 'SLA_BREACH',
  /** Kayıt çözüldü — açan kişi inceleyip kapatmalı ya da yeniden açmalı. */
  RESOLVED: 'RESOLVED',
  /** Kayıt reddedildi (açan kişi). */
  REJECTED: 'REJECTED',
  /** Ekip, açan kişiden ek bilgi bekliyor. */
  INFO_REQUESTED: 'INFO_REQUESTED',
  /** Açan kişi çözümü yetersiz bulup kaydı yeniden açtı (sahip). */
  REOPENED: 'REOPENED',
  /** Kayda yeni güncelleme yazıldı (karşı taraf). */
  COMMENT: 'COMMENT',
  /** Kayıt doğrudan bu kişiye atandı. */
  ASSIGNED: 'ASSIGNED',
  /** Öneri değerlendirmeye alındı (öneri sahibi). */
  EVALUATING: 'EVALUATING',
  /** Öneri değerlendirmesi sonuçlandı (öneri sahibi). */
  EVALUATED: 'EVALUATED',
  /** Uygulama geri bildirimi geldi (sistem yöneticileri). Kayda bağlı değil. */
  FEEDBACK: 'FEEDBACK',
  /** Yetki verildi, alındı ya da süresi doldu (Yetkiler ekranı). Kayda bağlı değil. */
  ACCESS: 'ACCESS',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/* ------------------------------------------------------------------ doğrulama */

const ROLES: readonly string[] = Object.values(Role);

/**
 * Veritabanından okunan rolü tip güvenli hâle getirir. Elle yapılmış bir SQL
 * düzenlemesi bozuk değer bıraktıysa burada yakalanır.
 */
export function asRole(value: string): Role {
  if (ROLES.includes(value)) return value as Role;
  throw new Error(`Geçersiz rol: ${value}`);
}
