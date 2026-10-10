import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus, Role } from '../../src/domain/enums.js';
import { upsertUserFromClaims } from '../../src/auth/directory.js';
import { expireGrants } from '../../src/routes/grants.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb, silentLog } from './helpers.js';

/*
 * Yetkiler ekranı (2026-10-10, kullanıcı isteği): sistem yöneticisi kişiye
 * ekip yöneticisi, sistem yöneticisi, departman sorumlusu, rapor
 * görüntüleyici ya da Bilgi Bankası düzenleyici yetkisi verir; süreli
 * olabilir. Verilen yetki kurumsal dizinden gelen rolün üstüne eklenir.
 * Ayrılan kişinin açık kayıtları devredilir.
 */
let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(resetDb);

async function world() {
  const bt = await createDept('Bilgi Teknolojileri');
  const btDestek = await createDept('Destek', bt.id);
  const btYazilim = await createDept('Yazılım', bt.id);
  const ik = await createDept('İnsan Kaynakları');
  return {
    bt, btDestek, btYazilim, ik,
    admin: await createUser({ name: 'Sistem', role: Role.ADMIN }),
    member: await createUser({ name: 'Ekip Üyesi', role: Role.TEAM_MEMBER, departmentId: btDestek.id }),
    mate: await createUser({ name: 'Ekip Arkadaşı', role: Role.TEAM_MEMBER, departmentId: btDestek.id }),
    ikUser: await createUser({ name: 'İK Çalışanı', role: Role.TEAM_MEMBER, departmentId: ik.id }),
    noTeam: await createUser({ name: 'Ekipsiz Çalışan' }),
  };
}

const call = async (actorId: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: await loginAs(app, actorId), ...(payload ? { payload } : {}) });
const grant = (actorId: string, body: object) => call(actorId, 'POST', '/api/admin/grants', body);
const reports = async (userId: string) => (await call(userId, 'GET', '/api/reports/summary')).statusCode;
const tomorrow = () => new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);

