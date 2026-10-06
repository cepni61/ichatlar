/**
 * Sabit kümeler.
 *
 * Bunlar önce Prisma enum'larıydı. SQLite'ta Prisma enum desteklemediği için
 * veritabanında String kolon olarak tutuluyorlar ve tip güvenliği burada
 * sağlanıyor. Kullanım şekli enum'la aynı kaldı (`RecordStatus.YENI`), böylece
 * çağıran kod değişmedi.
 *
 * Yan fayda: şema artık lehçeden bağımsız. PostgreSQL'e geçerken tek
 * değişiklik `schema.prisma` içindeki provider satırı.
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
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export const NotificationType = {
  /** Kayıt SLA hedefini aştı. */
  SLA_BREACH: 'SLA_BREACH',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/* ------------------------------------------------------------------ doğrulama */

const validator =
  <T extends string>(values: readonly T[], label: string) =>
  (value: unknown): T => {
    if (typeof value === 'string' && (values as readonly string[]).includes(value)) {
      return value as T;
    }
    throw new Error(`Geçersiz ${label}: ${String(value)}`);
  };

export const RECORD_TYPES = Object.values(RecordType);
export const PRIORITIES = Object.values(Priority);
export const RECORD_STATUSES = Object.values(RecordStatus);
export const ROLES = Object.values(Role);
export const EVENT_TYPES = Object.values(EventType);

export const parseRecordType = validator(RECORD_TYPES, 'kayıt türü');
export const parsePriority = validator(PRIORITIES, 'öncelik');
export const parseRecordStatus = validator(RECORD_STATUSES, 'durum');
export const parseRole = validator(ROLES, 'rol');

/**
 * Veritabanından okunan String değerleri tip güvenli hâle getirir. Elle
 * yapılmış bir SQL düzenlemesi bozuk değer bıraktıysa burada yakalanır.
 */
export const asRecordStatus = (v: string) => parseRecordStatus(v);
export const asPriority = (v: string) => parsePriority(v);
export const asRecordType = (v: string) => parseRecordType(v);
export const asRole = (v: string) => parseRole(v);
