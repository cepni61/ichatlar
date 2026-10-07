import type { Attachment, Record as DbRecord, RecordEvent } from '@prisma/client';
import {
  OPEN_STATUSES,
  PRIORITY_TO_SLUG,
  STATUS_TO_SLUG,
  TYPE_TO_SLUG,
} from '../domain/constants.js';
import { maySeeCreator, permissionsFor, type Actor } from '../domain/permissions.js';
import { slaStatus } from '../domain/sla.js';
import { parseDetails } from '../domain/suggestion.js';

const openSlugs: string[] = OPEN_STATUSES.map((s) => STATUS_TO_SLUG[s] ?? s);

type AttachmentView = Pick<Attachment, 'id' | 'name' | 'size' | 'mime'>;

export type FullRecord = DbRecord & {
  events?: (Pick<RecordEvent, 'type' | 'text' | 'at' | 'byId'> & { attachments?: AttachmentView[] })[];
  attachments?: AttachmentView[];
};

const attachmentSelect = { select: { id: true, name: true, size: true, mime: true } } as const;

/**
 * Detay ve liste için ortak include — olay akışı ve ekler. Ekler hem kayıt
 * düzeyinde (tüm gönderilmiş ekler) hem eklendikleri olayın altında gelir.
 * Taslaklar (eventId boş, henüz gönderilmemiş) hiç dönmez: yalnızca yükleyen
 * kişinin tarayıcısında durur.
 */
export const detailInclude = {
  events: {
    orderBy: { at: 'asc' as const },
    select: { type: true, text: true, at: true, byId: true, attachments: attachmentSelect },
  },
  attachments: { where: { eventId: { not: null } }, ...attachmentSelect },
};

const viewAttachment = (a: AttachmentView) => ({ id: a.id, name: a.name, size: a.size, mime: a.mime });

/**
 * Kaydı arayüzün beklediği şekle çevirir (prototipteki alan adları korunur)
 * ve görme yetkisine göre kısar.
 *
 * Anonim kayıtta createdById tarayıcıya hiç gönderilmez. Gizlemeyi arayüze
 * bırakmak yeterli değildi: ağ sekmesini açan biri kimliği görebilirdi.
 */
export async function serializeRecord(rec: FullRecord, actor: Actor) {
  const showCreator = maySeeCreator(rec, actor);
  const sla = await slaStatus(
    { priority: rec.priority, createdAt: rec.createdAt, slaDueAt: rec.slaDueAt, status: STATUS_TO_SLUG[rec.status] ?? rec.status },
    openSlugs,
  );

  return {
    code: rec.code,
    type: TYPE_TO_SLUG[rec.type] ?? rec.type,
    title: rec.title,
    description: rec.description,
    priority: PRIORITY_TO_SLUG[rec.priority],
    status: STATUS_TO_SLUG[rec.status],

    department: rec.departmentId,
    department2: rec.department2Id,

    createdBy: showCreator ? rec.createdById : null,
    assignee: rec.assigneeId,
    anonymous: rec.anonymous,

    resolution: rec.resolution,
    /** Öneri kaydının yapısal alanları; bilgi kaydında null. */
    oneri: parseDetails(rec.details),

    createdAt: rec.createdAt.toISOString(),
    updatedAt: rec.updatedAt.toISOString(),
    firstResponseAt: rec.firstResponseAt?.toISOString() ?? null,
    resolvedAt: rec.resolvedAt?.toISOString() ?? null,
    closedAt: rec.closedAt?.toISOString() ?? null,

    slaDueAt: rec.slaDueAt.toISOString(),
    sla: { level: sla.level, pct: sla.pct, remainingMs: sla.remainingMs, limitHours: sla.limitHours },

    history: (rec.events ?? []).map((e) => ({
      t: e.type.toLowerCase(),
      at: e.at.toISOString(),
      // Anonim kaydın kendi olayları da kimliği sızdırmamalı.
      by: !showCreator && e.byId === rec.createdById ? null : e.byId,
      text: e.text,
      attachments: (e.attachments ?? []).map(viewAttachment),
    })),

    attachments: (rec.attachments ?? []).map(viewAttachment),

    permissions: permissionsFor(rec, actor),
  };
}

export async function serializeList(recs: FullRecord[], actor: Actor) {
  return Promise.all(recs.map((r) => serializeRecord(r, actor)));
}
