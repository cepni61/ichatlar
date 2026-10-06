import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus, Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

/*
 * Kayıt uçlarının sunucu tarafı kuralları: görünürlük veritabanı sorgusunda,
 * yetki her aksiyonda yeniden. Arayüz düğmeyi gizlemeyi unutsa da sonuç aynı olmalı.
 */

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

async function world() {
  const ik = await createDept('İnsan Kaynakları');
  const kalite = await createDept('Kalite');
  return {
    ik, kalite,
    opener: await createUser({ name: 'Açan', departmentId: kalite.id }),
    ikMember: await createUser({ name: 'İK Üye', role: Role.TEAM_MEMBER, departmentId: ik.id }),
    ikMember2: await createUser({ name: 'İK Üye 2', role: Role.TEAM_MEMBER, departmentId: ik.id }),
    kaliteMember: await createUser({ name: 'Kalite Üye', role: Role.TEAM_MEMBER, departmentId: kalite.id }),
    admin: await createUser({ name: 'Admin', role: Role.ADMIN }),
  };
}

const as = (headers: { cookie: string }) => ({ headers });

describe('kayıt görünürlüğü', () => {
  beforeEach(resetDb);

  it('başka ekibin kaydı listede yok, detayda 404/403', async () => {
    const w = await world();
    const r = await createRecord({ createdById: w.opener.id, departmentId: w.ik.id });
    const h = await loginAs(app, w.kaliteMember.id);

    const list = await app.inject({ method: 'GET', url: '/api/records', ...as(h) });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(r.code);

    const detail = await app.inject({ method: 'GET', url: `/api/records/${r.code}`, ...as(h) });
    expect([403, 404]).toContain(detail.statusCode);
  });

  it('ekip üyesi ekibine düşen kaydı görür', async () => {
    const w = await world();
    const r = await createRecord({ createdById: w.opener.id, departmentId: w.ik.id });

    const res = await app.inject({ method: 'GET', url: `/api/records/${r.code}`, ...as(await loginAs(app, w.ikMember.id)) });
    expect(res.statusCode).toBe(200);
  });

  it('anonim kayıtta açan kimliği yanıtta yer almaz', async () => {
    const w = await world();
    const r = await createRecord({ createdById: w.opener.id, departmentId: w.ik.id, anonymous: true });

    const res = await app.inject({ method: 'GET', url: `/api/records/${r.code}`, ...as(await loginAs(app, w.ikMember.id)) });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(w.opener.id);
    expect(res.body).not.toContain(w.opener.email);
  });
});

describe('aksiyon yetkileri', () => {
  beforeEach(resetDb);

  it('başka ekipten üzerime al → 403, ekipten → 200 ve sahip atanır', async () => {
    const w = await world();
    const r = await createRecord({ createdById: w.opener.id, departmentId: w.ik.id });

    const denied = await app.inject({ method: 'POST', url: `/api/records/${r.code}/claim`, ...as(await loginAs(app, w.kaliteMember.id)) });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({ method: 'POST', url: `/api/records/${r.code}/claim`, ...as(await loginAs(app, w.ikMember.id)) });
    expect(ok.statusCode).toBe(200);
    const after = await prisma.record.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.assigneeId).toBe(w.ikMember.id);
    expect(after.status).toBe(RecordStatus.UZERIME_ALINDI);
  });

  it('sahibi olan kaydı ikinci kişi alamaz', async () => {
    const w = await world();
    const r = await createRecord({
      createdById: w.opener.id, departmentId: w.ik.id, assigneeId: w.ikMember.id, status: RecordStatus.UZERIME_ALINDI,
    });

    const res = await app.inject({ method: 'POST', url: `/api/records/${r.code}/claim`, ...as(await loginAs(app, w.ikMember2.id)) });
    expect(res.statusCode).toBe(403);
  });

  it('çözülen kaydı sahip kapatamaz, açan kapatır', async () => {
    const w = await world();
    const r = await createRecord({
      createdById: w.opener.id, departmentId: w.ik.id, assigneeId: w.ikMember.id, status: RecordStatus.COZULDU,
    });

    const byOwner = await app.inject({ method: 'POST', url: `/api/records/${r.code}/close`, ...as(await loginAs(app, w.ikMember.id)) });
    expect(byOwner.statusCode).toBe(403);

    const byOpener = await app.inject({ method: 'POST', url: `/api/records/${r.code}/close`, ...as(await loginAs(app, w.opener.id)) });
    expect(byOpener.statusCode).toBe(200);
    expect((await prisma.record.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(RecordStatus.KAPATILDI);
  });

  it('oturumsuz aksiyon 401', async () => {
    const w = await world();
    const r = await createRecord({ createdById: w.opener.id, departmentId: w.ik.id });
    const res = await app.inject({ method: 'POST', url: `/api/records/${r.code}/claim` });
    expect(res.statusCode).toBe(401);
  });
});

describe('raporlar', () => {
  beforeEach(resetDb);

  it('ekip üyesi 403, admin 200', async () => {
    const w = await world();
    const member = await app.inject({ method: 'GET', url: '/api/reports/summary', ...as(await loginAs(app, w.ikMember.id)) });
    const admin = await app.inject({ method: 'GET', url: '/api/reports/summary', ...as(await loginAs(app, w.admin.id)) });
    expect(member.statusCode).toBe(403);
    expect(admin.statusCode).toBe(200);
  });
});
