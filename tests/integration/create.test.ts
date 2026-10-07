import { rmSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '../../src/domain/enums.js';
import { createDept, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

/*
 * Yeni kayıt: bilgi talebi ve öneri ayrı formlardan gelir.
 *   bilgi → açıklama + öncelik
 *   öneri → mevcut durum + öneri + beklenen fayda; öncelik yok, tek ekip
 * Formda seçilen dosyalar kayıt oluşunca "kayıt oluşturuldu" olayına bağlanır.
 */

let app: FastifyInstance;
const storageDir = process.env.STORAGE_DIR!;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  await resetDb();
  rmSync(storageDir, { recursive: true, force: true });
});

async function world() {
  const ik = await createDept('İnsan Kaynakları');
  const kalite = await createDept('Kalite');
  const opener = await createUser({ name: 'Açan', departmentId: kalite.id });
  const other = await createUser({ name: 'Başkası', departmentId: kalite.id });
  const ikMember = await createUser({ name: 'İK Üye', role: Role.TEAM_MEMBER, departmentId: ik.id });
  return { ik, kalite, opener, other, ikMember };
}

async function create(userId: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/records', headers: await loginAs(app, userId), payload });
}

const oneri = (department: string, extra: Record<string, unknown> = {}) => ({
  type: 'oneri',
  title: 'Yemekhane sırası için ön sipariş',
  current: 'Öğle arasında yemekhanede 20 dakika sıra bekleniyor.',
  proposal: 'Intranet üzerinden sabah ön sipariş alınsın, tepsiler hazır beklesin.',
  benefits: ['zaman', 'calisan'],
  department,
  ...extra,
});

describe('öneri oluşturma', () => {
  it('öncelik ve açıklama olmadan oluşur; alanlar yapısal döner', async () => {
    const w = await world();
    const res = await create(w.opener.id, oneri(w.ik.id, { benefitNote: 'Ayda ~300 saat' }));
    expect(res.statusCode).toBe(201);
    const rec = res.json().record;
    expect(rec.type).toBe('oneri');
    expect(rec.priority).toBe('normal');
    expect(rec.oneri).toEqual({
      current: 'Öğle arasında yemekhanede 20 dakika sıra bekleniyor.',
      proposal: 'Intranet üzerinden sabah ön sipariş alınsın, tepsiler hazır beklesin.',
      benefits: ['zaman', 'calisan'],
      benefitNote: 'Ayda ~300 saat',
    });
    // Arama ve eski ekranlar için okunur birleşim.
    expect(rec.description).toContain('Mevcut durum: Öğle arasında');
    expect(rec.description).toContain('Beklenen fayda: Zaman ve verimlilik, Çalışan deneyimi — Ayda ~300 saat');
    expect(rec.history[0].text).toContain('değerlendirilmek üzere');
  });

  it('gönderilen "kritik" öncelik yok sayılır', async () => {
    const w = await world();
    const res = await create(w.opener.id, oneri(w.ik.id, { priority: 'kritik' }));
    expect(res.statusCode).toBe(201);
    expect(res.json().record.priority).toBe('normal');
  });

  it.each([
    ['mevcut durum kısa', { current: 'kısa' }, 'Mevcut durumu'],
    ['öneri eksik', { proposal: undefined }, 'Önerinizi'],
    ['fayda seçilmemiş', { benefits: [] }, 'beklenen fayda'],
    ['bilinmeyen fayda', { benefits: ['uydurma'] }, ''],
  ])('%s → 400', async (_name, extra, msg) => {
    const w = await world();
    const res = await create(w.opener.id, oneri(w.ik.id, extra));
    expect(res.statusCode).toBe(400);
    if (msg) expect(res.json().error.message).toContain(msg);
  });

  it('ikinci ekip seçilemez', async () => {
    const w = await world();
    const res = await create(w.opener.id, oneri(w.ik.id, { department2: w.kalite.id }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('tek bir ekibe');
  });
});

describe('bilgi talebi oluşturma', () => {
  it('açıklama zorunlu, öncelik korunur, öneri alanı boş', async () => {
    const w = await world();
    const bad = await create(w.opener.id, { type: 'bilgi', title: 'İzin bakiyesi', department: w.ik.id });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('Açıklama');

    const ok = await create(w.opener.id, {
      type: 'bilgi', title: 'İzin bakiyesi görünmüyor', description: 'Portalda yıllık izin bakiyem sıfır görünüyor.',
      department: w.ik.id, priority: 'yuksek',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().record).toMatchObject({ type: 'bilgi', priority: 'yuksek', oneri: null });
  });
});

/** Fastify inject için çok parçalı gövde. */
function multipart(name: string, content: string) {
  const boundary = '----ih' + Math.random().toString(16).slice(2);
  const payload = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--\r\n`, 'utf8');
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function uploadOnCreate(code: string, userId: string) {
  const body = multipart('Taslak Süreç.pdf', '%PDF-1.4 süreç');
  return app.inject({
    method: 'POST', url: `/api/records/${code}/attachments?bind=create`,
    headers: { ...(await loginAs(app, userId)), 'content-type': body.contentType }, payload: body.payload,
  });
}

describe('kayıt anında ek dosya', () => {
  it('dosya "kayıt oluşturuldu" olayına bağlanır, ekip görür', async () => {
    const w = await world();
    const code = (await create(w.opener.id, oneri(w.ik.id))).json().record.code;

    const up = await uploadOnCreate(code, w.opener.id);
    expect(up.statusCode).toBe(200);
    const [att] = up.json().attachments;

    const res = await app.inject({ method: 'GET', url: `/api/records/${code}`, headers: await loginAs(app, w.ikMember.id) });
    const rec = res.json().record;
    expect(rec.attachments.map((a: { id: string }) => a.id)).toEqual([att.id]);
    expect(rec.history[0].t).toBe('create');
    expect(rec.history[0].attachments.map((a: { name: string }) => a.name)).toEqual(['Taslak Süreç.pdf']);

    const dl = await app.inject({ method: 'GET', url: `/api/attachments/${att.id}`, headers: await loginAs(app, w.ikMember.id) });
    expect(dl.statusCode).toBe(200);
  });

  it('kaydı açan değilse 403', async () => {
    const w = await world();
    const code = (await create(w.opener.id, oneri(w.ik.id))).json().record.code;
    const up = await uploadOnCreate(code, w.ikMember.id);
    expect(up.statusCode).toBe(403);
  });

  it('30 dakikadan eski kayda bağlanamaz', async () => {
    const w = await world();
    const code = (await create(w.opener.id, oneri(w.ik.id))).json().record.code;
    await prisma.record.update({ where: { code }, data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) } });
    const up = await uploadOnCreate(code, w.opener.id);
    expect(up.statusCode).toBe(400);
  });
});
