import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { actorOf, requireUser } from '../auth/guard.js';
import { can } from '../domain/permissions.js';
import { cleanFilename, contentDisposition, MAX_FILES, mimeFor } from '../domain/attachments.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { openStream, remove, saveStream } from '../lib/storage.js';

const tooLarge = () =>
  new AppError(413, 'TOO_LARGE', `Dosya en fazla ${env.MAX_UPLOAD_MB} MB olabilir; bir seferde en fazla ${MAX_FILES} dosya.`);

const recordForPermission = {
  id: true, status: true, departmentId: true, department2Id: true,
  createdById: true, assigneeId: true, anonymous: true,
} as const;

/**
 * Ek dosyalar. İki adım:
 *   1. Dosya seçilince yüklenir → "taslak" ek (eventId boş). Yalnızca yükleyen görür.
 *   2. Güncelleme ya da çözüm gönderilince taslak o olaya bağlanır (actions.ts).
 * Gönderilmeyen taslaklar 24 saat sonra silinir (pruneDraftAttachments).
 *
 * İndirme her zaman "attachment" olarak verilir, tarayıcıda açılmaz; içerik
 * türü izin listesinden gelir, istemcinin söylediğinden değil.
 */
export default async function attachmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  /** Yükle (çok parçalı form, alan adı serbest). */
  app.post('/api/records/:code/attachments', async (req) => {
    const actor = actorOf(req);
    const { code } = req.params as { code: string };
    if (!req.isMultipart()) throw badRequest('Dosya yüklemesi bekleniyordu.');

    const rec = await prisma.record.findUnique({ where: { code }, select: recordForPermission });
    if (!rec) throw notFound();
    if (!can('attach', rec, actor)) throw forbidden('Bu kayda dosya ekleme yetkiniz yok.');

    const saved: { key: string; size: number; name: string; mime: string }[] = [];
    try {
      for await (const part of req.files()) {
        const name = cleanFilename(part.filename);
        const mime = mimeFor(name);
        if (!mime) {
          part.file.resume(); // akışı tüket, istek askıda kalmasın
          throw badRequest(`"${name}" dosya türü desteklenmiyor. PDF, Office belgeleri, görseller, TXT/CSV, e-posta ve ZIP eklenebilir.`);
        }
        const out = await saveStream(part.file);
        if (part.file.truncated) {
          await remove(out.key);
          throw tooLarge();
        }
        if (out.size === 0) {
          await remove(out.key);
          throw badRequest(`"${name}" boş bir dosya.`);
        }
        saved.push({ ...out, name, mime });
      }
    } catch (err) {
      // Yarım kalan yüklemede diske yazılanları geri al.
      await Promise.all(saved.map((s) => remove(s.key)));
      const code = (err as { code?: string }).code;
      if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT') throw tooLarge();
      throw err;
    }
    if (saved.length === 0) throw badRequest('Dosya seçilmedi.');

    const rows = await prisma.$transaction(
      saved.map((s) =>
        prisma.attachment.create({
          data: { recordId: rec.id, name: s.name, size: s.size, mime: s.mime, storageKey: s.key, uploadedById: actor.id },
          select: { id: true, name: true, size: true, mime: true },
        }),
      ),
    );
    return { attachments: rows };
  });

  /** Gönderilmemiş taslağı sil — yalnızca yükleyen. */
  app.delete('/api/attachments/:id', async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const a = await prisma.attachment.findFirst({
      where: { id, uploadedById: actor.id, eventId: null },
      select: { id: true, storageKey: true },
    });
    if (!a) throw notFound('Taslak ek');
    await prisma.attachment.delete({ where: { id: a.id } });
    await remove(a.storageKey);
    return { ok: true };
  });

  /** İndir — kaydı görebilen herkes; taslağı yalnızca yükleyen. */
  app.get('/api/attachments/:id', async (req, reply) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const a = await prisma.attachment.findUnique({
      where: { id },
      select: {
        name: true, mime: true, size: true, storageKey: true, eventId: true, uploadedById: true,
        record: { select: recordForPermission },
      },
    });
    // Görme yetkisi olmayana "yok" denir; varlığı bile sızmasın.
    if (!a || !can('view', a.record, actor)) throw notFound('Ek');
    if (a.eventId == null && a.uploadedById !== actor.id) throw notFound('Ek');

    return reply
      .header('Content-Type', a.mime)
      .header('Content-Length', a.size)
      .header('Content-Disposition', contentDisposition(a.name))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(openStream(a.storageKey));
  });
}

/** 24 saatten eski, hiçbir güncellemeye bağlanmamış taslakları siler. */
export async function pruneDraftAttachments(olderThanMs = 24 * 60 * 60 * 1000) {
  const old = await prisma.attachment.findMany({
    where: { eventId: null, createdAt: { lt: new Date(Date.now() - olderThanMs) } },
    select: { id: true, storageKey: true },
    take: 500,
  });
  if (old.length === 0) return 0;
  await prisma.attachment.deleteMany({ where: { id: { in: old.map((a) => a.id) } } });
  await Promise.all(old.map((a) => remove(a.storageKey)));
  return old.length;
}
