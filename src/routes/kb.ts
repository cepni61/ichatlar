import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { isAssignableUnit, loadOrgTree } from '../domain/org.js';
import { actorOf, requireUser } from '../auth/guard.js';
import { canEditDept, isHttpUrl, KB_KIND_KEYS, KB_KINDS, kbAccess } from '../domain/kb.js';
import { fold } from '../domain/similarity.js';
import { toJsonText } from '../lib/dialect.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { relearn } from '../ml/service.js';

/**
 * Bilgi Bankası yönetimi. Yetki kuralları domain/kb.ts'de. Her yazma işlemi
 * denetim izine düşer ve ML'i arka planda yeniden eğitir (maddeler departman
 * modeline ve benzer kayıt aramasına girer).
 */
const articleBody = z.object({
  kind: z.enum(KB_KIND_KEYS).default('BILGI'),
  departmentId: z.string().min(1).max(64),
  title: z.string().trim().min(5, 'Başlık en az 5 karakter olmalı.').max(200),
  keywords: z.string().trim().max(500).nullish(),
  answer: z.string().trim().min(10, 'Yanıt en az 10 karakter olmalı.').max(5000),
  url: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .refine((v) => !v || isHttpUrl(v), 'Bağlantı http:// ya da https:// ile başlamalı.'),
});

const articleSelect = {
  id: true, seq: true, kind: true, title: true, keywords: true, answer: true, url: true, updatedAt: true,
  department: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} as const;

export default async function kbRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/kb', async (req) => {
    const actor = actorOf(req);
    const access = await kbAccess(actor);
    if (!access.view) throw forbidden('Bilgi Bankası yalnızca yöneticilere ve yetki verilen kişilere açık.');

    const q = z
      .object({
        department: z.string().max(64).optional(),
        kind: z.enum(KB_KIND_KEYS).optional(),
        q: z.string().trim().max(100).optional(),
      })
      .safeParse(req.query);
    if (!q.success) throw badRequest('Geçersiz filtre.');

    const rows = await prisma.kbArticle.findMany({
      where: {
        active: true,
        ...(q.data.department ? { departmentId: q.data.department } : {}),
        ...(q.data.kind ? { kind: q.data.kind } : {}),
      },
      orderBy: [{ department: { order: 'asc' } }, { updatedAt: 'desc' }],
      select: articleSelect,
    });
    const needle = q.data.q ? fold(q.data.q) : '';
    const items = rows
      .filter((r) => !needle || fold(`${r.title} ${r.keywords ?? ''} ${r.answer}`).includes(needle))
      .map((r) => ({
        id: r.id,
        code: `BB-${r.seq}`,
        kind: r.kind,
        kindLabel: KB_KINDS[r.kind as keyof typeof KB_KINDS] ?? r.kind,
        department: r.department,
        title: r.title,
        keywords: r.keywords,
        answer: r.answer,
        url: r.url,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy?.name ?? r.createdBy?.name ?? null,
        canEdit: canEditDept(access, r.department.id),
      }));
    return { items, access: { admin: access.admin, edit: access.edit } };
  });

  // Bilgi Bankası maddesi ve düzenleme yetkisi ekibe bağlanır (kayıtlar gibi):
  // ekipleri olan bir departman doğrudan seçilemez.
  async function activeDept(id: string) {
    if (!isAssignableUnit(await loadOrgTree(prisma), id)) throw badRequest('Ekip bulunamadı.');
  }

  app.post('/api/kb', async (req, reply) => {
    const actor = actorOf(req);
    const access = await kbAccess(actor);
    const parsed = articleBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);
    const b = parsed.data;
    if (!canEditDept(access, b.departmentId)) throw forbidden('Bu ekibin Bilgi Bankası maddelerini düzenleme yetkiniz yok.');
    await activeDept(b.departmentId);

    const row = await prisma.kbArticle.create({
      data: {
        kind: b.kind, departmentId: b.departmentId, title: b.title,
        keywords: b.keywords || null, answer: b.answer, url: b.url || null,
        createdById: actor.id, updatedById: actor.id,
      },
      select: { id: true, seq: true },
    });
    await prisma.auditLog.create({
      data: {
        actorId: actor.id, action: 'kb.create', entity: 'KbArticle', entityId: row.id,
        after: toJsonText({ title: b.title, departmentId: b.departmentId, kind: b.kind }), ip: req.ip,
      },
    });
    relearn(req.log);
    return reply.code(201).send({ id: row.id, code: `BB-${row.seq}` });
  });

  app.put('/api/kb/:id', async (req) => {
    const actor = actorOf(req);
    const access = await kbAccess(actor);
    const { id } = req.params as { id: string };
    const parsed = articleBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);
    const b = parsed.data;

    const old = await prisma.kbArticle.findFirst({ where: { id, active: true } });
    if (!old) throw notFound('Bilgi Bankası maddesi');
    if (!canEditDept(access, old.departmentId) || !canEditDept(access, b.departmentId)) {
      throw forbidden('Bu ekibin Bilgi Bankası maddelerini düzenleme yetkiniz yok.');
    }
    await activeDept(b.departmentId);

    await prisma.kbArticle.update({
      where: { id },
      data: {
        kind: b.kind, departmentId: b.departmentId, title: b.title,
        keywords: b.keywords || null, answer: b.answer, url: b.url || null, updatedById: actor.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: actor.id, action: 'kb.update', entity: 'KbArticle', entityId: id,
        before: toJsonText({ title: old.title, departmentId: old.departmentId }),
        after: toJsonText({ title: b.title, departmentId: b.departmentId }), ip: req.ip,
      },
    });
    relearn(req.log);
    return { ok: true };
  });

  /** Silme yumuşak: madde pasife alınır, denetim izi ve geçmiş eşleşmeler bozulmaz. */
  app.delete('/api/kb/:id', async (req) => {
    const actor = actorOf(req);
    const access = await kbAccess(actor);
    const { id } = req.params as { id: string };
    const old = await prisma.kbArticle.findFirst({ where: { id, active: true } });
    if (!old) throw notFound('Bilgi Bankası maddesi');
    if (!canEditDept(access, old.departmentId)) throw forbidden('Bu maddeyi kaldırma yetkiniz yok.');
    await prisma.kbArticle.update({ where: { id }, data: { active: false, updatedById: actor.id } });
    await prisma.auditLog.create({
      data: { actorId: actor.id, action: 'kb.delete', entity: 'KbArticle', entityId: id, before: toJsonText({ title: old.title }), ip: req.ip },
    });
    relearn(req.log);
    return { ok: true };
  });
}
