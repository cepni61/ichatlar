import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { Priority } from '../domain/enums.js';

/**
 * Kuruluş yapılandırması: departmanlar, altlarındaki ekipler ve SLA süreleri.
 *
 * Her kuruluş kendi kurulumunda bir JSON dosyası tutar (örnek:
 * config/kurulus.example.json) ve `setup` komutuyla veritabanına işler.
 * Kuruluşa özgü hiçbir değer kodda durmaz.
 *
 * İki seviye (bkz. src/domain/org.ts): departman (ünite) → ekip (işletme
 * bölümü). Kayıtlar ve kişiler ekibe bağlanır; ekibi yazılmayan departman
 * kendisi ekip gibi kullanılır.
 */
const unitSchema = z.object({
  /** Kalıcı kimlik — kayıtlar buna bağlanır, sonradan değiştirilmemeli. */
  id: z.string().regex(/^[a-z0-9-]{2,32}$/, 'küçük harf, rakam ve tire; 2-32 karakter'),
  name: z.string().trim().min(2).max(80),
  short: z.string().trim().min(1).max(24),
  /**
   * Bu gruptaki kişiler bu ekibe atanır. AD (LDAP) girişinde grubun adı ya da
   * tam DN'i; Entra'da (ENTRA_USE_GROUPS=true) grubun nesne kimliği.
   */
  group: z.string().trim().max(256).optional(),
});

export const orgConfigSchema = z
  .object({
    departments: z
      .array(
        unitSchema.extend({
          teams: z
            .array(
              unitSchema.extend({
                /**
                 * Departmanın asıl ekibi. Departmana doğrudan bağlı kayıt ve
                 * kişiler (ekipler eklenmeden önceki veri) buraya taşınır.
                 * İşaretli ekip yoksa ilk ekip.
                 */
                main: z.boolean().optional(),
              }),
            )
            .default([]),
        }),
      )
      .min(1, 'en az bir departman gerekli'),
    sla: z.object({
      NORMAL: z.number().int().min(1).max(720),
      YUKSEK: z.number().int().min(1).max(720),
      KRITIK: z.number().int().min(1).max(720),
      /** Sürenin bu oranı geçilince kayıt sarıya döner. */
      warnRatio: z.number().min(0.1).max(0.95).default(0.7),
    }),
  })
  .superRefine((c, ctx) => {
    // Kimlikler departman ve ekipler arasında tekil: hepsi aynı tabloda.
    const seen = new Set<string>();
    const check = (id: string, path: (string | number)[]) => {
      if (seen.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `"${id}" iki kez yazılmış` });
      seen.add(id);
    };
    c.departments.forEach((d, i) => {
      check(d.id, ['departments', i, 'id']);
      d.teams.forEach((t, j) => check(t.id, ['departments', i, 'teams', j, 'id']));
      if (d.teams.filter((t) => t.main).length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['departments', i, 'teams'],
          message: 'en fazla bir asıl ekip (main) olabilir',
        });
      }
    });
    if (!(c.sla.KRITIK <= c.sla.YUKSEK && c.sla.YUKSEK <= c.sla.NORMAL)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sla'], message: 'süreler KRITIK ≤ YUKSEK ≤ NORMAL olmalı' });
    }
  });

export type OrgConfig = z.infer<typeof orgConfigSchema>;
/** Dosyada yazıldığı hâli (teams yazılmayabilir). */
export type OrgConfigInput = z.input<typeof orgConfigSchema>;

/** Departmanın asıl ekibi; ekibi yoksa departmanın kendisi (kayıt oraya düşer). */
export function mainTeamId(dept: OrgConfig['departments'][number]): string {
  return (dept.teams.find((t) => t.main) ?? dept.teams[0])?.id ?? dept.id;
}

export interface ApplyResult {
  created: string[];
  updated: string[];
  /** Veritabanında olup dosyada olmayan etkin birimler — silinmez, raporlanır. */
  notInConfig: string[];
  /** Ekip eklenen departmanlardan asıl ekibe taşınan satırlar. */
  moved: { records: number; users: number; kb: number };
}

