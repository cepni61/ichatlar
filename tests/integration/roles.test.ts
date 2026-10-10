import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '../../src/domain/enums.js';
import { upsertUserFromClaims } from '../../src/auth/directory.js';
import { createDept, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

/*
 * Yetkiler ekranı (2026-10-10, kullanıcı isteği): sistem yöneticisi bir kişiyi
 * ekip yöneticisi ya da sistem yöneticisi yapar. Verilen yetki kurumsal
 * dizinden gelen rolün üstüne eklenir, AD girişinde silinmez.
 */
let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(resetDb);

async function world() {
  const bt = await createDept('Bilgi Teknolojileri');
  return {
    bt,
    admin: await createUser({ name: 'Sistem', role: Role.ADMIN }),
    member: await createUser({ name: 'Ekip Üyesi', role: Role.TEAM_MEMBER, departmentId: bt.id }),
    noTeam: await createUser({ name: 'Ekipsiz Çalışan' }),
  };
}

const put = async (actorId: string, userId: string, role: string | null) =>
  app.inject({ method: 'PUT', url: '/api/admin/roles/' + userId, headers: await loginAs(app, actorId), payload: { role } });
const reports = async (userId: string) =>
  (await app.inject({ method: 'GET', url: '/api/reports/summary', headers: await loginAs(app, userId) })).statusCode;

describe('Yetkiler', () => {
  it('sistem yöneticisi ekip üyesini ekip yöneticisi yapar ve geri alır; değişiklik hemen geçerli', async () => {
    const w = await world();
    expect(await reports(w.member.id)).toBe(403);

    const res = await put(w.admin.id, w.member.id, Role.MANAGER);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ role: Role.MANAGER, baseRole: Role.TEAM_MEMBER, roleGrant: Role.MANAGER, grantedBy: 'Sistem' });
    expect(await reports(w.member.id)).toBe(200);

    const list = (await app.inject({ method: 'GET', url: '/api/admin/roles', headers: await loginAs(app, w.admin.id) })).json();
    expect(list.items.map((u: { name: string }) => u.name)).toEqual(['Ekip Üyesi', 'Sistem']);

    expect((await put(w.admin.id, w.member.id, null)).json().user.role).toBe(Role.TEAM_MEMBER);
    expect(await reports(w.member.id)).toBe(403);

    const audit = await prisma.auditLog.findMany({ where: { entityId: w.member.id }, orderBy: { at: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['role.grant', 'role.revoke']);
  });

  it('herhangi bir kişiye sistem yöneticiliği verir', async () => {
    const w = await world();
    const res = await put(w.admin.id, w.noTeam.id, Role.ADMIN);
    expect(res.json().user.role).toBe(Role.ADMIN);
    expect((await app.inject({ method: 'GET', url: '/api/admin/roles', headers: await loginAs(app, w.noTeam.id) })).statusCode).toBe(200);
  });

  it('reddedilenler: ekipsize ekip yöneticiliği, kendi yetkisi, zaten sahip olunan, dizinden gelen yetkiyi geri alma, yönetici olmayan', async () => {
    const w = await world();
    expect((await put(w.admin.id, w.noTeam.id, Role.MANAGER)).statusCode).toBe(400);
    expect((await put(w.admin.id, w.admin.id, null)).statusCode).toBe(400);
    const otherAdmin = await createUser({ name: 'Diğer Yönetici', role: Role.ADMIN });
    expect((await put(w.admin.id, otherAdmin.id, Role.ADMIN)).statusCode).toBe(400);
    expect((await put(w.admin.id, otherAdmin.id, null)).statusCode).toBe(400);
    expect((await put(w.member.id, w.noTeam.id, Role.ADMIN)).statusCode).toBe(403);
    expect((await put(w.admin.id, w.member.id, 'USER')).statusCode).toBe(400);
  });

  it('AD girişi verilen yetkiyi silmez; ekipten çıkan kişide ekip yöneticiliği işlemez', async () => {
    const w = await world();
    await prisma.department.update({ where: { id: w.bt.id }, data: { entraGroupId: 'IcHatlar-BT' } });
    await put(w.admin.id, w.member.id, Role.MANAGER);

    const policy = { useGroups: true, adminGroup: 'IcHatlar-Sistem', managerGroup: 'IcHatlar-Yoneticiler', authoritative: true };
    const claims = (groups: string[]) => ({ oid: w.member.entraOid, email: w.member.email, name: w.member.name, groups });

    await upsertUserFromClaims(claims(['CN=IcHatlar-BT,OU=Gruplar,DC=test']), policy);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: w.member.id } }))
      .toMatchObject({ role: Role.MANAGER, baseRole: Role.TEAM_MEMBER, roleGrant: Role.MANAGER });

    await upsertUserFromClaims(claims([]), policy);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: w.member.id } }))
      .toMatchObject({ role: Role.USER, departmentId: null, roleGrant: Role.MANAGER });
  });
});
