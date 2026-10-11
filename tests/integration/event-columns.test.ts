import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });

async function setup() {
  const t = await createDept('Bilgi Teknolojileri');
  const t2 = await createDept('Finans');
  const m = await createUser({ name: 'Üye', role: Role.TEAM_MEMBER, departmentId: t.id });
  const n = await createUser({ name: 'Ekip Arkadaşı', role: Role.TEAM_MEMBER, departmentId: t.id });
  const c = await createUser({ name: 'Açan' });
  const r = await createRecord({ createdById: c.id, departmentId: t.id });
  return { t, t2, m, n, c, r, mH: await loginAs(app, m.id), nH: await loginAs(app, n.id) };
}
const act = (headers: { cookie: string }, code: string, action: string, payload: object = {}) =>
  app.inject({ method: 'POST', url: `/api/records/${code}/${action}`, headers, payload });
const events = (recordId: string) =>
  prisma.recordEvent.findMany({ where: { recordId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });

describe('kayıt adımları', () => {
  it('olay meta alanı JSON nesnesi olarak saklanır', async () => {
    const { r, mH } = await setup();
    expect((await act(mH, r.code, 'claim')).statusCode).toBe(200);
    expect((await act(mH, r.code, 'status', { status: 'calisiliyor' })).statusCode).toBe(200);
    const ev = await prisma.recordEvent.findFirstOrThrow({ where: { recordId: r.id, type: 'STATUS' } });
    expect(ev.meta).toEqual({ from: 'UZERIME_ALINDI', to: 'CALISILIYOR' });
  });

  it('üstlenme, durum ve yönlendirme adımları tipli kolonlara yazılır', async () => {
    const { r, t2, m, n, mH, nH } = await setup();
    expect((await act(mH, r.code, 'claim')).statusCode).toBe(200);
    expect((await act(mH, r.code, 'status', { status: 'calisiliyor' })).statusCode).toBe(200);
    expect((await act(mH, r.code, 'forward', { assigneeId: n.id })).statusCode).toBe(200);
    expect((await act(nH, r.code, 'forward', { departmentId: t2.id })).statusCode).toBe(200);
    const ev = await events(r.id);
    expect(ev.map((e) => [e.type, e.fromStatus, e.toStatus, e.toTeamId, e.toUserId])).toEqual([
      ['ASSIGN', 'YENI', 'UZERIME_ALINDI', null, m.id],
      ['STATUS', 'UZERIME_ALINDI', 'CALISILIYOR', null, null],
      ['FORWARD', null, null, null, n.id],
      ['FORWARD', 'CALISILIYOR', 'YENI', t2.id, null],
    ]);
  });

  it('yöneticinin devretmesi hedef kişiyi, havuza dönüş durum geçişini yazar', async () => {
    const { r, m, n, mH } = await setup();
    const admin = await createUser({ name: 'Yönetici', role: Role.ADMIN });
    const aH = await loginAs(app, admin.id);
    await act(mH, r.code, 'claim');
    const handover = (toUserId: string | null) =>
      app.inject({ method: 'POST', url: '/api/admin/handover', headers: aH, payload: { fromUserId: m.id, toUserId, deactivate: false } });

    expect((await handover(n.id)).statusCode).toBe(200);
    expect((await events(r.id)).at(-1)).toMatchObject({ type: 'FORWARD', toUserId: n.id, fromStatus: null });

    const back = await app.inject({ method: 'POST', url: '/api/admin/handover', headers: aH, payload: { fromUserId: n.id, toUserId: null, deactivate: false } });
    expect(back.statusCode).toBe(200);
    expect((await events(r.id)).at(-1)).toMatchObject({ type: 'FORWARD', fromStatus: 'UZERIME_ALINDI', toStatus: 'YENI', toUserId: null });
  });
});
