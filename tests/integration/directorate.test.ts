import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordType, Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });

async function setup() {
  const sp = await createDept('Spesifik Tedaviler');
  const spA = await createDept('Spesifik A', sp.id);
  const te = await createDept('Temel Tedaviler');
  const teA = await createDept('Temel A', te.id);
  const fi = await createDept('Finans');
  const fiA = await createDept('Finans A', fi.id);
  await prisma.department.updateMany({ where: { id: { in: [sp.id, te.id] } }, data: { directorate: 'Saha Grubu' } });

  const opener = await createUser({ name: 'Açan' });
  const temel = await createUser({ name: 'Temel Üyesi', role: Role.TEAM_MEMBER, departmentId: teA.id });
  const finans = await createUser({ name: 'Finans Üyesi', role: Role.TEAM_MEMBER, departmentId: fiA.id });
  const bilgi = await createRecord({ createdById: opener.id, departmentId: spA.id, title: 'Saha bilgi kaydı' });
  const oneri = await createRecord({ createdById: opener.id, departmentId: spA.id, type: RecordType.ONERI, title: 'Saha önerisi' });
  const gizli = await createRecord({ createdById: opener.id, departmentId: spA.id, restricted: true, title: 'Gizli saha kaydı' });
  return { bilgi, oneri, gizli, tH: await loginAs(app, temel.id), fH: await loginAs(app, finans.id) };
}
const allCodes = async (headers: { cookie: string }) =>
  (await app.inject({ method: 'GET', url: '/api/records?scope=all', headers })).json().records.map((r: { code: string }) => r.code);

describe('aynı direktörlükteki departmanlar', () => {
  it('birbirinin kayıt ve önerilerini Tüm Kayıtlar\'da görür; kısıtlı kayıt hariç', async () => {
    const { bilgi, oneri, gizli, tH } = await setup();
    const codes = await allCodes(tH);
    expect(codes).toEqual(expect.arrayContaining([bilgi.code, oneri.code]));
    expect(codes).not.toContain(gizli.code);
    const detail = await app.inject({ method: 'GET', url: `/api/records/${bilgi.code}`, headers: tH });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().record.inAllRecords).toBe(true);
  });

  it('görme yalnızca okumadır: yorum yazamaz', async () => {
    const { bilgi, tH } = await setup();
    const res = await app.inject({ method: 'POST', url: `/api/records/${bilgi.code}/comments`, headers: tH, payload: { text: 'Merhaba' } });
    expect(res.statusCode).toBe(403);
  });

  it('direktörlük dışındaki departman görmez', async () => {
    const { bilgi, oneri, fH } = await setup();
    const codes = await allCodes(fH);
    expect(codes).not.toContain(bilgi.code);
    expect(codes).not.toContain(oneri.code);
    expect((await app.inject({ method: 'GET', url: `/api/records/${bilgi.code}`, headers: fH })).statusCode).toBe(403);
  });
});
