/**
 * Ek dosya kuralları — saf, veritabanı ve diskten bağımsız (birim testli).
 *
 * İzin listesi: iş belgeleri, tablolar, görseller. HTML, SVG, betik ve
 * çalıştırılabilir dosyalar yok — indirme olarak verilse de tarayıcıda ya da
 * kullanıcının bilgisayarında çalışabilecek türler kabul edilmez.
 * İçerik türü istemcinin söylediğinden değil, uzantıdan belirlenir.
 */
export const ALLOWED: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  msg: 'application/vnd.ms-outlook',
  eml: 'message/rfc822',
  zip: 'application/zip',
};

/** Bir istekte en fazla dosya; bir güncellemeye bağlanabilecek en fazla ek. */
export const MAX_FILES = 5;

/** Uzantıya göre içerik türü; izin listesinde yoksa null. */
export function mimeFor(filename: string): string | null {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1]?.toLowerCase();
  return ext ? ALLOWED[ext] ?? null : null;
}

/**
 * Görünen dosya adını temizler: yol parçaları, denetim karakterleri ve
 * başlık bölme karakterleri atılır, uzunluk sınırlanır. Uzantı korunur.
 */
export function cleanFilename(raw: string): string {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'dosya';
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, 120 - ext.length) + ext;
}

/** İndirme başlığı: ASCII yedek ad + UTF-8 asıl ad (RFC 6266 / 5987). */
export function contentDisposition(name: string): string {
  // Eski istemciler için: aksanlar düşer (Ç→C, İ→I), noktasız ı → i; kalan ASCII dışı → _
  const ascii = name
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
