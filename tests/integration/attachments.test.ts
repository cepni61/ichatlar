import { readdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus, Role } from '../../src/domain/enums.js';
import { pruneDraftAttachments } from '../../src/routes/attachments.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

/*
 * Ek dosyalar: güncelleme ya da çözümle birlikte gönderilir. Taslak → olaya
 * bağlanır → kaydı görebilen herkes indirir. Yetki, tür ve boyut sınırları.
 */

let app: FastifyInstance;
const storageDir = process.env.STORAGE_DIR!;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  await resetDb();
  rmSync(storageDir, { recursive: true, force: true });
});

/** Fastify inject için çok parçalı gövde. */
function multipart(files: { name: string; content: Buffer | string; type?: string }[]) {
  const boundary = '----ih' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\n` +
      `Content-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`, 'utf8'));
    chunks.push(Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

const filesOnDisk = () => {
  if (!existsSync(storageDir)) return 0;
  return readdirSync(storageDir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
};

async function world() {
  const ik = await createDept('İnsan Kaynakları');
  const kalite = await createDept('Kalite');
  const opener = await createUser({ name: 'Açan', departmentId: kalite.id });
  const owner = await createUser({ name: 'Sahip', role: Role.TEAM_MEMBER, departmentId: ik.id });
  const outsider = await createUser({ name: 'Başka ekip', role: Role.TEAM_MEMBER, departmentId: kalite.id });
  const rec = await createRecord({
    createdById: opener.id, departmentId: ik.id, assigneeId: owner.id, status: RecordStatus.CALISILIYOR,
  });
  return { opener, owner, outsider, rec };
}

async function upload(code: string, userId: string, files: Parameters<typeof multipart>[0]) {
  const body = multipart(files);
  const headers = { ...(await loginAs(app, userId)), 'content-type': body.contentType };
  return app.inject({ method: 'POST', url: `/api/records/${code}/attachments`, headers, payload: body.payload });
}

describe('ek dosya yükleme ve gönderme', () => {
  it('çözümle gönderilen ek olayın altında görünür, açan indirebilir', async () => {
    const w = await world();
    const up = await upload(w.rec.code, w.owner.id, [{ name: 'Çözüm Raporu.pdf', content: '%PDF-1.4 deneme', type: 'application/pdf' }]);
    expect(up.statusCode).toBe(200);
    const [att] = up.json().attachments;
    expect(att).toMatchObject({ name: 'Çözüm Raporu.pdf', mime: 'application/pdf', size: 15 });

    // Gönderilmeden önce taslak: kayıtta görünmez.
    const before = await app.inject({ method: 'GET', url: `/api/records/${w.rec.code}`, headers: await loginAs(app, w.opener.id) });
    expect(before.json().record.attachments).toEqual([]);

    const res = await app.inject({
      method: 'POST', url: `/api/records/${w.rec.code}/resolve`, headers: await loginAs(app, w.owner.id),
      payload: { resolution: 'Rapor ektedir, sorun giderildi.', attachmentIds: [att.id] },
    });
    expect(res.statusCode).toBe(200);
    const rec = res.json().record;
    expect(rec.attachments.map((a: { id: string }) => a.id)).toEqual([att.id]);
    expect(rec.history.at(-1).attachments.map((a: { id: string }) => a.id)).toEqual([att.id]);

    const dl = await app.inject({ method: 'GET', url: `/api/attachments/${att.id}`, headers: await loginAs(app, w.opener.id) });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe('%PDF-1.4 deneme');
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
  });

  it('yalnızca dosyayla güncelleme eklenebilir; metin "Dosya eklendi." olur', async () => {
    const w = await world();
    const up = await upload(w.rec.code, w.opener.id, [
      { name: 'ekran.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      { name: 'liste.xlsx', content: 'PK' },
    ]);
    const ids = up.json().attachments.map((a: { id: string }) => a.id);
    const res = await app.inject({
      method: 'POST', url: `/api/records/${w.rec.code}/comments`, headers: await loginAs(app, w.opener.id),
      payload: { attachmentIds: ids },
    });
    expect(res.statusCode).toBe(200);
    const last = res.json().record.history.at(-1);
    expect(last.text).toBe('2 dosya eklendi.');
    expect(last.attachments).toHaveLength(2);
  });

  it('boş güncelleme (metin de dosya da yok) 400', async () => {
    const w = await world();
    const res = await app.inject({
      method: 'POST', url: `/api/records/${w.rec.code}/comments`, headers: await loginAs(app, w.opener.id), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('ek dosya yetkisi', () => {
  it('kaydı göremeyen yükleyemez (403) ve indiremez (404)', async () => {
    const w = await world();
    const denied = await upload(w.rec.code, w.outsider.id, [{ name: 'a.pdf', content: 'x' }]);
    expect(denied.statusCode).toBe(403);

    const up = await upload(w.rec.code, w.owner.id, [{ name: 'a.pdf', content: 'x' }]);
    const id = up.json().attachments[0].id;
    await app.inject({
      method: 'POST', url: `/api/records/${w.rec.code}/comments`, headers: await loginAs(app, w.owner.id),
      payload: { text: 'Ek', attachmentIds: [id] },
    });
    const dl = await app.inject({ method: 'GET', url: `/api/attachments/${id}`, headers: await loginAs(app, w.outsider.id) });
    expect(dl.statusCode).toBe(404);
  });

  it('başkasının taslağı bağlanamaz ve indirilemez; yükleyen taslağını silebilir', async () => {
    const w = await world();
    const up = await upload(w.rec.code, w.owner.id, [{ name: 'taslak.txt', content: 'gizli' }]);
    const id = up.json().attachments[0].id;

    const steal = await app.inject({
      method: 'POST', url: `/api/records/${w.rec.code}/comments`, headers: await loginAs(app, w.opener.id),
      payload: { text: 'Bunu ben ekleyeyim', attachmentIds: [id] },
    });
    expect(steal.statusCode).toBe(400);
    const peek = await app.inject({ method: 'GET', url: `/api/attachments/${id}`, headers: await loginAs(app, w.opener.id) });
    expect(peek.statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: `/api/attachments/${id}`, headers: await loginAs(app, w.owner.id) });
    expect(del.statusCode).toBe(200);
    expect(await prisma.attachment.count()).toBe(0);
    expect(filesOnDisk()).toBe(0);
  });

  it('gönderilmiş ek silinemez', async () => {
    const w = await world();
    const up = await upload(w.rec.code, w.owner.id, [{ name: 'a.pdf', content: 'x' }]);
    const id = up.json().attachments[0].id;
    await app.inject({
      method: 'POST', url: `/api/records/${w.rec.code}/comments`, headers: await loginAs(app, w.owner.id),
      payload: { attachmentIds: [id] },
    });
    const del = await app.inject({ method: 'DELETE', url: `/api/attachments/${id}`, headers: await loginAs(app, w.owner.id) });
    expect(del.statusCode).toBe(404);
  });
});

describe('ek dosya sınırları', () => {
  it('izin verilmeyen tür 400; diske hiçbir şey yazılmaz', async () => {
    const w = await world();
    for (const name of ['sayfa.html', 'cizim.svg', 'kur.exe']) {
      const res = await upload(w.rec.code, w.owner.id, [{ name, content: '<script>alert(1)</script>' }]);
      expect(res.statusCode, name).toBe(400);
    }
    expect(await prisma.attachment.count()).toBe(0);
    expect(filesOnDisk()).toBe(0);
  });

  it('boyut sınırını aşan dosya 413; yarım dosya bırakılmaz', async () => {
    const w = await world();
    const big = Buffer.alloc(1024 * 1024 + 10, 0x41); // test sınırı 1 MB
    const res = await upload(w.rec.code, w.owner.id, [
      { name: 'kucuk.txt', content: 'tamam' },
      { name: 'buyuk.pdf', content: big },
    ]);
    expect(res.statusCode).toBe(413);
    expect(await prisma.attachment.count()).toBe(0);
    expect(filesOnDisk()).toBe(0);
  });

  it('24 saatten eski gönderilmemiş taslaklar temizlenir, gönderilenler kalır', async () => {
    const w = await world();
    const a = (await upload(w.rec.code, w.owner.id, [{ name: 'eski.txt', content: 'x' }])).json().attachments[0].id;
    const b = (await upload(w.rec.code, w.owner.id, [{ name: 'gonderilen.txt', content: 'y' }])).json().attachments[0].id;
    await app.inject({
      method: 'POST', url: `/api/records/${w.rec.code}/comments`, headers: await loginAs(app, w.owner.id),
      payload: { attachmentIds: [b] },
    });
    await prisma.attachment.updateMany({ data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });

    expect(await pruneDraftAttachments()).toBe(1);
    expect((await prisma.attachment.findMany({ select: { id: true } })).map((x) => x.id)).toEqual([b]);
    expect(filesOnDisk()).toBe(1);
    expect(path.isAbsolute(storageDir)).toBe(true);
  });
});
