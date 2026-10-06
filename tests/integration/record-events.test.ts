import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus, Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

/*
 * Kayıt olaylarında karşı tarafa bildirim ve yeniden açma:
 * kaydı açan kişi çözüldü / reddedildi / ek bilgi olaylarından haberdar olur,
 * çözüm işe yaramadıysa kaydı yeniden açabilir.
 */

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(resetDb);

async function world() {
  const ik = await createDept('İnsan Kaynakları');
  const kalite = await createDept('Kalite');
  const opener = await createUser({ name: 'Açan', departmentId: kalite.id });
  const owner = await createUser({ name: 'Sahip', role: Role.TEAM_MEMBER, departmentId: ik.id });
  const mate = await createUser({ name: 'Ekip arkadaşı', role: Role.TEAM_MEMBER, departmentId: ik.id });
  const rec = await createRecord({
    createdById: opener.id, departmentId: ik.id, assigneeId: owner.id, status: RecordStatus.CALISILIYOR,
  });
  return { ik, opener, owner, mate, rec };
}

const post = async (url: string, cookie: { cookie: string }, payload: object = {}) =>
  app.inject({ method: 'POST', url, headers: cookie, payload });

const notesOf = (userId: string) =>
  prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });

describe('kaydı açana bildirim', () => {
  it('çözülünce açan "çözüldü" bildirimi alır, çözen almaz', async () => {
    const w = await world();
    const res = await post(`/api/records/${w.rec.code}/resolve`, await loginAs(app, w.owner.id), {
      resolution: 'Bordro farkı bir sonraki maaşla ödenecek.',
    });
    expect(res.statusCode).toBe(200);

    const opener = await notesOf(w.opener.id);
    expect(opener.map((n) => n.type)).toEqual(['RESOLVED']);
    expect(opener[0]!.text).toContain(w.rec.code);
    expect(await notesOf(w.owner.id)).toEqual([]);
  });

  it('ek bilgi istenince açan bildirim alır; diğer ara durumlarda almaz', async () => {
    const w = await world();
    const h = await loginAs(app, w.owner.id);
    await post(`/api/records/${w.rec.code}/status`, h, { status: 'inceleniyor' });
    expect(await notesOf(w.opener.id)).toEqual([]);

    await post(`/api/records/${w.rec.code}/status`, h, { status: 'ek_bilgi', note: 'Bordro dönemini yazın' });
    expect((await notesOf(w.opener.id)).map((n) => n.type)).toEqual(['INFO_REQUESTED']);
  });

  it('reddedilince açan bildirim alır', async () => {
    const w = await world();
    await post(`/api/records/${w.rec.code}/reject`, await loginAs(app, w.owner.id), {
      reason: 'Bu konu Finans biriminin sorumluluğunda.',
    });
    expect((await notesOf(w.opener.id)).map((n) => n.type)).toEqual(['REJECTED']);
  });
});

describe('yorum bildirimi', () => {
  it('ekip yazınca açana, açan yazınca sahibe gider', async () => {
    const w = await world();
    await post(`/api/records/${w.rec.code}/comments`, await loginAs(app, w.owner.id), { text: 'Hangi ay?' });
    expect((await notesOf(w.opener.id)).map((n) => n.type)).toEqual(['COMMENT']);

    await post(`/api/records/${w.rec.code}/comments`, await loginAs(app, w.opener.id), { text: 'Eylül bordrosu.' });
    expect((await notesOf(w.owner.id)).map((n) => n.type)).toEqual(['COMMENT']);
  });

  it('aynı kayıtta ikinci yorum yeni satır açmaz, var olanı okunmamış yapar', async () => {
    const w = await world();
    const h = await loginAs(app, w.owner.id);
    await post(`/api/records/${w.rec.code}/comments`, h, { text: 'Birinci' });
    await prisma.notification.updateMany({ where: { userId: w.opener.id }, data: { readAt: new Date() } });

    await post(`/api/records/${w.rec.code}/comments`, h, { text: 'İkinci' });
    const notes = await notesOf(w.opener.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.readAt).toBeNull();
  });
});

describe('yeniden açma', () => {
  async function resolved() {
    const w = await world();
    await post(`/api/records/${w.rec.code}/resolve`, await loginAs(app, w.owner.id), {
      resolution: 'Fark bir sonraki maaşla ödenecek.',
    });
    return w;
  }

  it('açan, gerekçe yazarak çözülen kaydı yeniden açar; sahip bildirim alır', async () => {
    const w = await resolved();
    const res = await post(`/api/records/${w.rec.code}/reopen`, await loginAs(app, w.opener.id), {
      reason: 'Fark ödenmedi, ekim maaşında da yok.',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.status).toBe('calisiliyor');

    const rec = await prisma.record.findUniqueOrThrow({ where: { id: w.rec.id } });
    expect(rec.status).toBe(RecordStatus.CALISILIYOR);
    expect(rec.resolvedAt).toBeNull();
    expect(rec.resolution).toBeNull(); // işe yaramayan çözüm güncel çözüm gibi kalmaz
    expect((await notesOf(w.owner.id)).map((n) => n.type)).toEqual(['REOPENED']);
  });

  it('gerekçesiz yeniden açma 400', async () => {
    const w = await resolved();
    const res = await post(`/api/records/${w.rec.code}/reopen`, await loginAs(app, w.opener.id), { reason: 'kısa' });
    expect(res.statusCode).toBe(400);
  });

  it('kaydı açmayan kişi yeniden açamaz (403); çözülmemiş kayıt yeniden açılamaz', async () => {
    const w = await resolved();
    const byOwner = await post(`/api/records/${w.rec.code}/reopen`, await loginAs(app, w.mate.id), {
      reason: 'Ben de yeniden açmak istiyorum.',
    });
    expect(byOwner.statusCode).toBe(403);

    const open = await world();
    const notResolved = await post(`/api/records/${open.rec.code}/reopen`, await loginAs(app, open.opener.id), {
      reason: 'Henüz çözülmedi ama açayım.',
    });
    expect(notResolved.statusCode).toBe(403);
  });

  it('yetki listesi arayüze "reopen" bilgisini verir', async () => {
    const w = await resolved();
    const res = await app.inject({
      method: 'GET', url: `/api/records/${w.rec.code}`, headers: await loginAs(app, w.opener.id),
    });
    expect(res.json().record.permissions).toMatchObject({ reopen: true, close: true });
  });
});
