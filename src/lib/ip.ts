/**
 * Hız sınırı anahtarı: istemci adresi, port olmadan. IIS ARR X-Forwarded-For'a
 * varsayılan olarak bağlantı portunu ekleyebiliyor ("10.1.2.3:51234"); port
 * kalırsa her yeni bağlantı ayrı kişi sayılır ve giriş denemesi sınırı işlemez.
 */
export function ipKey(ip: string): string {
  return /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip)?.[1] ?? /^\[([0-9a-f:.]+)\]:\d+$/i.exec(ip)?.[1] ?? ip;
}
