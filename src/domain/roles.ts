import { Role } from './enums.js';

/**
 * Etkin rol = dizinden/kurulumdan gelen rol (baseRole) ile sistem
 * yöneticisinin Yetkiler ekranında verdiği rolün (roleGrant) yükseği.
 * İki kaynak birbirini ezmez: AD girişi yalnızca baseRole'ü yazar, Yetkiler
 * ekranı yalnızca roleGrant'ı.
 */
const RANK: Record<string, number> = { USER: 0, TEAM_MEMBER: 1, MANAGER: 2, ADMIN: 3 };

/** Yetkiler ekranında verilebilen roller. */
export const GRANTABLE = [Role.MANAGER, Role.ADMIN] as const;
export type GrantableRole = (typeof GRANTABLE)[number];

export function effectiveRole(base: string, grant: string | null | undefined, departmentId: string | null): Role {
  // Ekip yöneticiliği bir ekibe bağlı: ekibi olmayana verilen yöneticilik işlemez.
  if (!grant || (grant === Role.MANAGER && !departmentId)) return base as Role;
  return ((RANK[grant] ?? 0) > (RANK[base] ?? 0) ? grant : base) as Role;
}