/**
 * Yapılandırmayı veritabanına işler. Tekrar çalıştırmak güvenlidir.
 * Dosyada olmayan departmanlara dokunmaz: üzerlerinde kayıt olabilir.
 * Yapılan değişiklik denetim izine yazılır.
 */
export async function applyOrgConfig(prisma: PrismaClient, input: OrgConfigInput): Promise<ApplyResult> {
  const config = orgConfigSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.department.findMany({
      select: { id: true, name: true, short: true, entraGroupId: true, order: true, active: true, parentId: true },
    });
    const byId = new Map(before.map((d) => [d.id, d]));
    const result: ApplyResult = { created: [], updated: [], notInConfig: [], moved: { records: 0, users: 0, kb: 0 } };

    const upsert = async (u: z.infer<typeof unitSchema>, parentId: string | null, order: number) => {
      const data = { name: u.name, short: u.short, entraGroupId: u.group || null, order, active: true, parentId };
      const old = byId.get(u.id);
      if (!old) {
        await tx.department.create({ data: { id: u.id, ...data } });
        result.created.push(u.id);
      } else if (
        old.name !== data.name || old.short !== data.short || old.entraGroupId !== data.entraGroupId ||
        old.order !== data.order || !old.active || old.parentId !== data.parentId
      ) {
        await tx.department.update({ where: { id: u.id }, data });
        result.updated.push(u.id);
      }
    };

    // Önce bütün departmanlar (ekiplerin üst kaydı var olmalı), sonra ekipler.
    for (const [i, d] of config.departments.entries()) await upsert(d, null, i + 1);
    for (const d of config.departments) {
      for (const [j, t] of d.teams.entries()) await upsert(t, d.id, j + 1);
    }

    // Ekibi olan departmana doğrudan bağlı veri asıl ekibe taşınır: kayıt ve
    // kişi ekibe bağlanır, departman yalnızca çatıdır. Tekrar çalıştırmak
    // güvenli — taşınacak satır kalmayınca sayılar sıfırdır.
    for (const d of config.departments) {
      if (!d.teams.length) continue;
      const main = mainTeamId(d);
      result.moved.records += (await tx.record.updateMany({ where: { departmentId: d.id }, data: { departmentId: main } })).count;
      // İkincil ekip asıl ekiple aynı olamaz: çakışırsa ikincil düşer.
      await tx.record.updateMany({ where: { department2Id: d.id, departmentId: main }, data: { department2Id: null } });
      result.moved.records += (await tx.record.updateMany({ where: { department2Id: d.id }, data: { department2Id: main } })).count;
      result.moved.users += (await tx.user.updateMany({ where: { departmentId: d.id }, data: { departmentId: main } })).count;
      result.moved.kb += (await tx.kbArticle.updateMany({ where: { departmentId: d.id }, data: { departmentId: main } })).count;
      // Düzenleme yetkisi (kişi + birim tekil): asıl ekipte zaten varsa eskisi silinir.
      // Bilgi Bankası düzenleme yetkileri de asıl ekibe (aynısı varsa silinir).
      const grants = await tx.grant.findMany({ where: { departmentId: d.id, kind: 'KB_EDITOR' }, select: { id: true, userId: true } });
      for (const g of grants) {
        const dup = await tx.grant.findFirst({ where: { userId: g.userId, departmentId: main, kind: 'KB_EDITOR' } });
        if (dup) await tx.grant.delete({ where: { id: g.id } });
        else await tx.grant.update({ where: { id: g.id }, data: { departmentId: main } });
      }
    }

    const wanted = new Set(config.departments.flatMap((d) => [d.id, ...d.teams.map((t) => t.id)]));
    result.notInConfig = before.filter((d) => d.active && !wanted.has(d.id)).map((d) => d.id);

    for (const p of Object.values(Priority)) {
      await tx.slaRule.upsert({
        where: { priority: p },
        create: { priority: p, hours: config.sla[p], warnRatio: config.sla.warnRatio },
        update: { hours: config.sla[p], warnRatio: config.sla.warnRatio },
      });
    }

    await tx.auditLog.create({
      data: {
        action: 'ORG_SETUP',
        entity: 'Organization',
        entityId: 'config',
        before: JSON.stringify({ departments: before }),
        after: JSON.stringify(config),
      },
    });

    return result;
  });
}
