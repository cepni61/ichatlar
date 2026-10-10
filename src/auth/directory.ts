import { Role } from '../domain/enums.js';
import { isAssignableUnit, loadOrgTree } from '../domain/org.js';
import { prisma } from '../db.js';

/**
 * Kurumsal dizinden (Entra ID ya da Active Directory) gelen kişiyi uygulama
 * kullanıcısına eşler. Kimliğin anahtarı `oid` — e-posta değişse de aynı kişi.
 */
export interface DirectoryClaims {
  /** Entra: nesne kimliği. AD: "ad:" + objectGUID. */
  oid: string;
  email: string;
  name: string;
  /** Entra: grup nesne kimlikleri. AD: memberOf (grup DN'leri). */
  groups: string[];
}

export interface DirectoryPolicy {
  /** Ekip grubundaki kişi o ekibe atanır (Department.entraGroupId). */
  useGroups: boolean;
  /** Bu gruptakiler sistem yöneticisi olur. */
  adminGroup: string;
  /** Bu gruptakiler, üyesi oldukları ekibin yöneticisi olur. */
  managerGroup: string;
  /**
   * true (AD): ekip ve rol her girişte gruplardan yeniden yazılır; ekibi
   * değişen ya da gruptan çıkan kişi bir sonraki girişte güncellenir.
   * false (Entra): grup listesi eksik gelebilir (çok grup → Entra listeyi
   * göndermez); yalnızca boş alan doldurulur, yöneticilik gruptan düşer.
   */
  authoritative: boolean;
}

/**
 * Grup eşleşmesi büyük/küçük harfe duyarsız. Ayardaki değer Entra'da nesne
 * kimliği, AD'de grubun adı (CN) ya da tam DN'i olabilir; memberOf DN döner.
 */
export function inGroup(groups: string[], wanted: string): boolean {
  const w = wanted.trim().toLowerCase();
  if (!w) return false;
  return groups.some((g) => {
    const l = g.toLowerCase();
    return l === w || /^cn=([^,]+)/.exec(l)?.[1] === w;
  });
}

async function fromGroups(claims: DirectoryClaims, policy: DirectoryPolicy) {
  let departmentId: string | null = null;
  if (policy.useGroups && claims.groups.length) {
    const tree = await loadOrgTree(prisma);
    const units = await prisma.department.findMany({
      where: { active: true, entraGroupId: { not: null } },
      orderBy: [{ parentId: 'asc' }, { order: 'asc' }],
      select: { id: true, entraGroupId: true },
    });
    // Kayıt ekibe düşer: ekibi olan departmanın grubu kişiyi ekibe atamaz.
    departmentId = units.find((u) => isAssignableUnit(tree, u.id) && inGroup(claims.groups, u.entraGroupId!))?.id ?? null;
  }
  const role = inGroup(claims.groups, policy.adminGroup)
    ? Role.ADMIN
    : departmentId
      ? inGroup(claims.groups, policy.managerGroup) ? Role.MANAGER : Role.TEAM_MEMBER
      : Role.USER;
  return { departmentId, role };
}

/** İlk girişte kullanıcıyı oluşturur, sonrakilerde ad/e-posta ve (politikaya göre) ekip/rolü tazeler. */
export async function upsertUserFromClaims(claims: DirectoryClaims, policy: DirectoryPolicy) {
  const target = await fromGroups(claims, policy);
  const existing = await prisma.user.findUnique({
    where: { entraOid: claims.oid },
    select: { id: true, role: true, departmentId: true },
  });

  if (existing) {
    let sync: { departmentId?: string | null; role?: Role };
    if (policy.authoritative) {
      sync = target;
    } else {
      // Grup listesi boşsa yöneticiliğe dokunulmaz (Entra listeyi göndermemiş olabilir).
      const leftAdmin =
        !!policy.adminGroup && claims.groups.length > 0 && !inGroup(claims.groups, policy.adminGroup);
      sync = {
        ...(existing.departmentId == null && target.departmentId ? { departmentId: target.departmentId } : {}),
        ...(existing.role === Role.USER && target.role !== Role.USER ? { role: target.role } : {}),
        ...(existing.role === Role.ADMIN && leftAdmin
          ? { role: existing.departmentId ? Role.TEAM_MEMBER : target.role }
          : {}),
      };
    }
    // Devre dışı bırakılan kişi girişle yeniden açılmaz.
    return prisma.user.update({
      where: { id: existing.id },
      data: { email: await freeEmail(claims.email, existing.id), name: claims.name, lastLoginAt: new Date(), ...sync },
      select: { id: true, active: true },
    });
  }

  return prisma.user.create({
    data: {
      entraOid: claims.oid,
      email: await freeEmail(claims.email, null),
      name: claims.name,
      ...target,
      lastLoginAt: new Date(),
    },
    select: { id: true, active: true },
  });
}

/**
 * E-posta benzersiz; aynı adres başka bir dizin kimliğindeyse (işten ayrılıp
 * yeniden gelen, adresi devralınan kişi) eski satır kapatılır ve adresi
 * boşaltılır. Eski kayıtların sahibi olarak geçmişte kalır.
 */
async function freeEmail(email: string, selfId: string | null) {
  const other = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (other && other.id !== selfId) {
    await prisma.user.update({
      where: { id: other.id },
      data: { email: `${email}#eski-${other.id}`, active: false },
    });
  }
  return email;
}
