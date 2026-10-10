import type { Prisma, PrismaClient } from '@prisma/client';
import { Role } from './enums.js';

/**
 * Yetkiler ekranında verilen yetkiler (Grant tablosu). Kurumsal dizinden
 * (AD grupları) gelen rolün üstüne eklenir; AD girişi bunlara dokunmaz.
 *
 *   MANAGER    Ekip yöneticisi — etkin rolü yükseltir; kişinin ekibi olmalı.
 *   ADMIN      Sistem yöneticisi — etkin rolü yükseltir.
 *   DEPT_HEAD  Departman sorumlusu — bir departmanın bütün ekiplerinin
 *              kayıtlarını (kısıtlılar hariç) ve raporlarını görür, Bilgi
 *              Bankası maddelerini yönetir. İşlem yapmaz.
 *   REPORTS    Rapor görüntüleyici — raporlar ve CSV.
 *   KB_EDITOR  Bilgi Bankası düzenleyici — bir ekibin maddeleri.
 *
 * expiresAt doluysa yetki o ana kadar geçerlidir (vekâlet); sonra işlemez
 * ve zamanlanmış iş satırı siler (jobs/slaWatcher.ts → expireGrants).
 */
export const GrantKind = {
  MANAGER: 'MANAGER',
  ADMIN: 'ADMIN',
  DEPT_HEAD: 'DEPT_HEAD',
  REPORTS: 'REPORTS',
  KB_EDITOR: 'KB_EDITOR',
} as const;
export type GrantKind = (typeof GrantKind)[keyof typeof GrantKind];
export const GRANT_KINDS = Object.values(GrantKind) as [GrantKind, ...GrantKind[]];

export const GRANT_LABELS: Record<GrantKind, string> = {
  MANAGER: 'Ekip yöneticisi',
  ADMIN: 'Sistem yöneticisi',
  DEPT_HEAD: 'Departman sorumlusu',
  REPORTS: 'Rapor görüntüleyici',
  KB_EDITOR: 'Bilgi Bankası düzenleyici',
};

/** Etkin rolü değiştiren türler. */
export const ROLE_KINDS: string[] = [GrantKind.MANAGER, GrantKind.ADMIN];

const RANK: Record<string, number> = { USER: 0, TEAM_MEMBER: 1, MANAGER: 2, ADMIN: 3 };
export const roleRank = (role: string) => RANK[role] ?? 0;

/** Süresi dolmamış yetki. Başka bir OR ile çakışmasın diye AND içinde kullanın. */
export const activeGrant = (now = new Date()): Prisma.GrantWhereInput => ({
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

/** Etkin rol = dizin rolü ile geçerli rol yetkilerinin en yükseği. */
export function effectiveRole(base: string, roleGrants: string[], departmentId: string | null): Role {
  let best = base;
  for (const g of roleGrants) {
    // Ekip yöneticiliği bir ekibe bağlı: ekibi olmayana verilen yöneticilik işlemez.
    if (g === GrantKind.MANAGER && !departmentId) continue;
    if (roleRank(g) > roleRank(best)) best = g;
  }
  return best as Role;
}

type Db = Prisma.TransactionClient | PrismaClient;

/** Kişinin geçerli rol yetkileri. */
export async function roleGrantsOf(db: Db, userId: string) {
  const rows = await db.grant.findMany({
    where: { userId, kind: { in: ROLE_KINDS }, AND: [activeGrant()] },
    select: { kind: true },
  });
  return rows.map((g) => g.kind);
}

/** Etkin rolü dizin rolü + geçerli rol yetkilerinden yeniden yazar. */
export async function syncRole(db: Db, userId: string): Promise<Role> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseRole: true, departmentId: true } });
  const role = effectiveRole(u.baseRole, await roleGrantsOf(db, userId), u.departmentId);
  await db.user.update({ where: { id: userId }, data: { role } });
  return role;
}
