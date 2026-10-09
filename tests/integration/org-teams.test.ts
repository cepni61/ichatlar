import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus, Role } from '../../src/domain/enums.js';
import { applyOrgConfig } from '../../src/setup/org-config.js';
import { ensureModel } from '../../src/ml/service.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb, silentLog } from './helpers.js';

/*
 * Departman → Ekip (kullanıcı isteği, 2026-10-09).
 *  - Kayıt ve kişi ekibe bağlanır; ekipleri olan departman doğrudan seçilemez.
 *  - Tüm Kayıtlar: kişinin departmanındaki bütün ekiplerin kayıtları (sistem
 *    yöneticisi: bütün departmanlar). "Yalnızca ilgili ekip" kayıtları hiç yok.
 *  - Departmandaki diğer ekiplerin kaydı okunur ama yorum/dosya ilgili ekipte.
 *  - Kısıtlı kayıt başka ekibe yönlendirilemez, ML hafızasına girmez.
 *  - Raporlar: Departman ve onun altındaki Ekip filtresi.
 */

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

const as = (headers: { cookie: string }) => ({ headers });

async function world() {
  const ik = await createDept('İnsan Kaynakları');
  const ikMain = await createDept('İnsan Kaynakları', ik.id);
  const isg = await createDept('İş Sağlığı', ik.id);
  const fin = await createDept('Finans');
  const finMain = await createDept('Finans', fin.id);
  return {
    ik, ikMain, isg, fin, finMain,
    ikMember: await createUser({ name: 'İK Üye', role: Role.TEAM_MEMBER, departmentId: ikMain.id }),
    ikMate: await createUser({ name: 'İK Arkadaş', role: Role.TEAM_MEMBER, departmentId: ikMain.id }),
    isgMember: await createUser({ name: 'İSG Üye', role: Role.TEAM_MEMBER, departmentId: isg.id }),
    finMember: await createUser({ name: 'Finans Üye', role: Role.TEAM_MEMBER, departmentId: finMain.id }),
    admin: await createUser({ name: 'Sistem', role: Role.ADMIN }),
  };
}

