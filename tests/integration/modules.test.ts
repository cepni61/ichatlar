import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus, RecordType, Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

/*
 * Yeni modüller: öneri değerlendirme durumları, yenilenen kayıt (ML hafızası),
 * uygulama geri bildirimi, Bilgi Bankası yetkileri, Sık Sorulanlar ve Arama.
 */

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(resetDb);

async function world() {
  const ik = await createDept('İnsan Kaynakları');
  const bt = await createDept('Bilgi Teknolojileri');
  return {
    ik, bt,
    opener: await createUser({ name: 'Açan', departmentId: bt.id }),
    ikMember: await createUser({ name: 'İK Üye', role: Role.TEAM_MEMBER, departmentId: ik.id }),
    ikManager: await createUser({ name: 'İK Müdür', role: Role.MANAGER, departmentId: ik.id }),
    btMember: await createUser({ name: 'BT Üye', role: Role.TEAM_MEMBER, departmentId: bt.id }),
    admin: await createUser({ name: 'Admin', role: Role.ADMIN }),
  };
}

const post = async (userId: string, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url, headers: await loginAs(app, userId), payload: payload as object });
const get = async (userId: string, url: string) =>
  app.inject({ method: 'GET', url, headers: await loginAs(app, userId) });

describe('öneri değerlendirme akışı', () => {
  it('üzerine alınca Değerlendiriliyor; sonuç seçilince son durum ve öneri sahibine bildirim', async () => {
    const w = await world();
    const r = await createRecord({ createdById: w.opener.id, departmentId: w.ik.id, type: RecordType.ONERI });

    const claim = await post(w.ikMember.id, `/api/records/${r.code}/claim`);
    expect(claim.statusCode).toBe(200);
    expect(claim.json().record.status).toBe('degerlendiriliyor');
    expect(claim.json().record.permissions).toMatchObject({ evaluate: true, resolve: false, reject: false });
    expect(await prisma.notification.count({ where: { userId: w.opener.id, type: 'EVALUATING' } })).toBe(1);

    const ev = await post(w.ikMember.id, `/api/records/${r.code}/evaluate`, {
      outcome: 'fayda_sagladi', note: 'Öneri uygulamaya alındı, teşekkürler.',
    });
    expect(ev.statusCode).toBe(200);
    const rec = ev.json().record;
    expect(rec.status).toBe('fayda_sagladi');
    expect(rec.resolution).toBe('Öneri uygulamaya alındı, teşekkürler.');
    expect(rec.permissions.close).toBe(false);
    expect(await prisma.notification.count({ where: { userId: w.opener.id, type: 'EVALUATED' } })).toBe(1);
  });

  it('öneri çözülemez/reddedilemez; bilgi değerlendirilemez; öneride yalnızca öneri ara durumları', async () => {
    const w = await world();
    const o = await createRecord({ createdById: w.opener.id, departmentId: w.ik.id, type: RecordType.ONERI, assigneeId: w.ikMember.id, status: RecordStatus.DEGERLENDIRILIYOR });
    const b = await createRecord({ createdById: w.opener.id, departmentId: w.ik.id, assigneeId: w.ikMember.id, status: RecordStatus.CALISILIYOR });

    expect((await post(w.ikMember.id, `/api/records/${o.code}/resolve`, { resolution: 'Çözüldü diye işaretle.' })).statusCode).toBe(403);
    expect((await post(w.ikMember.id, `/api/records/${b.code}/evaluate`, { outcome: 'degerlendirildi', note: 'Değerlendirdim bunu.' })).statusCode).toBe(403);
    expect((await post(w.ikMember.id, `/api/records/${o.code}/status`, { status: 'calisiliyor' })).statusCode).toBe(400);
    const ek = await post(w.ikMember.id, `/api/records/${o.code}/status`, { status: 'ek_bilgi' });
    expect(ek.json().record.status).toBe('ek_bilgi');
    expect((await post(w.ikMember.id, `/api/records/${o.code}/evaluate`, { outcome: 'uygun_bulunmadi', note: 'kısa' })).statusCode).toBe(400);
  });
});

