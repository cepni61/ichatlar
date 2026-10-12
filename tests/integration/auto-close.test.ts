import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus, Role } from '../../src/domain/enums.js';
import { autoCloseResolved } from '../../src/jobs/autoClose.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb, silentLog } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });

type Headers = { cookie: string };
const act = (headers: Headers, code: string, action: string, payload: object = {}) =>
  app.inject({ method: 'POST', url: `/api/records/${code}/${action}`, headers, payload });
const row = (id: string) => prisma.record.findUniqueOrThrow({ where: { id } });

async function setup() {
  const t = await createDept('İnsan Kaynakları');
  const m = await createUser({ name: 'Sahip', role: Role.TEAM_MEMBER, departmentId: t.id });
  const c = await createUser({ name: 'Açan' });
  const mH = await loginAs(app, m.id);
  const cH = await loginAs(app, c.id);
  const solved = async () => {
    const r = await createRecord({ createdById: c.id, departmentId: t.id, assigneeId: m.id, status: RecordStatus.CALISILIYOR });
    expect((await act(mH, r.code, 'resolve', { resolution: 'Çözüm burada yazılı.' })).statusCode).toBe(200);
    return r;
  };
  return { t, m, c, mH, cH, solved };
}
const past = () => new Date(Date.now() - 60_000);

describe('çözülen kaydın kendiliğinden kapanması', () => {
  it('çözülen kayda kapanma zamanı yazılır ve kayıtla birlikte gönderilir', async () => {
    const { solved, cH } = await setup();
    const r = await solved();
    const at = (await row(r.id)).autoCloseAt;
    expect(at).toBeInstanceOf(Date);
    expect(at!.getTime()).toBeGreaterThan(Date.now());
    const detail = (await app.inject({ method: 'GET', url: `/api/records/${r.code}`, headers: cH })).json().record;
    expect(detail.autoCloseAt).toBe(at!.toISOString());
  });

  it('süresi dolan çözülmüş kayıt sistem tarafından kapatılır', async () => {
    const { solved } = await setup();
    const r = await solved();
    await prisma.record.update({ where: { id: r.id }, data: { autoCloseAt: past() } });
    expect(await autoCloseResolved(silentLog)).toBe(1);
    const after = await row(r.id);
    expect(after).toMatchObject({ status: 'KAPATILDI', autoCloseAt: null });
    expect(after.closedAt).toBeInstanceOf(Date);
    const ev = await prisma.recordEvent.findFirstOrThrow({ where: { recordId: r.id, toStatus: 'KAPATILDI' } });
    expect(ev).toMatchObject({ type: 'STATUS', byId: null, fromStatus: 'COZULDU' });
  });

  it('süresi dolmamış, eski (zamanı olmayan) ve yeniden açılmış kayda dokunulmaz', async () => {
    const { solved, c, t, cH } = await setup();
    const fresh = await solved();
    const old = await createRecord({ createdById: c.id, departmentId: t.id, status: RecordStatus.COZULDU });
    const reopened = await solved();
    await prisma.record.update({ where: { id: reopened.id }, data: { autoCloseAt: past() } });
    expect((await act(cH, reopened.code, 'reopen', { reason: 'Çözüm işe yaramadı, tekrar bakın lütfen.' })).statusCode).toBe(200);

    expect(await autoCloseResolved(silentLog)).toBe(0);
    expect((await row(fresh.id)).status).toBe('COZULDU');
    expect((await row(old.id)).status).toBe('COZULDU');
    expect(await row(reopened.id)).toMatchObject({ status: 'CALISILIYOR', autoCloseAt: null });
  });

  it('açanın güncellemesi süreyi yeniler; ekipten birininki yenilemez', async () => {
    const { solved, mH, cH } = await setup();
    const r = await solved();
    const soon = new Date(Date.now() + 60_000);
    await prisma.record.update({ where: { id: r.id }, data: { autoCloseAt: soon } });

    await act(mH, r.code, 'comments', { text: 'Ek not: ayarları da kontrol edin.' });
    expect((await row(r.id)).autoCloseAt).toEqual(soon);

    await act(cH, r.code, 'comments', { text: 'Tam olmadı galiba, bakıyorum.' });
    expect((await row(r.id)).autoCloseAt!.getTime()).toBeGreaterThan(soon.getTime());
  });

  it('kapatılan kaydın kapanma zamanı silinir', async () => {
    const { solved, cH } = await setup();
    const r = await solved();
    expect((await act(cH, r.code, 'close')).statusCode).toBe(200);
    expect(await row(r.id)).toMatchObject({ status: 'KAPATILDI', autoCloseAt: null });
  });
});
