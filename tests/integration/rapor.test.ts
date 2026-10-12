import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus, Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, makeApp, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });

const day = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

describe('rapor görünümleri', () => {
  it('kısıtlı kaydın metinleri, anonim kaydın açanı gizlidir; etiketler Türkçe', async () => {
    const t = await createDept('İnsan Kaynakları');
    const c = await createUser({ name: 'Açan' });
    const m = await createUser({ name: 'Sahip', role: Role.TEAM_MEMBER, departmentId: t.id });
    const kisitli = await createRecord({ createdById: c.id, departmentId: t.id, restricted: true, status: RecordStatus.CALISILIYOR, title: 'Gizli konu' });
    const anonim = await createRecord({ createdById: c.id, departmentId: t.id, anonymous: true, title: 'Anonim konu' });
    await prisma.recordEvent.createMany({ data: [
      { recordId: kisitli.id, type: 'COMMENT', text: 'gizli metin', byId: m.id },
      { recordId: anonim.id, type: 'CREATE', text: 'açıldı', byId: c.id },
    ] });
    await prisma.infoRequest.create({ data: {
      recordId: kisitli.id, requestedById: m.id, question: 'gizli soru', statusBefore: 'CALISILIYOR',
      requestedAt: ago(3 * 60 * 60 * 1000), answeredAt: ago(60 * 60 * 1000), answeredById: c.id, answer: 'gizli yanıt',
    } });

    const [k] = await prisma.$queryRaw<{ baslik: string | null; durum: string; acan_id: string | null }[]>`
      SELECT baslik, durum, acan_id FROM rapor.kayit WHERE kayit_id = ${kisitli.id}`;
    expect(k).toEqual({ baslik: null, durum: 'Çalışılıyor', acan_id: c.id });
    const [a] = await prisma.$queryRaw<{ baslik: string; acan_id: string | null }[]>`
      SELECT baslik, acan_id FROM rapor.kayit WHERE kayit_id = ${anonim.id}`;
    expect(a).toEqual({ baslik: 'Anonim konu', acan_id: null });

    const adim = await prisma.$queryRaw<{ kayit_id: string; metin: string | null; yapan_id: string | null }[]>`
      SELECT kayit_id, metin, yapan_id FROM rapor.kayit_adimi ORDER BY kayit_id`;
    expect(adim.find((x) => x.kayit_id === kisitli.id)).toMatchObject({ metin: null, yapan_id: m.id });
    expect(adim.find((x) => x.kayit_id === anonim.id)).toMatchObject({ metin: 'açıldı', yapan_id: null });

    const [e] = await prisma.$queryRaw<{ soru: string | null; yanit: string | null; sonuc: string; sn: number }[]>`
      SELECT soru, yanit, sonuc, extract(epoch FROM bekleme_suresi)::int AS sn FROM rapor.ek_bilgi`;
    expect(e).toEqual({ soru: null, yanit: null, sonuc: 'yanıtlandı', sn: 7200 });
  });

  it('yardım oturumu: öneri, beyan ve sonraki kayıtlar; anonim sonraki kayıt sayılmaz', async () => {
    const t = await createDept('Bilgi Teknolojileri');
    const t2 = await createDept('Finans');
    const u = await createUser({ name: 'Çalışan' });
    const s = await prisma.helpSession.create({ data: { userId: u.id, channel: 'YENI_KAYIT', startedAt: ago(3 * day), lastActivityAt: ago(3 * day) } });
    const q = await prisma.helpQuery.create({ data: { sessionId: s.id, kind: 'ML_TARAMA', at: ago(3 * day), resultCount: 1, predictedTeamId: t.id, title: 'VPN' } });
    await prisma.helpResult.create({ data: { queryId: q.id, rank: 1, source: 'KAYIT', helpfulAt: ago(3 * day) } });

    const gizli = await createRecord({ createdById: u.id, departmentId: t.id, anonymous: true });
    await prisma.record.update({ where: { id: gizli.id }, data: { createdAt: ago(2 * day) } });
    const baska = await createRecord({ createdById: u.id, departmentId: t2.id });
    await prisma.record.update({ where: { id: baska.id }, data: { createdAt: ago(1.5 * day) } });
    const ayni = await createRecord({ createdById: u.id, departmentId: t.id });
    await prisma.record.update({ where: { id: ayni.id }, data: { createdAt: ago(1 * day) } });

    const [o] = await prisma.$queryRaw<{
      sorgu_sayisi: number; tarama_sayisi: number; oneri_gosterildi: boolean; isime_yaradi_beyani: boolean;
      kayit_acildi: boolean; onerilen_ekip_id: string; sonraki_kayit_zamani: Date; sonraki_ayni_ekip_kaydi_zamani: Date;
    }[]>`SELECT * FROM rapor.yardim_oturumu WHERE oturum_id = ${s.id}`;
    expect(o).toMatchObject({
      sorgu_sayisi: 1, tarama_sayisi: 1, oneri_gosterildi: true, isime_yaradi_beyani: true,
      kayit_acildi: false, onerilen_ekip_id: t.id,
    });
    expect(Math.abs(o!.sonraki_kayit_zamani.getTime() - ago(1.5 * day).getTime())).toBeLessThan(5000);
    expect(Math.abs(o!.sonraki_ayni_ekip_kaydi_zamani.getTime() - ago(1 * day).getTime())).toBeLessThan(5000);

    const sonuc = await prisma.$queryRaw<{ kaynak: string; isime_yaradi_zamani: Date | null }[]>`
      SELECT kaynak, isime_yaradi_zamani FROM rapor.yardim_sonucu`;
    expect(sonuc[0]!.kaynak).toBe('Çözülmüş kayıt');
    expect(sonuc[0]!.isime_yaradi_zamani).toBeInstanceOf(Date);
  });
});
