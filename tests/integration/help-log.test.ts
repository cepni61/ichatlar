import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });

type Headers = { cookie: string };

async function setup() {
  const bt = await createDept('Bilgi Teknolojileri');
  const u = await createUser({ name: 'Çalışan' });
  const other = await createUser({ name: 'Başkası' });
  await createRecord({
    createdById: other.id, departmentId: bt.id, status: RecordStatus.KAPATILDI,
    title: 'VPN bağlantısı sürekli kopuyor', resolution: 'VPN istemcisini güncelleyip bilgisayarı yeniden başlatın.',
  });
  return { bt, u, other, headers: await loginAs(app, u.id), otherHeaders: await loginAs(app, other.id) };
}
const scan = (headers: Headers, extra: object = {}) =>
  app.inject({
    method: 'POST', url: '/api/similar', headers,
    payload: { title: 'VPN bağlantısı kopuyor', description: 'Evden çalışırken VPN bağlantısı sık sık kopuyor.', type: 'bilgi', ...extra },
  });

describe('yardım günlüğü: ML taraması', () => {
  it('tarama oturum, sorgu ve gösterilen sonuçları yazar', async () => {
    const { bt, u, headers } = await setup();
    const res = await scan(headers, { department: bt.id });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.helpSessionId).toBeTruthy();
    expect(out.matches.length).toBeGreaterThan(0);
    expect(out.matches[0].resultId).toBeTruthy();

    const s = await prisma.helpSession.findUniqueOrThrow({
      where: { id: out.helpSessionId },
      include: { queries: { include: { results: { orderBy: { rank: 'asc' } } } } },
    });
    expect(s).toMatchObject({ userId: u.id, channel: 'YENI_KAYIT', recordId: null });
    expect(s.queries).toHaveLength(1);
    expect(s.queries[0]).toMatchObject({
      kind: 'ML_TARAMA', title: 'VPN bağlantısı kopuyor', recordType: 'BILGI',
      selectedTeamId: bt.id, resultCount: out.matches.length,
    });
    expect(s.queries[0]!.results[0]).toMatchObject({ id: out.matches[0].resultId, rank: 1, source: 'KAYIT' });
    expect(s.queries[0]!.results[0]!.recordId).toBeTruthy();
  });

  it('yazarken art arda gelen taramalar tek sorguda birleşir; sonuca dokunulunca yenisi açılır', async () => {
    const { headers } = await setup();
    const first = (await scan(headers)).json();
    const second = (await scan(headers, { helpSessionId: first.helpSessionId, title: 'VPN bağlantısı kopuyor evde' })).json();
    expect(second.helpSessionId).toBe(first.helpSessionId);
    const qs = await prisma.helpQuery.findMany({ where: { sessionId: first.helpSessionId } });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.title).toBe('VPN bağlantısı kopuyor evde');

    await prisma.helpResult.update({ where: { id: second.matches[0].resultId }, data: { openedAt: new Date() } });
    await scan(headers, { helpSessionId: first.helpSessionId });
    expect(await prisma.helpQuery.count({ where: { sessionId: first.helpSessionId } })).toBe(2);
  });

  it('başkasının ya da süresi geçmiş oturum kimliği yeni oturum açar', async () => {
    const { headers, otherHeaders } = await setup();
    const mine = (await scan(headers)).json();
    const theirs = (await scan(otherHeaders, { helpSessionId: mine.helpSessionId })).json();
    expect(theirs.helpSessionId).not.toBe(mine.helpSessionId);

    await prisma.helpSession.update({
      where: { id: mine.helpSessionId }, data: { lastActivityAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    const later = (await scan(headers, { helpSessionId: mine.helpSessionId })).json();
    expect(later.helpSessionId).not.toBe(mine.helpSessionId);
  });

  it('bozuk oturum ve var olmayan ekip kimliği yardımı engellemez', async () => {
    const { headers } = await setup();
    const res = await scan(headers, { department: 'yok-boyle-ekip', helpSessionId: 'x'.repeat(40) });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.matches.length).toBeGreaterThan(0);
    const q = await prisma.helpQuery.findFirstOrThrow({ where: { sessionId: out.helpSessionId } });
    expect(q.selectedTeamId).toBeNull();
  });

  it('kısıtlı taslağın metni günlüğe yazılmaz', async () => {
    const { headers } = await setup();
    const out = (await scan(headers, { restricted: true })).json();
    const q = await prisma.helpQuery.findFirstOrThrow({ where: { sessionId: out.helpSessionId } });
    expect(q.title).toBeNull();
    expect(q.text).toBeNull();
    expect(q.resultCount).toBe(out.matches.length);
  });

  it('asistan sorusu tek sonuçla ASISTAN olarak yazılır ve birleşmez', async () => {
    const { headers } = await setup();
    const ask = (extra: object = {}) => scan(headers, { channel: 'ASISTAN', limit: 1, description: '', type: undefined, ...extra });
    const a = (await ask()).json();
    expect(a.matches.length).toBeLessThanOrEqual(1);
    await ask({ helpSessionId: a.helpSessionId });
    const qs = await prisma.helpQuery.findMany({ where: { sessionId: a.helpSessionId } });
    expect(qs).toHaveLength(2);
    expect(qs.every((q) => q.kind === 'ASISTAN' && q.title === null && q.text === 'VPN bağlantısı kopuyor')).toBe(true);
    expect((await prisma.helpSession.findUniqueOrThrow({ where: { id: a.helpSessionId } })).channel).toBe('ASISTAN');
  });
});

