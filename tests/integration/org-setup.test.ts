import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyOrgConfig, orgConfigSchema, type OrgConfig } from '../../src/setup/org-config.js';
import { createRecord, createUser, prisma, resetDb } from './helpers.js';

const base: OrgConfig = {
  departments: [
    { id: 'ik', name: 'İnsan Kaynakları', short: 'İK' },
    { id: 'bt', name: 'Bilgi Teknolojileri', short: 'BT', entraGroupId: 'g-bt' },
  ],
  sla: { NORMAL: 40, YUKSEK: 20, KRITIK: 4, warnRatio: 0.8 },
};

describe('kuruluş kurulumu (setup)', () => {
  beforeEach(resetDb);

  it('örnek yapılandırma dosyası geçerli', () => {
    const file = path.resolve(import.meta.dirname, '..', '..', 'config', 'kurulus.example.json');
    expect(orgConfigSchema.safeParse(JSON.parse(readFileSync(file, 'utf8'))).success).toBe(true);
  });

  it('departmanları ve SLA sürelerini yazar, denetim izine kaydeder', async () => {
    const r = await applyOrgConfig(prisma, base);

    expect(r.created).toEqual(['ik', 'bt']);
    expect(await prisma.department.findUnique({ where: { id: 'bt' } })).toMatchObject({
      name: 'Bilgi Teknolojileri', entraGroupId: 'g-bt', order: 2, active: true,
    });
    expect(await prisma.slaRule.findUnique({ where: { priority: 'KRITIK' } })).toMatchObject({ hours: 4, warnRatio: 0.8 });
    expect(await prisma.auditLog.count({ where: { action: 'ORG_SETUP' } })).toBe(1);
  });

  it('ikinci çalıştırma değişiklik yoksa hiçbir şeyi güncellemez', async () => {
    await applyOrgConfig(prisma, base);
    const again = await applyOrgConfig(prisma, base);
    expect(again).toEqual({ created: [], updated: [], notInConfig: [] });
  });

  it('dosyadan çıkarılan departmanı silmez, raporlar; üzerindeki kayıt korunur', async () => {
    await applyOrgConfig(prisma, base);
    const u = await createUser({ name: 'Açan' });
    const rec = await createRecord({ createdById: u.id, departmentId: 'bt' });

    const r = await applyOrgConfig(prisma, { ...base, departments: [base.departments[0]!] });

    expect(r.notInConfig).toEqual(['bt']);
    expect(await prisma.department.findUnique({ where: { id: 'bt' } })).toMatchObject({ active: true });
    expect(await prisma.record.findUnique({ where: { id: rec.id } })).not.toBeNull();
  });

  it('geçersiz yapılandırmayı reddeder', () => {
    const bad = (c: unknown) => orgConfigSchema.safeParse(c).success;
    expect(bad({ ...base, departments: [] })).toBe(false);
    expect(bad({ ...base, departments: [base.departments[0], base.departments[0]] })).toBe(false);
    expect(bad({ ...base, departments: [{ id: 'İK', name: 'İK', short: 'İK' }] })).toBe(false);
    expect(bad({ ...base, sla: { NORMAL: 8, YUKSEK: 24, KRITIK: 48 } })).toBe(false);
  });
});