describe('yenilenen kayıt (ML hafızası)', () => {
  it('çözerken kutucuk işaretlenirse kayıt yenilenen olur; benzer aramada onaylı çözüm', async () => {
    const w = await world();
    const r = await createRecord({
      createdById: w.opener.id, departmentId: w.ik.id, assigneeId: w.ikMember.id,
      status: RecordStatus.CALISILIYOR, title: 'Bordro kesintisi hatalı görünüyor',
    });
    const res = await post(w.ikMember.id, `/api/records/${r.code}/resolve`, {
      resolution: 'Kesinti düzeltildi, fark bu ayki bordroya eklendi.', learn: true,
    });
    expect(res.json().record).toMatchObject({ status: 'cozuldu', renewed: true });

    const sim = await post(w.btMember.id, '/api/similar', { title: 'Bordro kesintisi hatalı', description: '' });
    const m = sim.json().matches.find((x: { code: string }) => x.code === r.code);
    expect(m).toMatchObject({ verified: true, source: 'kayit' });
  });

  it('işareti yalnızca çözen kişi ya da sistem yöneticisi değiştirir', async () => {
    const w = await world();
    const r = await createRecord({
      createdById: w.opener.id, departmentId: w.ik.id, assigneeId: w.ikMember.id,
      status: RecordStatus.COZULDU, resolution: 'Çözüm metni burada.',
    });
    expect((await post(w.opener.id, `/api/records/${r.code}/learn`, { on: true })).statusCode).toBe(403);
    const ok = await post(w.ikMember.id, `/api/records/${r.code}/learn`, { on: true });
    expect(ok.json().record.renewed).toBe(true);
    const off = await post(w.admin.id, `/api/records/${r.code}/learn`, { on: false });
    expect(off.json().record.renewed).toBe(false);
  });
});

describe('uygulama geri bildirimi', () => {
  it('kaydedilir, sistem yöneticisine bildirim düşer, yalnızca yönetici listeler', async () => {
    const w = await world();
    const res = await post(w.opener.id, '/api/feedback', { text: 'Raporlar ekranında dışa aktarım çok yavaş.', page: 'reports' });
    expect(res.statusCode).toBe(201);
    expect(await prisma.feedback.count()).toBe(1);

    const notifs = (await get(w.admin.id, '/api/notifications')).json();
    expect(notifs.items[0]).toMatchObject({ type: 'FEEDBACK', record: null, view: 'management' });

    expect((await get(w.opener.id, '/api/feedback')).statusCode).toBe(403);
    const list = (await get(w.admin.id, '/api/feedback')).json();
    expect(list.items[0]).toMatchObject({ text: 'Raporlar ekranında dışa aktarım çok yavaş.', page: 'reports', read: false });
    expect(list.items[0].user.name).toBe('Açan');

    expect((await post(w.admin.id, `/api/feedback/${list.items[0].id}/read`)).statusCode).toBe(200);
    expect((await get(w.admin.id, '/api/feedback')).json().unread).toBe(0);

    expect((await post(w.opener.id, '/api/feedback', { text: 'kı' })).statusCode).toBe(400);
  });
});

