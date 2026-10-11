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
});
