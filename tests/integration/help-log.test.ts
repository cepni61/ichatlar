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
