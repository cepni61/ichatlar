import { z } from 'zod';

const TRUE = new Set(['true', '1', 'yes', 'on', 'evet']);
const FALSE = new Set(['false', '0', 'no', 'off', 'hayır', 'hayir', '']);

/**
 * .env'deki açık/kapalı ayarı.
 *
 * z.coerce.boolean() kullanılmaz: o, boş olmayan her metni true sayar —
 * `DEV_AUTH_BYPASS=false` yazmak ayarı AÇARDI. Burada yalnızca tanınan
 * değerler kabul edilir; yazım hatası sessizce bir anlam kazanmak yerine
 * sunucuyu açılışta durdurur.
 */
export const envFlag = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return fallback;
      const s = v.trim().toLocaleLowerCase('tr-TR');
      if (TRUE.has(s)) return true;
      if (FALSE.has(s)) return s === '' ? fallback : false;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `true ya da false olmalı, "${v}" verildi` });
      return z.NEVER;
    });
