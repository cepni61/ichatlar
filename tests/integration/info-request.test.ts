import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });

type Headers = { cookie: string };
const act = (headers: Headers, code: string, action: string, payload: object = {}) =>
  app.inject({ method: 'POST', url: `/api/records/${code}/${action}`, headers, payload });

async function setup() {
  const t = await createDept('İnsan Kaynakları');
  const t2 = await createDept('Finans');
  const m = await createUser({ name: 'Sahip', role: Role.TEAM_MEMBER, departmentId: t.id });
  const n = await createUser({ name: 'Ekip Arkadaşı', role: Role.TEAM_MEMBER, departmentId: t.id });
  const c = await createUser({ name: 'Açan' });
  const r = await createRecord({ createdById: c.id, departmentId: t.id });
  const h = { m: await loginAs(app, m.id), n: await loginAs(app, n.id), c: await loginAs(app, c.id) };
  await act(h.m, r.code, 'claim');
  await act(h.m, r.code, 'status', { status: 'calisiliyor' });
  return { t, t2, m, n, c, r, h };
}
const open = (recordId: string) =>
  prisma.infoRequest.findFirst({ where: { recordId, answeredAt: null, cancelledAt: null } });

describe('ek bilgi isteği', () => {
  it('sahip soruyla ister; kayıt ek bilgi bekler, açana bildirim gider, detayda soru görünür', async () => {
    const { r, c, h } = await setup();
    const res = await act(h.m, r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.status).toBe('ek_bilgi');
    expect(await open(r.id)).toMatchObject({ question: 'Hangi tarihten itibaren?', statusBefore: 'CALISILIYOR' });
    expect(await prisma.notification.count({ where: { userId: c.id, type: 'INFO_REQUESTED' } })).toBe(1);
    const ev = await prisma.recordEvent.findFirstOrThrow({ where: { recordId: r.id, type: 'INFO_REQUEST' } });
    expect(ev).toMatchObject({ fromStatus: 'CALISILIYOR', toStatus: 'EK_BILGI' });

    const detail = (await app.inject({ method: 'GET', url: `/api/records/${r.code}`, headers: h.c })).json().record;
    expect(detail.infoRequest).toMatchObject({ question: 'Hangi tarihten itibaren?' });
    expect(detail.permissions.infoRequest).toBe(false);
  });

  it('soru zorunlu, ikinci açık istek 409, açan isteyemez, durum listesinden ek bilgi seçilemez', async () => {
    const { r, h } = await setup();
    expect((await act(h.m, r.code, 'info-request', { question: 'kı' })).statusCode).toBe(400);
    expect((await act(h.c, r.code, 'info-request', { question: 'Açan soruyor mu?' })).statusCode).toBe(403);
    expect((await act(h.m, r.code, 'status', { status: 'ek_bilgi' })).statusCode).toBe(400);
    expect((await act(h.m, r.code, 'info-request', { question: 'İlk soru burada' })).statusCode).toBe(200);
    expect((await act(h.m, r.code, 'info-request', { question: 'İkinci soru burada' })).statusCode).toBe(409);
  });

  it('açanın güncellemesi yanıttır: istek kapanır, kayıt önceki durumuna döner, sahibe bildirim gider', async () => {
    const { r, m, c, h } = await setup();
    await act(h.m, r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    const res = await act(h.c, r.code, 'comments', { text: '1 Kasım’dan itibaren.' });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.status).toBe('calisiliyor');
    expect(res.json().record.infoRequest).toBeNull();

    const req = await prisma.infoRequest.findFirstOrThrow({ where: { recordId: r.id } });
    expect(req).toMatchObject({ answer: '1 Kasım’dan itibaren.', answeredById: c.id, cancelledAt: null });
    const ev = await prisma.recordEvent.findUniqueOrThrow({ where: { id: req.answerEventId! } });
    expect(ev).toMatchObject({ type: 'INFO_RESPONSE', fromStatus: 'EK_BILGI', toStatus: 'CALISILIYOR' });
    expect(await prisma.notification.count({ where: { userId: m.id, type: 'INFO_PROVIDED' } })).toBe(1);
  });

  it('ekipten birinin güncellemesi yanıt sayılmaz', async () => {
    const { r, h } = await setup();
    await act(h.m, r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    const res = await act(h.n, r.code, 'comments', { text: 'Ben de merak ediyorum.' });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.status).toBe('ek_bilgi');
    expect(await open(r.id)).not.toBeNull();
  });

  it('yanıt beklenmeden çözülen ya da başka ekibe giden kayıtta istek iptal olur', async () => {
    const a = await setup();
    await act(a.h.m, a.r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    expect((await act(a.h.m, a.r.code, 'resolve', { resolution: 'Bilgi olmadan da çözüldü, teşekkürler.' })).statusCode).toBe(200);
    expect((await prisma.infoRequest.findFirstOrThrow({ where: { recordId: a.r.id } })).cancelledAt).toBeTruthy();
    expect(await prisma.recordEvent.count({ where: { recordId: a.r.id, type: 'INFO_CANCEL' } })).toBe(1);

    await resetDb();
    const b = await setup();
    await act(b.h.m, b.r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    expect((await act(b.h.m, b.r.code, 'forward', { departmentId: b.t2.id })).statusCode).toBe(200);
    expect(await open(b.r.id)).toBeNull();
  });

  it('yöneticinin devretmesi: havuza dönüşte istek iptal, kişiye devirde açık kalır', async () => {
    const a = await setup();
    const admin = await createUser({ name: 'Yönetici', role: Role.ADMIN });
    const aH = await loginAs(app, admin.id);
    await act(a.h.m, a.r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    const handover = (fromUserId: string, toUserId: string | null) =>
      app.inject({ method: 'POST', url: '/api/admin/handover', headers: aH, payload: { fromUserId, toUserId, deactivate: false } });

    expect((await handover(a.m.id, a.n.id)).statusCode).toBe(200);
    expect(await open(a.r.id)).not.toBeNull();
    expect((await handover(a.n.id, null)).statusCode).toBe(200);
    expect(await open(a.r.id)).toBeNull();
    expect((await prisma.record.findUniqueOrThrow({ where: { id: a.r.id } })).status).toBe('YENI');
  });
});