describe('departman → ekip', () => {
  beforeEach(resetDb);

  it('Tüm Kayıtlar: departmandaki bütün ekiplerin kayıtları; başka departman ve kısıtlı kayıt yok', async () => {
    const w = await world();
    const ikRec = await createRecord({ createdById: w.finMember.id, departmentId: w.ikMain.id });
    const isgRec = await createRecord({ createdById: w.finMember.id, departmentId: w.isg.id });
    const finRec = await createRecord({ createdById: w.ikMember.id, departmentId: w.finMain.id });
    const secret = await createRecord({ createdById: w.ikMember.id, departmentId: w.ikMain.id, restricted: true });

    const list = async (userId: string, q = 'scope=all') =>
      ((await app.inject({ method: 'GET', url: `/api/records?${q}`, ...as(await loginAs(app, userId)) })).json().records as { code: string }[])
        .map((r) => r.code);

    const isgView = await list(w.isgMember.id);
    expect(isgView).toEqual(expect.arrayContaining([ikRec.code, isgRec.code]));
    expect(isgView).not.toContain(finRec.code);
    expect(isgView).not.toContain(secret.code);

    // Kaydı açan da Tüm Kayıtlar'da görmez (Açtıklarım'da görür); başka departmana açtığı da yok.
    const ikView = await list(w.ikMember.id);
    expect(ikView).not.toContain(secret.code);
    expect(ikView).not.toContain(finRec.code);
    expect(await list(w.ikMember.id, 'scope=opened')).toEqual(expect.arrayContaining([secret.code, finRec.code]));
    expect(await list(w.ikMember.id, 'scope=team')).toContain(secret.code);

    const adminView = await list(w.admin.id);
    expect(adminView).toEqual(expect.arrayContaining([ikRec.code, isgRec.code, finRec.code]));
    expect(adminView).not.toContain(secret.code);

    // Departman ve ekip süzgeçleri
    expect(await list(w.admin.id, `scope=all&root=${w.ik.id}`)).toEqual(expect.arrayContaining([ikRec.code, isgRec.code]));
    expect(await list(w.admin.id, `scope=all&root=${w.ik.id}`)).not.toContain(finRec.code);
    expect(await list(w.admin.id, `scope=all&dept=${w.isg.id}`)).toEqual([isgRec.code]);
  });

  it('departmandaki diğer ekibin kaydı okunur, yorum yazılamaz; kısıtlı olanı açılamaz', async () => {
    const w = await world();
    const open = await createRecord({ createdById: w.finMember.id, departmentId: w.ikMain.id });
    const secret = await createRecord({ createdById: w.finMember.id, departmentId: w.ikMain.id, restricted: true });
    const h = as(await loginAs(app, w.isgMember.id));

    const res = await app.inject({ method: 'GET', url: '/api/records/' + open.code, ...h });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.permissions).toMatchObject({ comment: false, claim: false, forward: false });
    expect(res.json().record.departmentRoot).toBe(w.ik.id);

    const comment = await app.inject({ method: 'POST', url: `/api/records/${open.code}/comments`, ...h, payload: { text: 'Merhaba, bilgi.' } });
    expect(comment.statusCode).toBe(403);

    expect((await app.inject({ method: 'GET', url: '/api/records/' + secret.code, ...h })).statusCode).toBe(403);
    // Başka departmandan hiç görünmez.
    const fin = as(await loginAs(app, w.finMember.id));
    const other = await createRecord({ createdById: w.ikMember.id, departmentId: w.isg.id });
    expect((await app.inject({ method: 'GET', url: '/api/records/' + other.code, ...fin })).statusCode).toBe(403);
  });

  it('kayıt ekibe açılır: ekipleri olan departman doğrudan seçilemez', async () => {
    const w = await world();
    const h = as(await loginAs(app, w.finMember.id));
    const base = { type: 'bilgi', title: 'Bordro pusulası görünmüyor', description: 'Bu ay pusulam portalda açılmıyor.' };

    const toDept = await app.inject({ method: 'POST', url: '/api/records', ...h, payload: { ...base, department: w.ik.id } });
    expect(toDept.statusCode).toBe(400);

    const toTeam = await app.inject({ method: 'POST', url: '/api/records', ...h, payload: { ...base, department: w.isg.id } });
    expect(toTeam.statusCode).toBe(201);
    expect(toTeam.json().record).toMatchObject({ department: w.isg.id, departmentRoot: w.ik.id });
  });

  it('kısıtlı kayıt başka ekibe yönlendirilemez; ekip içinde kişiye devredilebilir', async () => {
    const w = await world();
    const secret = await createRecord({
      createdById: w.finMember.id, departmentId: w.ikMain.id, assigneeId: w.ikMember.id,
      status: RecordStatus.CALISILIYOR, restricted: true,
    });
    const h = as(await loginAs(app, w.ikMember.id));

    const toTeam = await app.inject({ method: 'POST', url: `/api/records/${secret.code}/forward`, ...h, payload: { departmentId: w.isg.id } });
    expect(toTeam.statusCode).toBe(403);
    expect((await prisma.record.findUnique({ where: { id: secret.id } }))!.departmentId).toBe(w.ikMain.id);

    const toMate = await app.inject({ method: 'POST', url: `/api/records/${secret.code}/forward`, ...h, payload: { assigneeId: w.ikMate.id } });
    expect(toMate.statusCode).toBe(200);

    // Kısıtsız kayıt yönlendirilir — ama ekibi olan departmana değil, ekibe.
    const open = await createRecord({ createdById: w.finMember.id, departmentId: w.ikMain.id });
    const toDept = await app.inject({ method: 'POST', url: `/api/records/${open.code}/forward`, ...h, payload: { departmentId: w.ik.id } });
    expect(toDept.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: `/api/records/${open.code}/forward`, ...h, payload: { departmentId: w.isg.id } });
    expect(ok.statusCode).toBe(200);
  });

  it('kısıtlı kayıt ML eğitimine girmez', async () => {
    const w = await world();
    const base = { createdById: w.finMember.id, departmentId: w.ikMain.id, status: RecordStatus.COZULDU, resolution: 'Çözüldü.' };
    await createRecord({ ...base, title: 'Bordro pusulası portalda görünmüyor' });
    await createRecord({ ...base, title: 'Maaş haczi yazısı bordroya işlenmedi', restricted: true });

    const m = await ensureModel(silentLog, { force: true });
    expect(m?.model.totalDocs).toBe(1);
  });

  it('raporlar: departman (ekipleriyle) ve ekip filtresi; ekip departmanın altında olmalı', async () => {
    const w = await world();
    await createRecord({ createdById: w.finMember.id, departmentId: w.ikMain.id });
    await createRecord({ createdById: w.finMember.id, departmentId: w.isg.id });
    await createRecord({ createdById: w.ikMember.id, departmentId: w.finMain.id });
    const h = as(await loginAs(app, w.admin.id));
    const get = (q: string) => app.inject({ method: 'GET', url: '/api/reports/summary' + q, ...h });

    const all = (await get('')).json();
    expect(all.byDepartmentLevel).toBe('department');
    expect(all.byDepartment.find((d: { id: string }) => d.id === w.ik.id).total).toBe(2);

    const ik = (await get(`?department=${w.ik.id}`)).json();
    expect(ik.totals.records).toBe(2);
    expect(ik.byDepartmentLevel).toBe('team');
    expect(ik.byDepartment.map((d: { id: string }) => d.id).sort()).toEqual([w.ikMain.id, w.isg.id].sort());

    const isg = (await get(`?department=${w.ik.id}&team=${w.isg.id}`)).json();
    expect(isg.totals.records).toBe(1);
    expect(isg.filter.team).toMatchObject({ id: w.isg.id, name: 'İş Sağlığı' });

    expect((await get(`?department=${w.fin.id}&team=${w.isg.id}`)).statusCode).toBe(400);
    // Ekip departman yerine verilemez.
    expect((await get(`?department=${w.isg.id}`)).statusCode).toBe(400);
  });
});