describe('Yetkiler: ekip yöneticisi ve sistem yöneticisi', () => {
  it('verir, hemen geçerli olur, geri alınca kurumsal rolüne döner; geçmişe ve bildirime düşer', async () => {
    const w = await world();
    expect(await reports(w.member.id)).toBe(403);

    const res = await grant(w.admin.id, { userId: w.member.id, kind: 'MANAGER' });
    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe(Role.MANAGER);
    expect(await reports(w.member.id)).toBe(200);

    const list = (await call(w.admin.id, 'GET', '/api/admin/grants')).json();
    expect(list.grants).toMatchObject([{ kind: 'MANAGER', user: { name: 'Ekip Üyesi' }, grantedBy: 'Sistem', note: null }]);
    expect(list.directory.map((u: { name: string }) => u.name)).toEqual(['Sistem']);

    expect((await call(w.admin.id, 'DELETE', '/api/admin/grants/' + list.grants[0].id)).statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.member.id } })).role).toBe(Role.TEAM_MEMBER);
    expect(await reports(w.member.id)).toBe(403);

    const history = (await call(w.admin.id, 'GET', '/api/admin/grants/history')).json().items;
    expect(history.map((h: { action: string }) => h.action)).toEqual(['grant.revoke', 'grant.add']);
    expect(history[1]).toMatchObject({ actor: 'Sistem', detail: { user: 'Ekip Üyesi', label: 'Ekip yöneticisi' } });

    const notes = (await call(w.member.id, 'GET', '/api/notifications')).json().items;
    expect(notes.map((n: { type: string; text: string }) => n.text)).toEqual([
      'Ekip yöneticisi yetkiniz alındı.',
      'Size Ekip yöneticisi yetkisi verildi.',
    ]);
  });

  it('herhangi bir kişiyi sistem yöneticisi yapar', async () => {
    const w = await world();
    expect((await grant(w.admin.id, { userId: w.noTeam.id, kind: 'ADMIN' })).json().role).toBe(Role.ADMIN);
    expect((await call(w.noTeam.id, 'GET', '/api/admin/grants')).statusCode).toBe(200);
  });

  it('reddedilenler', async () => {
    const w = await world();
    const otherAdmin = await createUser({ name: 'Diğer Yönetici', role: Role.ADMIN });
    expect((await grant(w.admin.id, { userId: w.noTeam.id, kind: 'MANAGER' })).statusCode).toBe(400); // ekipsiz
    expect((await grant(w.admin.id, { userId: w.admin.id, kind: 'REPORTS' })).statusCode).toBe(400); // kendisi
    expect((await grant(w.admin.id, { userId: otherAdmin.id, kind: 'ADMIN' })).statusCode).toBe(400); // zaten
    expect((await grant(w.admin.id, { userId: w.member.id, kind: 'MANAGER', until: '2020-01-01' })).statusCode).toBe(400);
    expect((await grant(w.admin.id, { userId: w.member.id, kind: 'DEPT_HEAD', departmentId: w.btDestek.id })).statusCode).toBe(400); // ekip, departman değil
    expect((await grant(w.member.id, { userId: w.noTeam.id, kind: 'ADMIN' })).statusCode).toBe(403);
  });

  it('AD girişi verilen yetkiyi silmez; ekipten çıkan kişide ekip yöneticiliği işlemez', async () => {
    const w = await world();
    await prisma.department.update({ where: { id: w.btDestek.id }, data: { entraGroupId: 'IcHatlar-BT-Destek' } });
    await grant(w.admin.id, { userId: w.member.id, kind: 'MANAGER' });
    const policy = { useGroups: true, adminGroup: 'IcHatlar-Sistem', managerGroup: 'IcHatlar-Yoneticiler', authoritative: true };
    const claims = (groups: string[]) => ({ oid: w.member.entraOid, email: w.member.email, name: w.member.name, groups });

    await upsertUserFromClaims(claims(['CN=IcHatlar-BT-Destek,OU=Gruplar,DC=test']), policy);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: w.member.id } }))
      .toMatchObject({ role: Role.MANAGER, baseRole: Role.TEAM_MEMBER });

    await upsertUserFromClaims(claims([]), policy);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: w.member.id } })).toMatchObject({ role: Role.USER, departmentId: null });
    expect(await prisma.grant.count({ where: { userId: w.member.id } })).toBe(1);
  });
});

describe('Yetkiler: departman sorumlusu, rapor görüntüleyici, Bilgi Bankası', () => {
  it('departman sorumlusu o departmanın bütün ekiplerini okur (kısıtlılar hariç), raporları görür, maddeleri yönetir; işlem yapmaz', async () => {
    const w = await world();
    const open = await createRecord({ createdById: w.member.id, departmentId: w.btYazilim.id, title: 'Yazılım kaydı' });
    const secret = await createRecord({ createdById: w.member.id, departmentId: w.btDestek.id, title: 'Kısıtlı', restricted: true });

    const codes = async () =>
      ((await call(w.ikUser.id, 'GET', '/api/records?scope=all')).json().records as { code: string }[]).map((r) => r.code);
    expect(await codes()).not.toContain(open.code);
    expect(await reports(w.ikUser.id)).toBe(403);

    expect((await grant(w.admin.id, { userId: w.ikUser.id, kind: 'DEPT_HEAD', departmentId: w.bt.id })).statusCode).toBe(201);
    expect(await codes()).toContain(open.code);
    expect(await codes()).not.toContain(secret.code);
    expect(await reports(w.ikUser.id)).toBe(200);
    const detail = (await call(w.ikUser.id, 'GET', '/api/records/' + open.code)).json().record;
    expect(detail.inAllRecords).toBe(true);
    expect(detail.permissions).toMatchObject({ claim: false, forward: false, comment: false });
    const kb = (await call(w.ikUser.id, 'GET', '/api/bootstrap')).json().kb;
    expect(kb.edit).toEqual(expect.arrayContaining([w.btDestek.id, w.btYazilim.id]));
  });

  it('rapor görüntüleyici raporları ve CSV\'yi görür', async () => {
    const w = await world();
    await grant(w.admin.id, { userId: w.noTeam.id, kind: 'REPORTS' });
    expect(await reports(w.noTeam.id)).toBe(200);
    expect((await call(w.noTeam.id, 'GET', '/api/reports/export.csv')).statusCode).toBe(200);
    // Yönetici zaten görüyor: anlamsız yetki verilmez.
    const manager = await createUser({ name: 'Yönetici', role: Role.MANAGER, departmentId: w.ik.id });
    expect((await grant(w.admin.id, { userId: manager.id, kind: 'REPORTS' })).statusCode).toBe(400);
  });
});

