import { slaCompliancePct } from '../domain/sla-compliance.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Role } from '../domain/enums.js';
import { prisma } from '../db.js';
import { actorOf, requireReports, requireUser } from '../auth/guard.js';
import {
  HOUR_MS,
  isOpen,
  PRIORITY_LABELS,
  PRIORITY_TO_SLUG,
  STATUS_LABELS,
  STATUS_TO_SLUG,
  TYPE_LABELS,
  TYPE_TO_SLUG,
} from '../domain/constants.js';
import { surfaceForms, tokenize } from '../domain/similarity.js';
import { toJsonText } from '../lib/dialect.js';
import { badRequest } from '../lib/errors.js';
import { inDepartmentTree, inTeam, isAssignableUnit, loadOrgTree, rootOf, teamsOf } from '../domain/org.js';

/**
 * Raporlar ekip ve kurum düzeyinde toplu sayılar üretir; kayıt gövdesi
 * döndürmez. Bu yüzden yetki kaydı bazında değil rol bazında verilir:
 * yönetici, sistem yöneticisi, rapor görüntüleyici ve departman sorumlusu
 * görür (auth/guard.ts → requireReports).
 *
 * Ölçek notu: kayıtlar belleğe çekilip toplanıyor. On binlerce kayda kadar
 * sorun değil (satır başına ~10 alan). Ötesinde bu uç SQL toplama
 * (GROUP BY + AVG + FILTER) ile değiştirilmelidir; API sözleşmesi aynı kalır.
 */
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * İki filtre (kullanıcı isteği, 2026-10-09): ?department=<departman> ve
 * ?team=<o departmanın ekibi>. Kayıt, asıl ya da ikincil ekibi eşleşirse
 * sayılır — dağılım tablosundaki sayılarla aynı kural.
 */
const reportQuery = z.object({
  department: z.string().trim().min(1).max(64).optional(),
  team: z.string().trim().min(1).max(64).optional(),
});

type Unit = { id: string; name: string; short: string };
interface ReportFilter {
  department: Unit | null;
  team: Unit | null;
}

async function reportFilter(req: FastifyRequest): Promise<ReportFilter> {
  const q = reportQuery.safeParse(req.query);
  if (!q.success) throw badRequest('Geçersiz rapor filtresi.');
  const { department, team } = q.data;
  if (!department && !team) return { department: null, team: null };
  const ids = [department, team].filter((x): x is string => Boolean(x));
  const units = await prisma.department.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, short: true, parentId: true },
  });
  const byId = new Map(units.map((u) => [u.id, u]));
  const t = team ? byId.get(team) : undefined;
  if (team && !t) throw badRequest('Seçilen ekip bulunamadı.');
  // Ekip tek başına gelirse departmanı ondan türetilir; ikisi gelirse uyuşmalı.
  const deptId = department ?? (t ? t.parentId ?? t.id : null);
  const d = deptId ? byId.get(deptId) ?? (await prisma.department.findUnique({
    where: { id: deptId }, select: { id: true, name: true, short: true, parentId: true },
  })) : null;
  if (!d || d.parentId) throw badRequest('Seçilen departman bulunamadı.');
  if (t && (t.parentId ?? t.id) !== d.id) throw badRequest('Seçilen ekip bu departmanın altında değil.');
  const view = (u: { id: string; name: string; short: string }) => ({ id: u.id, name: u.name, short: u.short });
  return { department: view(d), team: t ? view(t) : null };
}

const recordWhere = (f: ReportFilter) =>
  f.team ? inTeam(f.team.id) : f.department ? inDepartmentTree(f.department.id) : undefined;

/**
 * Dağılım tablosunun birimleri: filtresizken departmanlar, departman
 * seçiliyken onun ekipleri, ekip seçiliyken yalnızca o ekip.
 */
async function gather(f: ReportFilter) {
  const tree = await loadOrgTree(prisma);
  const unitIds = f.team
    ? [f.team.id]
    : f.department
      ? teamsOf(tree, f.department.id)
      : [...tree.values()].filter((u) => u.active && u.parentId == null).map((u) => u.id);
  const level: 'department' | 'team' = f.department || f.team ? 'team' : 'department';
  const [rows, departments] = await Promise.all([
    prisma.record.findMany({
      where: recordWhere(f),
      select: {
        code: true,
        title: true,
        type: true,
        status: true,
        priority: true,
        anonymous: true,
        restricted: true,
        departmentId: true,
        department2Id: true,
        createdAt: true,
        updatedAt: true,
        firstResponseAt: true,
        resolvedAt: true,
        closedAt: true,
        slaDueAt: true,
      },
    }),
    prisma.department.findMany({
      where: { id: { in: unitIds } },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, short: true },
    }),
  ]);
  // Departman düzeyinde kayıt, ekiplerinden birinin departmanı eşleşirse sayılır.
  const unitOf = (id: string | null) => (level === 'department' ? rootOf(tree, id) : id);
  return { rows, departments, level, unitOf, tree };
}