describe('kurulum: departman altına ekip', () => {
  beforeEach(resetDb);

  const sla = { NORMAL: 48, YUKSEK: 24, KRITIK: 8, warnRatio: 0.7 };

  it('ekipleri yazar; departmana bağlı kayıt ve kişiyi asıl ekibe taşır; tekrar çalıştırmak güvenli', async () => {
    await applyOrgConfig(prisma, { departments: [{ id: 'ik', name: 'İnsan Kaynakları', short: 'İK' }], sla });
    const u = await createUser({ name: 'Ayşe', departmentId: 'ik' });
    const rec = await createRecord({ createdById: u.id, departmentId: 'ik' });

    const config = {
      departments: [{
        id: 'ik', name: 'İnsan Kaynakları', short: 'İK',
        teams: [
          { id: 'ik-is-sagligi', name: 'İş Sağlığı', short: 'İş Sağlığı' },
          { id: 'ik-insan-kaynaklari', name: 'İnsan Kaynakları', short: 'İK', main: true },
        ],
      }],
      sla,
    };
    const r = await applyOrgConfig(prisma, config);
    expect(r.created.sort()).toEqual(['ik-insan-kaynaklari', 'ik-is-sagligi']);
    expect(r.moved).toEqual({ records: 1, users: 1, kb: 0 });
    expect(await prisma.department.findUnique({ where: { id: 'ik-is-sagligi' } })).toMatchObject({ parentId: 'ik', order: 1 });
    expect((await prisma.record.findUnique({ where: { id: rec.id } }))!.departmentId).toBe('ik-insan-kaynaklari');
    expect((await prisma.user.findUnique({ where: { id: u.id } }))!.departmentId).toBe('ik-insan-kaynaklari');

    const again = await applyOrgConfig(prisma, config);
    expect(again).toEqual({ created: [], updated: [], notInConfig: [], moved: { records: 0, users: 0, kb: 0 } });
  });
});