describe('yardım günlüğü: Kaynak Bul', () => {
  async function searchSetup() {
    const base = await setup();
    await prisma.kbArticle.create({
      data: {
        departmentId: base.bt.id, kind: 'BILGI', title: 'VPN kurulumu', keywords: 'vpn uzaktan erişim',
        answer: 'VPN istemcisini Yazılım Merkezi üzerinden kurun.',
      },
    });
    const search = (q: string, sid?: string) =>
      app.inject({
        method: 'GET', headers: base.headers,
        url: '/api/search/resources?' + new URLSearchParams({ q, ...(sid ? { helpSessionId: sid } : {}) }),
      });
    return { ...base, search };
  }

  it('arama sorgusu ve sonuçları kaynaklarıyla yazılır', async () => {
    const { search } = await searchSetup();
    const out = (await search('vpn')).json();
    expect(out.helpSessionId).toBeTruthy();
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items.every((x: { resultId: string | null }) => x.resultId)).toBe(true);
    const q = await prisma.helpQuery.findFirstOrThrow({
      where: { sessionId: out.helpSessionId }, include: { results: { orderBy: { rank: 'asc' } } },
    });
    expect(q).toMatchObject({ kind: 'ARAMA', text: 'vpn', title: null, resultCount: out.items.length });
    const kb = q.results.find((r) => r.source === 'BILGI_BANKASI');
    expect(kb?.kbArticleId).toBeTruthy();
    expect((await prisma.helpSession.findUniqueOrThrow({ where: { id: out.helpSessionId } })).channel).toBe('KAYNAK_BUL');
  });

  it('yazarken uzayan arama tek sorgu, yeni konu yeni sorgu', async () => {
    const { search } = await searchSetup();
    const a = (await search('vpn')).json();
    await search('vpn kur', a.helpSessionId);
    const qs = await prisma.helpQuery.findMany({ where: { sessionId: a.helpSessionId } });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.text).toBe('vpn kur');
    await search('izin', a.helpSessionId);
    expect(await prisma.helpQuery.count({ where: { sessionId: a.helpSessionId } })).toBe(2);
  });

  it('boş arama günlüğe yazılmaz', async () => {
    const { search } = await searchSetup();
    const out = (await search('')).json();
    expect(out.sample).toBe(true);
    expect(out.helpSessionId ?? null).toBeNull();
    expect(await prisma.helpQuery.count()).toBe(0);
  });
});

describe('yardım günlüğü: sonuç etkileşimi', () => {
  it('bağlantı tıklaması bir kez; işime yaradı ve geri alma yazılır', async () => {
    const { headers } = await setup();
    const out = (await scan(headers)).json();
    const rid = out.matches[0].resultId as string;
    const hit = (action: string) =>
      app.inject({ method: 'POST', url: `/api/help/results/${rid}`, headers, payload: { action } });
    const row = () => prisma.helpResult.findUniqueOrThrow({ where: { id: rid } });

    expect((await hit('open')).statusCode).toBe(204);
    const opened = (await row()).openedAt;
    expect(opened).toBeTruthy();
    await hit('open');
    expect((await row()).openedAt).toEqual(opened);

    expect((await hit('helpful')).statusCode).toBe(204);
    expect((await row()).helpfulAt).toBeTruthy();
    expect((await hit('unhelpful')).statusCode).toBe(204);
    expect((await row()).helpfulAt).toBeNull();
  });

  it('başkasının sonucu 404, geçersiz eylem 400', async () => {
    const { headers, otherHeaders } = await setup();
    const rid = (await scan(headers)).json().matches[0].resultId as string;
    const res = await app.inject({ method: 'POST', url: `/api/help/results/${rid}`, headers: otherHeaders, payload: { action: 'helpful' } });
    expect(res.statusCode).toBe(404);
    const bad = await app.inject({ method: 'POST', url: `/api/help/results/${rid}`, headers, payload: { action: 'sil' } });
    expect(bad.statusCode).toBe(400);
  });
});

