import { Priority, RecordStatus, RecordType } from './enums.js';

/**
 * Prototipin (ichatlar4.html) sözlüğü ile veritabanı enum'ları arasındaki
 * eşleme. Arayüz küçük harfli kimlikler kullanıyor; sunucuda enum tutuyoruz.
 * Etiketler tek yerde durur — arayüz bunları /api/bootstrap ile alır.
 */

export const TYPE_LABELS: Record<string, string> = {
  BILGI: 'Bilgi',
  ONERI: 'Öneri',
};

export const TYPE_FROM_SLUG: Record<string, RecordType> = {
  bilgi: RecordType.BILGI,
  oneri: RecordType.ONERI,
};

export const TYPE_TO_SLUG: Record<string, string> = {
  BILGI: 'bilgi',
  ONERI: 'oneri',
};

export const PRIORITY_LABELS: Record<string, string> = {
  NORMAL: 'Normal',
  YUKSEK: 'Yüksek',
  KRITIK: 'Kritik',
};

export const PRIORITY_FROM_SLUG: Record<string, Priority> = {
  normal: Priority.NORMAL,
  yuksek: Priority.YUKSEK,
  kritik: Priority.KRITIK,
};

export const PRIORITY_TO_SLUG: Record<string, string> = {
  NORMAL: 'normal',
  YUKSEK: 'yuksek',
  KRITIK: 'kritik',
};

export const STATUS_LABELS: Record<string, string> = {
  YENI: 'Yeni',
  UZERIME_ALINDI: 'Üzerime Alındı',
  INCELENIYOR: 'İnceleniyor',
  CALISILIYOR: 'Çalışılıyor',
  EK_BILGI: 'Ek Bilgi Bekleniyor',
  COZULDU: 'Çözüldü',
  KAPATILDI: 'Kapatıldı',
  REDDEDILDI: 'Reddedildi',
};

/** Arayüzdeki pill renkleri — prototiple aynı. */
export const STATUS_TONES: Record<string, string> = {
  YENI: 'gray',
  UZERIME_ALINDI: 'blue',
  INCELENIYOR: 'blue',
  CALISILIYOR: 'purple',
  EK_BILGI: 'yellow',
  COZULDU: 'green',
  KAPATILDI: 'gray',
  REDDEDILDI: 'red',
};

export const STATUS_FROM_SLUG: Record<string, RecordStatus> = {
  yeni: RecordStatus.YENI,
  uzerime_alindi: RecordStatus.UZERIME_ALINDI,
  inceleniyor: RecordStatus.INCELENIYOR,
  calisiliyor: RecordStatus.CALISILIYOR,
  ek_bilgi: RecordStatus.EK_BILGI,
  cozuldu: RecordStatus.COZULDU,
  kapatildi: RecordStatus.KAPATILDI,
  reddedildi: RecordStatus.REDDEDILDI,
};

export const STATUS_TO_SLUG: Record<string, string> = {
  YENI: 'yeni',
  UZERIME_ALINDI: 'uzerime_alindi',
  INCELENIYOR: 'inceleniyor',
  CALISILIYOR: 'calisiliyor',
  EK_BILGI: 'ek_bilgi',
  COZULDU: 'cozuldu',
  KAPATILDI: 'kapatildi',
  REDDEDILDI: 'reddedildi',
};

/** Kayıt hâlâ ekipte iş bekliyor mu. Prototipteki OPEN_STATUSES. */
export const OPEN_STATUSES: RecordStatus[] = [
  RecordStatus.YENI,
  RecordStatus.UZERIME_ALINDI,
  RecordStatus.INCELENIYOR,
  RecordStatus.CALISILIYOR,
  RecordStatus.EK_BILGI,
];

export const isOpen = (s: string) => (OPEN_STATUSES as string[]).includes(s);

/** Sahip tarafından serbestçe seçilebilen ara durumlar. */
export const WORK_STATUSES: RecordStatus[] = [
  RecordStatus.INCELENIYOR,
  RecordStatus.CALISILIYOR,
  RecordStatus.EK_BILGI,
];

export const HOUR_MS = 60 * 60 * 1000;
