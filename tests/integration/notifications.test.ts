import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { checkSlaBreaches, backfillSlaNotifications } from '../../src/jobs/slaWatcher.js';
import { RecordStatus, Role } from '../../src/domain/enums.js';
import {
  createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb, silentLog,
} from './helpers.js';

const past = () => new Date(Date.now() - 60_000);

let app: FastifyInstance;
afterAll(async () => { await app?.close(); });

async function team() {
  const ik = await createDept('İnsan Kaynakları');
  const kalite = await createDept('Kalite');
  const opener = await createUser({ name: 'Açan', departmentId: kalite.id });
  const member1 = await createUser({ name: 'Üye 1', role: Role.TEAM_MEMBER, departmentId: ik.id });
  const member2 = await createUser({ name: 'Üye 2', role: Role.TEAM_MEMBER, departmentId: ik.id });
  const manager = await createUser({ name: 'Yönetici', role: Role.MANAGER, departmentId: ik.id });
  const passive = await createUser({ name: 'Pasif', role: Role.TEAM_MEMBER, departmentId: ik.id, active: false });
  const outsider = await createUser({ name: 'Dışarıdan', role: Role.TEAM_MEMBER, departmentId: kalite.id });
  return { ik, kalite, opener, member1, member2, manager, passive, outsider };
}

const recipientsOf = async (recordId: string) =>
  (await prisma.notification.findMany({ where: { recordId }, select: { userId: true } })).map((n) => n.userId).sort();

describe('SLA ihlal bildirimi', () => {
  beforeEach(async () => {
    await resetDb();
    app ??= await makeApp();
  });

  it('sahipsiz kayıtta ekibin tamamına ve yöneticiye gider; pasif, açan ve başka ekip almaz', async () => {
    const t = await team();
    const r = await createRecord({ createdById: t.opener.id, departmentId: t.ik.id, slaDueAt: past() });

    const res = await checkSlaBreaches(silentLog);

    expect(res).toEqual({ breached: 1, notified: 3 });
    expect(await recipientsOf(r.id)).toEqual([t.member1.id, t.member2.id, t.manager.id].sort());
  });

  it('sahibi olan kayıtta yalnızca sahip ve yönetici alır', async () => {
    const t = await team();
    const r = await createRecord({
      createdById: t.opener.id, departmentId: t.ik.id, assigneeId: t.member1.id,
      status: RecordStatus.CALISILIYOR, slaDueAt: past(),
    });

    await checkSlaBreaches(silentLog);

    expect(await recipientsOf(r.id)).toEqual([t.member1.id, t.manager.id].sort());
  });

  it('ikinci çalıştırmada aynı kayda tekrar bildirim yazılmaz', async () => {
    const t = await team();
    const r = await createRecord({ createdById: t.opener.id, departmentId: t.ik.id, slaDueAt: past() });

    await checkSlaBreaches(silentLog);
    const second = await checkSlaBreaches(silentLog);
    const backfill = await backfillSlaNotifications(silentLog);

    expect(second.breached).toBe(0);
    expect(backfill.records).toBe(0);
    expect((await recipientsOf(r.id)).length).toBe(3);
  });

  it('süresi dolmamış ve kapanmış kayıtlar bildirim üretmez', async () => {
    const t = await team();
    await createRecord({ createdById: t.opener.id, departmentId: t.ik.id });
    await createRecord({ createdById: t.opener.id, departmentId: t.ik.id, status: RecordStatus.KAPATILDI, slaDueAt: past() });

    expect(await checkSlaBreaches(silentLog)).toEqual({ breached: 0 });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('akışa kaç kişinin bilgilendirildiği yazılır', async () => {
    const t = await team();
    const r = await createRecord({ createdById: t.opener.id, departmentId: t.ik.id, slaDueAt: past() });

    await checkSlaBreaches(silentLog);

    const ev = await prisma.recordEvent.findFirst({ where: { recordId: r.id, type: 'SLA_BREACH' } });
    expect(ev?.text).toContain('3 kişiye bildirim');
    expect(ev?.byId).toBeNull();
  });

  it('bildirim tablosundan önce işaretlenmiş açık ihlaller tamamlanır', async () => {
    const t = await team();
    const r = await createRecord({ createdById: t.opener.id, departmentId: t.ik.id, slaDueAt: past() });
    await prisma.record.update({ where: { id: r.id }, data: { slaBreachedAt: past() } });

    expect(await backfillSlaNotifications(silentLog)).toEqual({ records: 1, notified: 3 });
  });
});

describe('/api/notifications', () => {
  beforeEach(async () => {
    await resetDb();
    app ??= await makeApp();
  });

  it('oturumsuz istek 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(401);
  });

  it('kişi yalnızca kendi bildirimlerini görür', async () => {
    const t = await team();
    await createRecord({ createdById: t.opener.id, departmentId: t.ik.id, slaDueAt: past(), title: 'Bordro farkı' });
    await checkSlaBreaches(silentLog);

    const mine = await app.inject({ method: 'GET', url: '/api/notifications', headers: await loginAs(app, t.member1.id) });
    const other = await app.inject({ method: 'GET', url: '/api/notifications', headers: await loginAs(app, t.outsider.id) });

    expect(mine.json().unread).toBe(1);
    expect(mine.json().items[0].record).toMatchObject({ title: 'Bordro farkı', canOpen: true });
    expect(other.json()).toEqual({ unread: 0, items: [] });
  });

  it('kayıt başka ekibe yönlendirildiyse başlık gizlenir', async () => {
    const t = await team();
    const r = await createRecord({ createdById: t.opener.id, departmentId: t.ik.id, slaDueAt: past(), title: 'Gizli başlık' });
    await checkSlaBreaches(silentLog);
    await prisma.record.update({ where: { id: r.id }, data: { departmentId: t.kalite.id } });

    const res = await app.inject({ method: 'GET', url: '/api/notifications', headers: await loginAs(app, t.member1.id) });

    expect(res.json().items[0].record).toEqual({ code: r.code, title: null, canOpen: false });
  });

  it('okundu işareti yalnızca kişinin kendi bildirimlerini etkiler', async () => {
    const t = await team();
    await createRecord({ createdById: t.opener.id, departmentId: t.ik.id, slaDueAt: past() });
    await checkSlaBreaches(silentLog);
    const otherNote = await prisma.notification.findFirstOrThrow({ where: { userId: t.member2.id } });

    const headers = await loginAs(app, t.member1.id);
    // Başkasının bildirim kimliğini göndermek onu okundu yapmaz.
    const res = await app.inject({ method: 'POST', url: '/api/notifications/read', headers, payload: { ids: [otherNote.id] } });
    expect(res.json()).toEqual({ updated: 0 });

    const all = await app.inject({ method: 'POST', url: '/api/notifications/read', headers, payload: {} });
    expect(all.json()).toEqual({ updated: 1 });
    expect(await prisma.notification.count({ where: { userId: t.member2.id, readAt: null } })).toBe(1);
  });
});
