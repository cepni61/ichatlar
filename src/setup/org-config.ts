import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { Priority } from '../domain/enums.js';

/**
 * Kuruluş yapılandırması: departmanlar (ekipler) ve SLA süreleri.
 *
 * Her kuruluş kendi kurulumunda bir JSON dosyası tutar (örnek:
 * config/kurulus.example.json) ve `setup` komutuyla veritabanına işler.
 * Kuruluşa özgü hiçbir değer kodda durmaz.
 */
export const orgConfigSchema = z
  .object({
    departments: z
      .array(
        z.object({
          /** Kalıcı kimlik — kayıtlar buna bağlanır, sonradan değiştirilmemeli. */
          id: z.string().regex(/^[a-z0-9-]{2,32}$/, 'küçük harf, rakam ve tire; 2-32 karakter'),
          name: z.string().trim().min(2).max(80),
          short: z.string().trim().min(1).max(24),
          /** ENTRA_USE_GROUPS=true ise bu gruptaki kişiler bu departmana atanır. */
          entraGroupId: z.string().trim().max(64).optional(),
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
    const seen = new Set<string>();
    c.departments.forEach((d, i) => {
      if (seen.has(d.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['departments', i, 'id'], message: `"${d.id}" iki kez yazılmış` });
      }
      seen.add(d.id);
    });
    if (!(c.sla.KRITIK <= c.sla.YUKSEK && c.sla.YUKSEK <= c.sla.NORMAL)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sla'], message: 'süreler KRITIK ≤ YUKSEK ≤ NORMAL olmalı' });
    }
  });

export type OrgConfig = z.infer<typeof orgConfigSchema>;

export interface ApplyResult {
  created: string[];
  updated: string[];
  /** Veritabanında olup dosyada olmayan etkin departmanlar — silinmez, raporlanır. */
  notInConfig: string[];
}

/**
 * Yapılandırmayı veritabanına işler. Tekrar çalıştırmak güvenlidir.
 * Dosyada olmayan departmanlara dokunmaz: üzerlerinde kayıt olabilir.
 * Yapılan değişiklik denetim izine yazılır.
 */
export async function applyOrgConfig(prisma: PrismaClient, config: OrgConfig): Promise<ApplyResult> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.department.findMany({
      select: { id: true, name: true, short: true, entraGroupId: true, order: true, active: true },
    });
    const byId = new Map(before.map((d) => [d.id, d]));
    const result: ApplyResult = { created: [], updated: [], notInConfig: [] };

    for (const [i, d] of config.departments.entries()) {
      const data = { name: d.name, short: d.short, entraGroupId: d.entraGroupId || null, order: i + 1, active: true };
      const old = byId.get(d.id);
      if (!old) {
        await tx.department.create({ data: { id: d.id, ...data } });
        result.created.push(d.id);
      } else if (
        old.name !== data.name || old.short !== data.short || old.entraGroupId !== data.entraGroupId ||
        old.order !== data.order || !old.active
      ) {
        await tx.department.update({ where: { id: d.id }, data });
        result.updated.push(d.id);
      }
    }

    const wanted = new Set(config.departments.map((d) => d.id));
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
