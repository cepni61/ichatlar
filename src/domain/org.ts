import type { Prisma, PrismaClient } from '@prisma/client';
import type { Actor } from './permissions.js';

/**
 * Kuruluş ağacı, iki seviye (kullanıcı isteği, 2026-10-09):
 *
 *   Departman (ünite)  →  Ekip (işletme bölümü)
 *
 * İkisi de `Department` tablosunda durur; ekibin parentId'si departmanıdır.
 * Kayıtlar ve kişiler EKİBE bağlanır (Record.departmentId, User.departmentId
 * ekip kimliğidir). Ekibi olmayan departman kendisi ekip gibi kullanılır —
 * ağacın yaprağı odur.
 *
 * Ağaç küçüktür (onlarca satır) ve nadiren değişir; yetki kararı veren her
 * istek onu bir kez okur. Önbellek tutulmaz: kurulum komutu ayrı süreçte
 * çalıştığı için önbellek sunucuda bayatlardı.
 */

export interface OrgUnit {
  id: string;
  parentId: string | null;
  active: boolean;
}

export type OrgTree = Map<string, OrgUnit>;

export async function loadOrgTree(db: Pick<PrismaClient, 'department'> | Prisma.TransactionClient): Promise<OrgTree> {
  const rows = await db.department.findMany({ select: { id: true, parentId: true, active: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

/** Birimin departmanı: ekipse üstü, departmansa kendisi. */
export function rootOf(tree: OrgTree, unitId: string | null | undefined): string | null {
  if (!unitId) return null;
  return tree.get(unitId)?.parentId ?? unitId;
}

/** Kayıt açılabilen / yönlendirilebilen birim: etkin ve etkin ekibi olmayan (yaprak). */
export function isAssignableUnit(tree: OrgTree, unitId: string): boolean {
  const u = tree.get(unitId);
  if (!u || !u.active) return false;
  for (const other of tree.values()) {
    if (other.parentId === unitId && other.active) return false;
  }
  return true;
}

/** Departmanın etkin ekipleri; ekibi yoksa departmanın kendisi. */
export function teamsOf(tree: OrgTree, rootId: string): string[] {
  const kids = [...tree.values()].filter((u) => u.parentId === rootId && u.active).map((u) => u.id);
  return kids.length ? kids : [rootId];
}

/** Yetki kontrolü için kayda departman kimliklerini ekler. */
export function withRoots<T extends { departmentId: string; department2Id: string | null }>(
  rec: T,
  tree: OrgTree,
): T & { departmentRootId: string | null; department2RootId: string | null } {
  return { ...rec, departmentRootId: rootOf(tree, rec.departmentId), department2RootId: rootOf(tree, rec.department2Id) };
}

/** Aktöre kendi departmanını ekler (ekibinin üstü). */
export function actorInTree(actor: Actor, tree: OrgTree): Actor {
  return { ...actor, departmentRootId: rootOf(tree, actor.departmentId) };
}

/**
 * Prisma süzgeci: kaydın ekiplerinden biri bu departmanın altında (ya da
 * departmanın kendisinde — ekibi olmayan departman).
 */
export function inDepartmentTree(rootId: string): Prisma.RecordWhereInput {
  const unit: Prisma.DepartmentWhereInput = { OR: [{ id: rootId }, { parentId: rootId }] };
  return { OR: [{ department: { is: unit } }, { department2: { is: unit } }] };
}

/** Prisma süzgeci: kaydın ekiplerinden biri bu ekip. */
export function inTeam(teamId: string): Prisma.RecordWhereInput {
  return { OR: [{ departmentId: teamId }, { department2Id: teamId }] };
}