describe('Bilgi Bankası', () => {
  const article = (departmentId: string, extra: Record<string, unknown> = {}) => ({
    kind: 'UYGULAMA', departmentId, title: 'Bordro ve ücret pusulası',
    keywords: 'bordro, maaş, ücret pusulası', answer: 'Bordronuzu İK portalındaki Bordro ekranından görebilirsiniz.',
    url: 'https://ikportal.ornek.com/bordro', ...extra,
  });

  it('ekip üyesi göremez; yönetici yalnızca kendi ekibine yazar; yetki verilen kişi o ekibe yazar', async () => {
    const w = await world();
    expect((await get(w.ikMember.id, '/api/kb')).statusCode).toBe(403);
    expect((await get(w.ikManager.id, '/api/kb')).statusCode).toBe(200);

    expect((await post(w.ikManager.id, '/api/kb', article(w.ik.id))).statusCode).toBe(201);
    expect((await post(w.ikManager.id, '/api/kb', article(w.bt.id))).statusCode).toBe(403);

    // Sistem yöneticisi BT üyesine BT için yetki verir.
    expect((await post(w.btMember.id, '/api/kb', article(w.bt.id))).statusCode).toBe(403);
    expect((await post(w.admin.id, '/api/kb/editors', { userId: w.btMember.id, departmentId: w.bt.id })).statusCode).toBe(201);
    expect((await post(w.btMember.id, '/api/kb', article(w.bt.id, { title: 'SAP erişimi' }))).statusCode).toBe(201);
    const boot = (await get(w.btMember.id, '/api/bootstrap')).json();
    expect(boot.kb).toMatchObject({ view: true, admin: false, edit: [w.bt.id] });

    // javascript: bağlantısı reddedilir.
    const bad = await post(w.ikManager.id, '/api/kb', article(w.ik.id, { url: 'javascript:alert(1)' }));
    expect(bad.statusCode).toBe(400);
  });

  it('madde benzer kayıt aramasına, Sık Sorulanlara ve Aramaya girer', async () => {
    const w = await world();
    await post(w.ikManager.id, '/api/kb', article(w.ik.id));

    const sim = (await post(w.opener.id, '/api/similar', { title: 'bordro pusulası nerede', description: '' })).json();
    expect(sim.matches[0]).toMatchObject({ source: 'kb', verified: true, url: 'https://ikportal.ornek.com/bordro' });

    const res = (await get(w.opener.id, `/api/search/resources?q=${encodeURIComponent('bordro')}`)).json();
    expect(res.items[0]).toMatchObject({ source: 'kb', kind: 'UYGULAMA', url: 'https://ikportal.ornek.com/bordro' });
    expect(res.sources.cortex).toBe('kapali');
    const sample = (await get(w.opener.id, '/api/search/resources')).json();
    expect(sample.sample).toBe(true);
    expect(sample.items.length).toBe(1);
  });
});

describe('Sık Sorulanlar', () => {
  it('aynı soru kümelenir, sayı ve çözüm döner; tek sefer sorulan listeye girmez', async () => {
    const w = await world();
    for (const t of ['VPN bağlantısı sürekli kopuyor', 'VPN bağlantısı kopuyor', 'Yazıcı çalışmıyor']) {
      await createRecord({
        createdById: w.opener.id, departmentId: w.bt.id, assigneeId: w.btMember.id,
        status: RecordStatus.KAPATILDI, title: t, resolution: 'VPN istemcisi güncellendi, sorun giderildi.',
      });
    }
    const faq = (await get(w.opener.id, '/api/faq')).json();
    expect(faq.items).toHaveLength(1);
    expect(faq.items[0]).toMatchObject({ count: 2, department: { name: 'Bilgi Teknolojileri' }, source: 'kayit' });
  });
});

describe('kişi araması', () => {
  it('unvan ve benzer kaydı çözen kişiyle eşleşir; boş sorguda örnek kişiler', async () => {
    const w = await world();
    await prisma.user.update({ where: { id: w.ikMember.id }, data: { title: 'Bordro Uzmanı' } });
    await createRecord({
      createdById: w.opener.id, departmentId: w.ik.id, assigneeId: w.ikManager.id,
      status: RecordStatus.KAPATILDI, title: 'Bordro kesintisi itirazı', resolution: 'Kesinti düzeltildi.',
    });

    const res = (await get(w.opener.id, `/api/search/people?q=${encodeURIComponent('bordro')}`)).json();
    const names = res.items.map((p: { name: string }) => p.name);
    expect(names).toContain('İK Üye');
    expect(names).toContain('İK Müdür');
    const uzman = res.items.find((p: { name: string }) => p.name === 'İK Üye');
    expect(uzman).toMatchObject({ title: 'Bordro Uzmanı', department: { name: 'İnsan Kaynakları' } });
    expect(uzman.reason).toContain('Unvan');
    expect(res.items.find((p: { name: string }) => p.name === 'İK Müdür').reason).toContain('Benzer 1 kaydı çözdü');

    const sample = (await get(w.opener.id, '/api/search/people')).json();
    expect(sample.sample).toBe(true);
    expect(sample.items.length).toBeGreaterThan(0);
  });
});
