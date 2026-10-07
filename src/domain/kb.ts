import { prisma } from '../db.js';
import { Role } from './enums.js';
import type { Actor } from './permissions.js';

/**
 * Bilgi Bankası: ekiplerin hazır yanıtları ve kurumsal uygulama / süreç
 * bağlantıları.
 *
 * Kim ne yapar:
 *   - Sistem yöneticisi: her ekibin maddesini yönetir, düzenleme yetkisi verir.
 *   - Yönetici (departman müdürü): bütün maddeleri görür, kendi ekibininkini yönetir.
 *   - Yetki verilen kişi: yetkili olduğu ekip(ler)in maddelerini görür ve yönetir.
 *   - Diğerleri yönetim ekranını görmez; maddeler onlara Sık Sorulanlar, Arama,
 *     benzer kayıt önerileri ve asistan üzerinden ulaşır.
 */
export const KB_KINDS = {
  BILGI: 'Bilgi yanıtı',
  UYGULAMA: 'Uygulama',
  SUREC: 'Süreç',
} as const;
export type KbKind = keyof typeof KB_KINDS;
export const KB_KIND_KEYS = Object.keys(KB_KINDS) as [KbKind, ...KbKind[]];

export interface KbAccess {
  /** Yönetim ekranını görebilir. */
  view: boolean;
  /** Yetki verebilir (sistem yöneticisi). */
  admin: boolean;
  /** Düzenleyebildiği ekipler; 'all' = hepsi. */
  edit: 'all' | string[];
}

export async function kbAccess(actor: Actor): Promise<KbAccess> {
  if (actor.role === Role.ADMIN) return { view: true, admin: true, edit: 'all' };
  const grants = await prisma.kbEditor.findMany({
    where: { userId: actor.id },
    select: { departmentId: true },
  });
  const depts = new Set(grants.map((g) => g.departmentId));
  if (actor.role === Role.MANAGER && actor.departmentId) depts.add(actor.departmentId);
  return { view: actor.role === Role.MANAGER || depts.size > 0, admin: false, edit: [...depts] };
}

export const canEditDept = (a: KbAccess, departmentId: string) =>
  a.edit === 'all' || a.edit.includes(departmentId);

/** Yalnızca http(s) bağlantısı — javascript: ve benzeri şemalar arayüze hiç gitmesin. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
