import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus, Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

/*
 * "Yalnızca ilgili ekip görsün" işareti (2026-10-08, kullanıcı isteği).
 * İşaretli kaydı yalnızca açan kişi ve ilgili ekip (üyeleri, yöneticisi,
 * sahibi) görür; 2026-10-09'dan beri sistem yöneticisi de göremez. İçerik
 * paylaşılan kanallara da çıkmaz: benzer çözüm önerileri, arama, öneri
 * havuzu ("Önerilerde"), rapor konuları ve başka ekiplerin CSV'si.
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
    kaliteMember: await createUser({ name: 'Kalite Üye', role: Role.TEAM_MEMBER, departmentId: kalite.id }),
    kaliteManager: await createUser({ name: 'Kalite Yönetici', role: Role.MANAGER, departmentId: kalite.id }),
    admin: await createUser({ name: 'Sistem', role: Role.ADMIN }),
  };
}

/** İK'da çözülmüş iki benzer kayıt: biri kısıtlı, biri değil. */
async function solvedPair(w: Awaited<ReturnType<typeof world>>) {
  const base = { createdById: w.opener.id, departmentId: w.ik.id, assigneeId: w.ikMember.id, status: RecordStatus.COZULDU };
  const secret = await createRecord({ ...base, title: 'Maaş haczi yazısı bordroya işlenmedi', resolution: 'Haciz yazısı bordro sistemine girildi.', restricted: true });
  const open = await createRecord({ ...base, title: 'Bordro pusulası portalda görünmüyor', resolution: 'Portal önbelleği temizlendi.' });
  return { secret, open };
}

