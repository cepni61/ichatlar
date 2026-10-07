import { slaCompliancePct } from '../domain/sla-compliance.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Role } from '../domain/enums.js';
import { prisma } from '../db.js';
import { requireRole, requireUser } from '../auth/guard.js';
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

/**
 * Raporlar ekip ve kurum düzeyinde toplu sayılar üretir; kayıt gövdesi
 * döndürmez. Bu yüzden yetki kaydı bazında değil rol bazında verilir:
 * yönetici ve sistem yöneticisi görür.
 *
 * Ölçek notu: kayıtlar belleğe çekilip toplanıyor. On binlerce kayda kadar
 * sorun değil (satır başına ~10 alan). Ötesinde bu uç SQL toplama
 * (GROUP BY + AVG + FILTER) ile değiştirilmelidir; API sözleşmesi aynı kalır.
 */
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Ekip filtresi (?department=<id>). Kayıt, asıl ya da ikincil ekibi o ekipse
 * sayılır — ekip tablosundaki sayılarla aynı kural.
 */
const reportQuery = z.object({ department: z.string().trim().min(1).max(64).optional() });

async function departmentFilter(req: FastifyRequest) {
  const q = reportQuery.safeParse(req.query);
  if (!q.success) throw badRequest('Geçersiz rapor filtresi.');
  if (!q.data.department) return null;
  const d = await prisma.department.findUnique({
    where: { id: q.data.department },
    select: { id: true, name: true },
  });
  if (!d) throw badRequest('Seçilen ekip bulunamadı.');
  return d;
}

const inDepartment = (deptId: string | null) =>
  deptId ? { OR: [{ departmentId: deptId }, { department2Id: deptId }] } : undefined;

async function gather(deptId: string | null) {
  const [rows, departments] = await Promise.all([
    prisma.record.findMany({
      where: inDepartment(deptId),
      select: {
        code: true,
        title: true,
        type: true,
        status: true,
        priority: true,
        anonymous: true,
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
      where: deptId ? { id: deptId } : { active: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, short: true },
    }),
  ]);
  return { rows, departments };
}

type Row = Awaited<ReturnType<typeof gather>>['rows'][number];

const breached = (r: Row, now: number) => isOpen(r.status) && r.slaDueAt.getTime() <= now;
const slaPct = (rs: Row[], now: number) => slaCompliancePct(rs, (r) => isOpen(r.status), now);

export default async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get(
    '/api/reports/summary',
    { preHandler: requireRole(Role.MANAGER, Role.ADMIN) },
    async (req) => {
      const now = Date.now();
      const dept = await departmentFilter(req);
      const { rows, departments } = await gather(dept?.id ?? null);

      const open = rows.filter((r) => isOpen(r.status));
      const late = open.filter((r) => breached(r, now));
      const closed = rows.filter((r) => r.status === 'COZULDU' || r.status === 'KAPATILDI');
      const oneri = rows.filter((r) => r.type === 'ONERI');
      const oneriOk = oneri.filter((r) => r.status === 'COZULDU');
      const anon = rows.filter((r) => r.anonymous);

      const respHours = rows
        .filter((r) => r.firstResponseAt)
        .map((r) => (r.firstResponseAt!.getTime() - r.createdAt.getTime()) / HOUR_MS);
      const solveHours = rows
        .filter((r) => r.resolvedAt)
        .map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / HOUR_MS);

      const perDept = departments.map((d) => {
        const all = rows.filter((r) => r.departmentId === d.id || r.department2Id === d.id);
        const dOpen = all.filter((r) => isOpen(r.status));
        return {
          id: d.id,
          name: d.name,
          short: d.short,
          total: all.length,
          open: dOpen.length,
          late: dOpen.filter((r) => breached(r, now)).length,
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
          slaPct: slaPct(all, now),
          oneriSolved: all.filter((r) => r.type === 'ONERI' && r.status === 'COZULDU').length,
        };
      });

      // Konular katlanmış token'larla sayılır ("izin" = "İzin"), ama
      // kullanıcıya başlıklarda geçen Türkçe biçimiyle gösterilir.
      const wc = new Map<string, number>();
      const surface = new Map<string, string>();
      for (const r of rows) {
        for (const w of tokenize(r.title)) wc.set(w, (wc.get(w) ?? 0) + 1);
        for (const [f, raw] of surfaceForms(r.title)) if (!surface.has(f)) surface.set(f, raw);
      }
      const topics = [...wc.entries()]
        .map(([term, n]) => ({ term: surface.get(term) ?? term, n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 8);

      return {
        /** Uygulanan filtre; filtresizse null (kurum geneli). */
        filter: dept ? { department: dept } : null,
        totals: {
          records: rows.length,
          open: open.length,
          late: late.length,
          warn: open.length - late.length, // ayrıntılı kırılım /api/records ile alınır
          closed: closed.length,
          owned: rows.filter((r) => isOpen(r.status)).length,
          anonymousPct: rows.length ? Math.round((anon.length / rows.length) * 100) : 0,
          slaPct: slaPct(rows, now),
          oneriAcceptPct: oneri.length ? Math.round((oneriOk.length / oneri.length) * 100) : null,
          oneriSolved: oneriOk.length,
          avgFirstResponseHours: avg(respHours),
          avgSolveHours: avg(solveHours),
        },
        byDepartment: perDept,
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
    { preHandler: requireRole(Role.MANAGER, Role.ADMIN) },
    async (req, reply) => {
      const now = Date.now();
      const dept = await departmentFilter(req);
      const rows = await prisma.record.findMany({
        where: inDepartment(dept?.id ?? null),
        orderBy: { createdAt: 'desc' },
        select: {
          code: true,
          type: true,
          title: true,
          priority: true,
          status: true,
          anonymous: true,
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
        'Kayıt No', 'Tür', 'Başlık', 'Departman', 'İkincil Ekip', 'Öncelik',
        'Durum', 'Açan', 'Sahip', 'Oluşturma', 'Son Güncelleme', 'SLA',
      ];

      const fmt = (d: Date) =>
        d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

      const body = rows.map((r) => [
        r.code,
        TYPE_LABELS[r.type],
        r.title,
        r.department.name,
        r.department2?.name ?? '',
        PRIORITY_LABELS[r.priority],
        STATUS_LABELS[r.status],
        // Anonim kaydın kimliği rapora da düşmez.
        r.anonymous ? 'Anonim' : r.createdBy.name,
        r.assignee?.name ?? '',
        fmt(r.createdAt),
        fmt(r.updatedAt),
        isOpen(r.status) ? (r.slaDueAt.getTime() <= now ? 'Gecikmiş' : 'Sürede') : 'Kapandı',
      ]);

      const csv = [head, ...body]
        .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
        .join('\r\n');

      await prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: 'report.export',
          entity: 'Record',
          entityId: '*',
          after: toJsonText({ rows: rows.length, department: dept?.id ?? null }),
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
