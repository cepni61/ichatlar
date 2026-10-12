import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { asRole, type Role } from '../domain/enums.js';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { activeGrant, GrantKind } from '../domain/grants.js';

export const SESSION_COOKIE = 'ih_sid';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  /** Departman sorumlusu olduğu departmanlar (Yetkiler ekranı). */
  headOf: string[];
  /** Raporları görebilir: yönetici, sistem yöneticisi, rapor görüntüleyici ya da departman sorumlusu. */
  reports: boolean;
}

/** Oturum kimliği tahmin edilemez olmalı; çerezde yalnızca bu değer taşınır. */
function newSessionId() {
  return randomBytes(32).toString('base64url');
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | undefined; ip?: string | undefined },
) {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + env.sessionTtlMs);
  await prisma.session.create({
    data: { id, userId, expiresAt, userAgent: meta.userAgent ?? null, ip: meta.ip ?? null },
  });
  return { id, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, id: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax', // Entra geri dönüşü çapraz siteden geldiği için 'strict' olamaz
    secure: env.httpsSite,
    signed: true,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Çerezdeki oturumu çözer. Süresi geçmiş veya iptal edilmiş oturum
 * geçersizdir — oturumlar sunucuda tutulduğu için tek tek iptal edilebilir
 * (JWT'de bu mümkün olmazdı).
 */
export async function resolveSession(req: FastifyRequest): Promise<SessionUser | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;

  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;

  const session = await prisma.session.findUnique({
    where: { id: unsigned.value },
    select: {
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          departmentId: true,
          department: { select: { name: true } },
          // Rolü değiştirmeyen yetkiler her istekte okunur: süresi dolan hemen işlemez.
          grants: {
            where: { kind: { in: [GrantKind.DEPT_HEAD, GrantKind.REPORTS] }, AND: [activeGrant()] },
            select: { kind: true, departmentId: true },
          },
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  if (!session.user.active) return null;

  const role = asRole(session.user.role);
  const grants = session.user.grants;
  const headOf = grants.filter((g) => g.kind === GrantKind.DEPT_HEAD && g.departmentId).map((g) => g.departmentId!);
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role,
    departmentId: session.user.departmentId,
    departmentName: session.user.department?.name ?? null,
    headOf,
    reports: role === 'MANAGER' || role === 'ADMIN' || headOf.length > 0 || grants.some((g) => g.kind === GrantKind.REPORTS),
  };
}

export async function revokeSession(id: string) {
  await prisma.session.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Süresi geçmiş oturumları temizler — SLA işiyle birlikte çalışır. */
export async function pruneSessions() {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  return count;
}