type Row = Awaited<ReturnType<typeof gather>>['rows'][number];

const breached = (r: Row, now: number) => isOpen(r.status) && r.slaDueAt.getTime() <= now;

/* Öneri kabulü: yeni akışta "Fayda Sağladı"; eski kayıtlarda çözülen öneri.
   Oran, sonuçlanmış önerilere göre (açık öneri paydada yok). */
const oneriAccepted = (r: Row) =>
  r.type === 'ONERI' && (r.status === 'FAYDA_SAGLADI' || r.status === 'COZULDU' || r.status === 'KAPATILDI');
const oneriDecided = (r: Row) => r.type === 'ONERI' && !isOpen(r.status);
const slaPct = (rs: Row[], now: number) => slaCompliancePct(rs, (r) => isOpen(r.status), now);

/** Excel bu karakterle başlayan hücreyi formül sayar: kullanıcının yazdığı başlık çalışmasın. */
const FORMULA = /^[=+\-@\t\r]/;

export default async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get(
    '/api/reports/summary',
    { preHandler: requireReports },
    async (req) => {
      const now = Date.now();
      const filter = await reportFilter(req);
      const { rows, departments, level, unitOf, tree } = await gather(filter);

      const open = rows.filter((r) => isOpen(r.status));
      const late = open.filter((r) => breached(r, now));
      const oneri = rows.filter((r) => r.type === 'ONERI');
      const oneriOk = oneri.filter(oneriAccepted);
      const oneriDone = oneri.filter(oneriDecided);
      const anon = rows.filter((r) => r.anonymous);

      const respHours = rows
        .filter((r) => r.firstResponseAt)
        .map((r) => (r.firstResponseAt!.getTime() - r.createdAt.getTime()) / HOUR_MS);
      const solveHours = rows
        .filter((r) => r.resolvedAt)
        .map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / HOUR_MS);

      const perDept = departments.map((d) => {
        const all = rows.filter((r) => unitOf(r.departmentId) === d.id || unitOf(r.department2Id) === d.id);
        const dOpen = all.filter((r) => isOpen(r.status));
        return {
          id: d.id,
          name: d.name,
          total: all.length,
          open: dOpen.length,
          resp: avg(
            all
              .filter((r) => r.firstResponseAt)
              .map((r) => (r.firstResponseAt!.getTime() - r.createdAt.getTime()) / HOUR_MS),
          ),
          solve: avg(
            all
              .filter((r) => r.resolvedAt)
              .map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / HOUR_MS),
          ),
        };
      });

      // Konular katlanmış token'larla sayılır ("izin" = "İzin"), ama
      // kullanıcıya başlıklarda geçen Türkçe biçimiyle gösterilir.
      const wc = new Map<string, number>();
      const surface = new Map<string, string>();
      // "Yalnızca ilgili ekip görsün" kayıtların başlık kelimeleri konulara girmez.
      for (const r of rows.filter((x) => !x.restricted)) {
        for (const w of tokenize(r.title)) wc.set(w, (wc.get(w) ?? 0) + 1);
        for (const [f, raw] of surfaceForms(r.title)) if (!surface.has(f)) surface.set(f, raw);
      }
      const topics = [...wc.entries()]
        .map(([term, n]) => ({ term: surface.get(term) ?? term, n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 8);

      return {
        /** Uygulanan filtre; filtresizse null (kurum geneli). */
        filter: filter.department ? { department: filter.department, team: filter.team } : null,
        totals: {
          records: rows.length,
          open: open.length,
          late: late.length,
          anonymousPct: rows.length ? Math.round((anon.length / rows.length) * 100) : 0,
          slaPct: slaPct(rows, now),
          oneriAcceptPct: oneriDone.length ? Math.round((oneriOk.length / oneriDone.length) * 100) : null,
          avgFirstResponseHours: avg(respHours),
          avgSolveHours: avg(solveHours),
        },
        /** Dağılım birimi: filtresizken departman, departman/ekip seçiliyken ekip. */
        byDepartment: perDept,
        byDepartmentLevel: level,
        /** Her ekibin sayıları (Yönetim ekranındaki departman/ekip tablosu için). */
        byTeam: [...tree.keys()].filter((id) => isAssignableUnit(tree, id)).map((id) => {
          const all = rows.filter((r) => r.departmentId === id || r.department2Id === id);
          return { id, open: all.filter((r) => isOpen(r.status)).length, total: all.length };
        }),
        byType: Object.entries(TYPE_LABELS).map(([key, label]) => ({
          id: TYPE_TO_SLUG[key as keyof typeof TYPE_TO_SLUG],
          label,
          n: rows.filter((r) => r.type === key).length,
        })),
        byPriority: Object.entries(PRIORITY_LABELS).map(([key, label]) => ({
          id: PRIORITY_TO_SLUG[key],
          label,
          n: rows.filter((r) => r.priority === key).length,
        })),
        byStatus: Object.entries(STATUS_LABELS)
          .map(([key, label]) => ({
            id: STATUS_TO_SLUG[key as keyof typeof STATUS_TO_SLUG],
            label,
            n: rows.filter((r) => r.status === key).length,
          }))
          .filter((x) => x.n > 0),
        topics,
      };
    },
  );

  /** CSV — ichatlar4'teki sütunlarla aynı, Excel'in Türkçe ayracıyla. */
  app.get(
    '/api/reports/export.csv',
    { preHandler: requireReports },
    async (req, reply) => {
      const now = Date.now();
      const filter = await reportFilter(req);
      const tree = await loadOrgTree(prisma);
      const names = new Map((await prisma.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      const rows = await prisma.record.findMany({
        where: recordWhere(filter),
        orderBy: { createdAt: 'desc' },
        select: {
          code: true,
          type: true,
          title: true,
          priority: true,
          status: true,
          anonymous: true,
          restricted: true,
          departmentId: true,
          department2Id: true,
          createdAt: true,
          updatedAt: true,
          slaDueAt: true,
          department: { select: { name: true } },
          department2: { select: { name: true } },
          createdBy: { select: { name: true } },
          assignee: { select: { name: true } },
        },
      });

      const head = [
        'Kayıt No', 'Tür', 'Başlık', 'Departman', 'Ekip', 'İkincil Ekip', 'Öncelik',
        'Durum', 'Açan', 'Sahip', 'Oluşturma', 'Son Güncelleme', 'SLA',
      ];

      // Sunucu saat dilimi UTC olabilir; rapor Türkiye saatiyle yazılır.
      const fmt = (d: Date) =>
        d.toLocaleString('tr-TR', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
        });

      // Kısıtlı kaydın başlığı ve kişileri yalnızca ilgili ekibin yöneticisine
      // yazılır (sistem yöneticisi dahil diğerlerine değil): kimin kişisel bir
      // konusu olduğu da bilgidir. Sayılar tutarlı kalsın diye satır durur.
      const actor = actorOf(req);
      const shown = (r: (typeof rows)[number]) =>
        !r.restricted ||
        (actor.departmentId != null && (actor.departmentId === r.departmentId || actor.departmentId === r.department2Id));

      const body = rows.map((r) => [
        r.code,
        TYPE_LABELS[r.type],
        shown(r) ? r.title : 'Kısıtlı kayıt',
        names.get(rootOf(tree, r.departmentId) ?? '') ?? '',
        r.department.name,
        r.department2?.name ?? '',
        PRIORITY_LABELS[r.priority],
        STATUS_LABELS[r.status],
        // Anonim kaydın kimliği rapora da düşmez.
        !shown(r) ? '' : r.anonymous ? 'Anonim' : r.createdBy.name,
        shown(r) ? r.assignee?.name ?? '' : '',
        fmt(r.createdAt),
        fmt(r.updatedAt),
        isOpen(r.status) ? (r.slaDueAt.getTime() <= now ? 'Gecikmiş' : 'Sürede') : 'Kapandı',
      ]);

      const csv = [head, ...body]
        .map((line) => line.map((c) => `"${String(c).replace(FORMULA, "'$&").replace(/"/g, '""')}"`).join(';'))
        .join('\r\n');

      await prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: 'report.export',
          entity: 'Record',
          entityId: '*',
          after: toJsonText({ rows: rows.length, department: filter.department?.id ?? null, team: filter.team?.id ?? null }),
          ip: req.ip,
        },
      });

      // BOM: Excel'in UTF-8 olduğunu anlaması için.
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="ic-hatlar-kayitlar.csv"');
      return '﻿' + csv;
    },
  );
}
