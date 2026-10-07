import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createSession, SESSION_COOKIE } from '../../src/auth/session.js';
import { Priority, RecordStatus, RecordType, Role } from '../../src/domain/enums.js';
import { assertTestDatabase } from '../test-db.js';

/** Log kapalı uygulama. Port açılmaz; istekler app.inject() ile gider. */
export async function makeApp() {
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

/** Sessiz günlükçü — iş fonksiyonları (SLA gözcüsü vb.) log nesnesi istiyor. */
export const silentLog = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return silentLog; }, level: 'silent',
} as never;

/**
 * Tabloları bağımlılık sırasıyla boşaltır. Her test temiz başlar.
 * Önce bağlı olunan veritabanının test veritabanı olduğu doğrulanır.
 */
export async function resetDb() {
  assertTestDatabase(process.env.DATABASE_URL);
  await prisma.notification.deleteMany();
  await prisma.feedback.deleteMany();
  await prisma.kbEditor.deleteMany();
  await prisma.kbArticle.deleteMany();
  await prisma.suggestion.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.recordEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.record.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
  await prisma.counter.deleteMany();
}

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export async function createDept(name: string) {
  return prisma.department.create({
    data: { id: uid('dept'), name, short: name.slice(0, 3).toUpperCase(), order: seq },
  });
}

export async function createUser(opts: {
  name: string;
  role?: Role;
  departmentId?: string | null;
  active?: boolean;
}) {
  const id = uid('u');
  return prisma.user.create({
    data: {
      id,
      entraOid: id,
      email: `${id}@test.local`,
      name: opts.name,
      role: opts.role ?? Role.USER,
      departmentId: opts.departmentId ?? null,
      active: opts.active ?? true,
    },
  });
}

/** Doğrudan veritabanına kayıt yazar; API'nin kayıt açma akışından bağımsız kurulum için. */
export async function createRecord(opts: {
  createdById: string;
  departmentId: string;
  department2Id?: string | null;
  assigneeId?: string | null;
  status?: RecordStatus;
  anonymous?: boolean;
  slaDueAt?: Date;
  title?: string;
  type?: RecordType;
  resolution?: string | null;
}) {
  const now = new Date();
  return prisma.record.create({
    data: {
      code: uid('KAY'),
      type: opts.type ?? RecordType.BILGI,
      title: opts.title ?? 'Test kaydı başlığı',
      resolution: opts.resolution ?? null,
      description: 'Test kaydının açıklaması',
      priority: Priority.NORMAL,
      status: opts.status ?? RecordStatus.YENI,
      departmentId: opts.departmentId,
      department2Id: opts.department2Id ?? null,
      createdById: opts.createdById,
      assigneeId: opts.assigneeId ?? null,
      anonymous: opts.anonymous ?? false,
      createdAt: now,
      slaDueAt: opts.slaDueAt ?? new Date(now.getTime() + 48 * 3600 * 1000),
    },
  });
}

/** Kullanıcı adına imzalı oturum çerezi üretir — gerçek giriş akışıyla aynı çerez. */
export async function loginAs(app: FastifyInstance, userId: string) {
  const s = await createSession(userId, { userAgent: 'vitest', ip: '127.0.0.1' });
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(app.signCookie(s.id))}` };
}

export { prisma };