describe('Yetkiler: süreli yetki (vekâlet)', () => {
  it('bitiş tarihine kadar geçerli; süresi dolan rol dışı yetki hemen, rol yetkisi zamanlanmış işle düşer', async () => {
    const w = await world();
    await grant(w.admin.id, { userId: w.member.id, kind: 'MANAGER', until: tomorrow() });
    await grant(w.admin.id, { userId: w.noTeam.id, kind: 'REPORTS', until: tomorrow() });
    expect(await reports(w.member.id)).toBe(200);
    expect(await reports(w.noTeam.id)).toBe(200);

    await prisma.grant.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await reports(w.noTeam.id)).toBe(403); // oturum her istekte okur

    expect(await expireGrants(silentLog)).toBe(2);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.member.id } })).role).toBe(Role.TEAM_MEMBER);
    expect(await reports(w.member.id)).toBe(403);
    expect(await prisma.grant.count()).toBe(0);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: w.member.id }, orderBy: { createdAt: 'desc' } });
    expect(n).toMatchObject({ type: 'ACCESS', text: 'Ekip yöneticisi yetkinizin süresi doldu.' });
    expect(await prisma.auditLog.count({ where: { action: 'grant.expire' } })).toBe(2);
  });
});

describe('Ayrılan çalışanın kayıtları', () => {
  it('açık kayıtlar ekipteki kişiye, ekibi uymayanlar ekibin havuzuna; kişi kapatılır', async () => {
    const w = await world();
    const mine = (departmentId: string, status: RecordStatus = RecordStatus.CALISILIYOR) =>
      createRecord({ createdById: w.ikUser.id, departmentId, assigneeId: w.member.id, status });
    const a = await mine(w.btDestek.id);
    const b = await mine(w.btDestek.id, RecordStatus.UZERIME_ALINDI);
    const c = await mine(w.btYazilim.id);
    const done = await mine(w.btDestek.id, RecordStatus.KAPATILDI);
    await grant(w.admin.id, { userId: w.member.id, kind: 'REPORTS' });
    const memberHeaders = await loginAs(app, w.member.id);

    const preview = (await call(w.admin.id, 'GET', '/api/admin/handover/' + w.member.id)).json();
    expect(preview.open).toBe(3);

    const res = await call(w.admin.id, 'POST', '/api/admin/handover', { fromUserId: w.member.id, toUserId: w.mate.id, deactivate: true });
    expect(res.json()).toEqual({ assigned: 2, pooled: 1, deactivated: true });

    const get = (id: string) => prisma.record.findUniqueOrThrow({ where: { id } });
    expect(await get(a.id)).toMatchObject({ assigneeId: w.mate.id, status: RecordStatus.CALISILIYOR });
    expect(await get(b.id)).toMatchObject({ assigneeId: w.mate.id });
    expect(await get(c.id)).toMatchObject({ assigneeId: null, status: RecordStatus.YENI });
    expect(await get(done.id)).toMatchObject({ assigneeId: w.member.id });
    expect(await prisma.notification.count({ where: { userId: w.mate.id, type: 'ASSIGNED' } })).toBe(2);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.member.id } })).active).toBe(false);
    expect(await prisma.grant.count({ where: { userId: w.member.id } })).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: memberHeaders })).statusCode).toBe(401);
    const history = (await call(w.admin.id, 'GET', '/api/admin/grants/history')).json().items;
    expect(history[0]).toMatchObject({ action: 'handover.deactivate', detail: { assigned: 2, pooled: 1, to: 'Ekip Arkadaşı' } });
  });
});
