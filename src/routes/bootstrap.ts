import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { actorOf, requireUser } from '../auth/guard.js';
import { isTeamRole } from '../domain/permissions.js';
import { env } from '../env.js';
import { ALLOWED, MAX_FILES } from '../domain/attachments.js';
import { BENEFITS } from '../domain/suggestion.js';
import {
  PRIORITY_LABELS,
  PRIORITY_TO_SLUG,
  STATUS_LABELS,
  STATUS_TONES,
  STATUS_TO_SLUG,
  TYPE_LABELS,
  TYPE_TO_SLUG,
} from '../domain/constants.js';
import { slaRules } from '../domain/sla.js';
import { kbAccess, KB_KINDS } from '../domain/kb.js';

/**
 * Arayüzün açılışta ihtiyaç duyduğu her şey tek istekte.
 *
 * Prototipte DEPARTMENTS / USERS / STATUSES / PRIORITIES dosyaya gömülü
 * sabitlerdi. Artık sunucudan gelirler; arayüz kodu bunları aynı isimli
 * dizilere doldurur, geri kalan tüm render mantığı değişmeden çalışır.
 */
/**
 * Departman, hemen ardından onun ekipleri. `order` departmanlar arasında ve
 * her departmanın ekipleri arasında ayrı ayrı 1'den başlar; düz sıralama
 * ekipleri departmanlarından koparıp karışık dizerdi.
 */
function treeOrder<T extends { id: string; parentId: string | null }>(units: T[]): T[] {
  const roots = units.filter((u) => !u.parentId);
  const known = new Set(roots.map((r) => r.id));
  const out = roots.flatMap((r) => [r, ...units.filter((u) => u.parentId === r.id)]);
  // Üstü etkin olmayan ekip (olmamalı) yine de listede kalsın.
  return [...out, ...units.filter((u) => u.parentId && !known.has(u.parentId))];
}

export default async function bootstrapRoutes(app: FastifyInstance) {
  app.get('/api/bootstrap', { preHandler: requireUser }, async (req) => {
    const me = req.user!;

    const [departments, users, rules, kb] = await Promise.all([
      prisma.department.findMany({
        where: { active: true },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, short: true, parentId: true },
      }),
      // Kullanıcı listesi kayıt sahibi/atama adlarını göstermek için gerekli.
      // E-posta paylaşılmaz — arayüzde kullanılmıyor.
      prisma.user.findMany({
        where: { active: true },
        orderBy: [{ name: 'asc' }],
        select: { id: true, name: true, role: true, departmentId: true },
      }),
      slaRules(),
      kbAccess(actorOf(req)),  // departman sorumluluğu da (headOf)
    ]);

    return {
      /** Arayüz kullanıcı seçiciyi yalnızca geliştirme girişinde gösterir. */
      devAuth: env.devAuth,
      /** Kuruluş başına kurulum: ad .env'den (ORG_NAME). Boşsa arayüz ürün adıyla kalır. */
      org: { name: env.ORG_NAME || null },
      /** Ek dosya sınırları — arayüz seçimde uyarır; asıl denetim sunucuda. */
      uploads: { maxMb: env.MAX_UPLOAD_MB, maxFiles: MAX_FILES, extensions: Object.keys(ALLOWED) },
      /** Bilgi Bankası yönetimi: görebilir mi, hangi ekipleri düzenler, yetki verebilir mi. */
      kb: { view: kb.view, admin: kb.admin, edit: kb.edit, kinds: Object.entries(KB_KINDS).map(([id, label]) => ({ id, label })) },
      /** Öneri formundaki "beklenen fayda" seçenekleri. */
      benefits: Object.entries(BENEFITS).map(([id, label]) => ({ id, label })),
      me: {
        id: me.id,
        name: me.name,
        email: me.email,
        role: me.role,
        dept: me.departmentId,
        departmentName: me.departmentName,
      },
      /**
       * Departmanlar ve ekipleri tek listede: parent boşsa departman, doluysa o
       * departmanın ekibi. Kayıt ve kişi ekibe bağlıdır (bkz. src/domain/org.ts).
       */
      departments: treeOrder(departments).map((d) => ({ id: d.id, name: d.name, short: d.short, parent: d.parentId })),
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        dept: u.departmentId,
        role: u.role === 'MANAGER' ? 'Yönetici' : u.role === 'ADMIN' ? 'Sistem Yöneticisi' : 'Ekip Üyesi',
        /** Ekip kaydı üzerine alınabilir mi (USER da "Ekip Üyesi" yazıyor). */
        teamRole: isTeamRole(u.role),
      })),
      types: Object.entries(TYPE_LABELS).map(([k, label]) => ({
        id: TYPE_TO_SLUG[k as keyof typeof TYPE_TO_SLUG],
        label,
      })),
      priorities: Object.entries(PRIORITY_LABELS).map(([k, label]) => {
        const key = k as keyof typeof PRIORITY_TO_SLUG;
        return {
          id: PRIORITY_TO_SLUG[key],
          label,
          sla: rules.get(key)!.hours,
          /** "Süre yaklaşıyor" eşiği (hedefin oranı); arayüz rengi buradan hesaplar. */
          warn: rules.get(key)!.warnRatio,
        };
      }),
      statuses: Object.entries(STATUS_LABELS).map(([k, label]) => {
        const key = k as keyof typeof STATUS_TO_SLUG;
        return { id: STATUS_TO_SLUG[key], label, cls: STATUS_TONES[key] };
      }),
    };
  });

  app.get('/api/me', { preHandler: requireUser }, async (req) => ({ me: req.user }));

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });
}