describe('yalnızca ilgili ekip (kısıtlı kayıt)', () => {
  beforeEach(resetDb);

  it('kayıt açılırken işaretlenir; işaretsiz kayıt varsayılan olarak herkese açık kanallarda kalır', async () => {
    const w = await world();
    const h = { headers: await loginAs(app, w.opener.id) };
    const base = { type: 'bilgi', description: 'Ayrıntılı açıklama metni burada.', department: w.ik.id };

    const r1 = await app.inject({ method: 'POST', url: '/api/records', ...h, payload: { ...base, title: 'Kişisel konu başlığı', restricted: true } });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().record.restricted).toBe(true);

    const r2 = await app.inject({ method: 'POST', url: '/api/records', ...h, payload: { ...base, title: 'Genel konu başlığı' } });
    expect(r2.json().record.restricted).toBe(false);
  });

  it('başka ekibin üyesi kısıtlı kaydı açamaz', async () => {
    const w = await world();
    const { secret } = await solvedPair(w);
    const res = await app.inject({ method: 'GET', url: '/api/records/' + secret.code, headers: await loginAs(app, w.kaliteMember.id) });
    expect(res.statusCode).toBe(403);
  });

  it('sistem yöneticisi kısıtlı kaydı açamaz ve listesinde görmez', async () => {
    const w = await world();
    const { secret, open } = await solvedPair(w);
    const h = { headers: await loginAs(app, w.admin.id) };
    expect((await app.inject({ method: 'GET', url: '/api/records/' + secret.code, ...h })).statusCode).toBe(403);
    const list = (await app.inject({ method: 'GET', url: '/api/records?scope=all', ...h })).json();
    const codes = (list.records as { code: string }[]).map((r) => r.code);
    expect(codes).toContain(open.code);
    expect(codes).not.toContain(secret.code);
  });

  it('sistem yöneticisi kısıtlı kayıtta işlem yapamaz', async () => {
    const w = await world();
    const rec = await createRecord({ createdById: w.opener.id, departmentId: w.ik.id, restricted: true });
    const res = await app.inject({
      method: 'POST', url: `/api/records/${rec.code}/forward`, headers: await loginAs(app, w.admin.id),
      payload: { departmentId: w.kalite.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('sistem yöneticisi bildirimden kısıtlı kaydın başlığını görmez, ekini indiremez', async () => {
    const w = await world();
    const { secret } = await solvedPair(w);
    const h = { headers: await loginAs(app, w.admin.id) };

    await prisma.notification.create({ data: { userId: w.admin.id, recordId: secret.id, type: 'STATUS', text: 'Kayıt güncellendi.' } });
    const items = (await app.inject({ method: 'GET', url: '/api/notifications', ...h })).json().items as { record: { title: string | null; canOpen: boolean } }[];
    expect(items[0]!.record).toMatchObject({ title: null, canOpen: false });

    const ev = await prisma.recordEvent.create({ data: { recordId: secret.id, type: 'COMMENT', text: 'Ek', byId: w.ikMember.id } });
    const att = await prisma.attachment.create({
      data: { recordId: secret.id, eventId: ev.id, name: 'haciz.pdf', size: 4, mime: 'application/pdf', storageKey: 'yok', uploadedById: w.ikMember.id },
    });
    expect((await app.inject({ method: 'GET', url: '/api/attachments/' + att.id, ...h })).statusCode).toBe(404);
  });

  it('ilgili ekibin yöneticisi, üyesi ve kaydı açan görmeye devam eder', async () => {
    const w = await world();
    const ikManager = await createUser({ name: 'İK Yönetici', role: Role.MANAGER, departmentId: w.ik.id });
    const { secret } = await solvedPair(w);
    for (const id of [ikManager.id, w.opener.id, w.ikMember.id]) {
      const res = await app.inject({ method: 'GET', url: '/api/records/' + secret.code, headers: await loginAs(app, id) });
      expect(res.statusCode).toBe(200);
    }
  });

  it('benzer çözüm önerilerinde çıkmaz', async () => {
    const w = await world();
    const { secret, open } = await solvedPair(w);
    const res = await app.inject({
      method: 'POST', url: '/api/similar', headers: await loginAs(app, w.kaliteMember.id),
      payload: { title: 'Maaş haczi bordro pusulası', description: 'Haciz yazısı bordroya işlenmedi, pusulası portalda görünmüyor.' },
    });
    const codes = (res.json().matches as { code: string }[]).map((m) => m.code);
    expect(codes).toContain(open.code);
    expect(codes).not.toContain(secret.code);
  });

  it('öneri havuzuna eklenemez', async () => {
    const w = await world();
    const { secret } = await solvedPair(w);
    const h = { headers: await loginAs(app, w.ikMember.id) };
    const rec = (await app.inject({ method: 'GET', url: '/api/records/' + secret.code, ...h })).json().record;
    expect(rec.permissions.learn).toBe(false);
    const res = await app.inject({ method: 'POST', url: `/api/records/${secret.code}/learn`, ...h, payload: { on: true } });
    expect(res.statusCode).toBe(403);
  });

  it('"Çözüldü" penceresindeki "benzer kayıtlarda öner" kısıtlı kayıtta yok sayılır', async () => {
    const w = await world();
    const rec = await createRecord({
      createdById: w.opener.id, departmentId: w.ik.id, assigneeId: w.ikMember.id,
      status: RecordStatus.CALISILIYOR, restricted: true,
    });
    const res = await app.inject({
      method: 'POST', url: `/api/records/${rec.code}/resolve`, headers: await loginAs(app, w.ikMember.id),
      payload: { resolution: 'Sorun bordro biriminde giderildi.', learn: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.renewed).toBe(false);
  });

  it('rapor konularına girmez; başka ekibin yöneticisinin CSV\'sinde başlık gizlenir', async () => {
    const w = await world();
    await solvedPair(w);
    const sum = await app.inject({ method: 'GET', url: '/api/reports/summary', headers: await loginAs(app, w.admin.id) });
    expect(JSON.stringify(sum.json().topics)).not.toMatch(/haciz|haczi/i);

    const other = await app.inject({ method: 'GET', url: '/api/reports/export.csv', headers: await loginAs(app, w.kaliteManager.id) });
    expect(other.body).not.toContain('Maaş haczi');
    expect(other.body).toContain('Kısıtlı kayıt');

    // Sistem yöneticisi de ekip dışında sayılır (2026-10-09).
    const adm = await app.inject({ method: 'GET', url: '/api/reports/export.csv', headers: await loginAs(app, w.admin.id) });
    expect(adm.body).not.toContain('Maaş haczi');
    expect(adm.body).toContain('Kısıtlı kayıt');
  });
});