describe('kayıt açılışında yardım oturumu', () => {
  const create = (headers: Headers, extra: object = {}) =>
    app.inject({
      method: 'POST', url: '/api/records', headers,
      payload: { type: 'bilgi', title: 'VPN bağlantısı kopuyor', description: 'Evden çalışırken VPN bağlantısı sık sık kopuyor.', ...extra },
    });
  const recordOf = async (res: { json(): { record: { code: string } } }) =>
    prisma.record.findUniqueOrThrow({ where: { code: res.json().record.code } });

  it('taramanın oturumu kayda bağlanır', async () => {
    const { bt, headers } = await setup();
    const s = (await scan(headers)).json();
    const res = await create(headers, { department: bt.id, helpSessionId: s.helpSessionId });
    expect(res.statusCode).toBe(201);
    const rec = await recordOf(res);
    expect((await prisma.helpSession.findUniqueOrThrow({ where: { id: s.helpSessionId } })).recordId).toBe(rec.id);
  });

  it('taramasız kayıt sorgusuz bir oturuma bağlanır', async () => {
    const { bt, u, headers } = await setup();
    const rec = await recordOf(await create(headers, { department: bt.id }));
    const s = await prisma.helpSession.findUniqueOrThrow({ where: { recordId: rec.id }, include: { queries: true } });
    expect(s).toMatchObject({ userId: u.id, channel: 'YENI_KAYIT' });
    expect(s.queries).toHaveLength(0);
  });

  it('anonim kayıtta oturumun kişisi, kısıtlıda sorgu metinleri silinir', async () => {
    const { bt, headers } = await setup();
    const a = (await scan(headers)).json();
    await create(headers, { department: bt.id, helpSessionId: a.helpSessionId, anonymous: true });
    expect((await prisma.helpSession.findUniqueOrThrow({ where: { id: a.helpSessionId } })).userId).toBeNull();

    const b = (await scan(headers)).json();
    await create(headers, { department: bt.id, helpSessionId: b.helpSessionId, restricted: true });
    const q = await prisma.helpQuery.findFirstOrThrow({ where: { sessionId: b.helpSessionId } });
    expect(q.title).toBeNull();
    expect(q.text).toBeNull();
  });

  it('aynı oturumla eşzamanlı iki kayıt da açılır; oturum yalnızca birine bağlanır', async () => {
    const { bt, headers } = await setup();
    const s = (await scan(headers)).json();
    const [r1, r2] = await Promise.all([
      create(headers, { department: bt.id, helpSessionId: s.helpSessionId }),
      create(headers, { department: bt.id, helpSessionId: s.helpSessionId, title: 'VPN bağlantısı yine kopuyor' }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([201, 201]);
    const linked = await prisma.helpSession.findMany({ where: { recordId: { not: null } } });
    expect(linked).toHaveLength(2);
    expect(linked.filter((x) => x.id === s.helpSessionId)).toHaveLength(1);
  });

  it('açılış olayı hedef durum ve ekibi, ikinci ekip paylaşımı hedef ekibi taşır', async () => {
    const { bt, headers } = await setup();
    const fin = await createDept('Finans');
    const rec = await recordOf(await create(headers, { department: bt.id, department2: fin.id }));
    const ev = await prisma.recordEvent.findMany({ where: { recordId: rec.id } });
    expect(ev.find((e) => e.type === 'CREATE')).toMatchObject({ toStatus: 'YENI', toTeamId: bt.id });
    expect(ev.find((e) => e.type === 'ASSIGN')).toMatchObject({ toTeamId: fin.id });
  });
});

describe('taslağın birden çok oturumu (denetim bulgusu)', () => {
  const create = (headers: Headers, extra: object = {}) =>
    app.inject({
      method: 'POST', url: '/api/records', headers,
      payload: { type: 'bilgi', title: 'VPN bağlantısı kopuyor', description: 'Evden çalışırken VPN bağlantısı sık sık kopuyor.', ...extra },
    });
  const age = (id: string, minutes: number) =>
    prisma.helpSession.update({ where: { id }, data: { startedAt: new Date(Date.now() - minutes * 60_000), lastActivityAt: new Date(Date.now() - minutes * 60_000) } });

  /** Taslak yazılırken 30 dk'dan uzun ara verilince ikinci tarama yeni oturum açar. */
  async function twoSessionDraft(headers: Headers) {
    const s1 = (await scan(headers)).json().helpSessionId as string;
    await age(s1, 31);
    const s2 = (await scan(headers, { helpSessionId: s1, title: 'VPN bağlantısı kopuyor evde' })).json().helpSessionId as string;
    expect(s2).not.toBe(s1);
    return { s1, s2 };
  }

  it('taslağın oturumları kayıtta tek oturumda toplanır', async () => {
    const { bt, headers } = await setup();
    const { s1, s2 } = await twoSessionDraft(headers);
    const res = await create(headers, { department: bt.id, helpSessionId: s2, helpSessionIds: [s1, s2] });
    const rec = await prisma.record.findUniqueOrThrow({ where: { code: res.json().record.code } });
    expect(await prisma.helpSession.findUnique({ where: { id: s1 } })).toBeNull();
    const s = await prisma.helpSession.findUniqueOrThrow({ where: { id: s2 }, include: { queries: true } });
    expect(s.recordId).toBe(rec.id);
    expect(s.queries).toHaveLength(2);
    expect(Date.now() - s.startedAt.getTime()).toBeGreaterThan(30 * 60_000);
  });

  it('anonim kayıtta taslağın hiçbir oturumunda kişi kalmaz; kısıtlıda hiçbir taslak metni kalmaz', async () => {
    const { bt, u, headers } = await setup();
    const a = await twoSessionDraft(headers);
    await create(headers, { department: bt.id, helpSessionId: a.s2, helpSessionIds: [a.s1, a.s2], anonymous: true });
    expect(await prisma.helpSession.count({ where: { userId: u.id } })).toBe(0);

    const b = await twoSessionDraft(headers);
    await create(headers, { department: bt.id, helpSessionId: b.s2, helpSessionIds: [b.s1, b.s2], restricted: true });
    const texts = await prisma.helpQuery.findMany({ where: { session: { userId: u.id } }, select: { title: true, text: true } });
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((q) => q.title === null && q.text === null)).toBe(true);
  });

  it('başkasının oturumu taslağa katılmaz', async () => {
    const { bt, headers, otherHeaders, other } = await setup();
    const theirs = (await scan(otherHeaders)).json().helpSessionId as string;
    const mine = (await scan(headers)).json().helpSessionId as string;
    await create(headers, { department: bt.id, helpSessionId: mine, helpSessionIds: [theirs, mine], anonymous: true });
    expect(await prisma.helpSession.findUniqueOrThrow({ where: { id: theirs } })).toMatchObject({ userId: other.id, recordId: null });
  });

  it('taslağa ait olmayan eski oturum (asistan, Kaynak Bul) yalnızca 30 dk içindeyse kayda bağlanır', async () => {
    const { bt, headers } = await setup();
    const asked = (await scan(headers, { channel: 'ASISTAN', limit: 1, description: '' })).json().helpSessionId as string;
    await age(asked, 120);
    const res = await create(headers, { department: bt.id, helpSessionId: asked, type: 'bilgi' });
    const rec = await prisma.record.findUniqueOrThrow({ where: { code: res.json().record.code } });
    expect((await prisma.helpSession.findUniqueOrThrow({ where: { id: asked } })).recordId).toBeNull();
    expect(await prisma.helpSession.findUnique({ where: { recordId: rec.id } })).not.toBeNull();

    const draft = (await scan(headers)).json().helpSessionId as string;
    await age(draft, 120);
    const res2 = await create(headers, { department: bt.id, helpSessionId: draft, helpSessionIds: [draft], title: 'VPN yine kopuyor' });
    const rec2 = await prisma.record.findUniqueOrThrow({ where: { code: res2.json().record.code } });
    expect((await prisma.helpSession.findUniqueOrThrow({ where: { id: draft } })).recordId).toBe(rec2.id);
  });
});
