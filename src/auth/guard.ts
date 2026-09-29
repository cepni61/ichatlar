import type { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '../domain/enums.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { resolveSession, type SessionUser } from './session.js';
import type { Actor } from '../domain/permissions.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

/**
 * Oturumu çözüp isteğe bağlar. Kimliksiz istekleri reddetmez — bunu
 * `requireUser` yapar. Böylece açık uçlar (sağlık kontrolü, giriş) aynı
 * boru hattını kullanabilir.
 */
export async function attachUser(req: FastifyRequest) {
  const user = await resolveSession(req);
  if (user) req.user = user;
}

export async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
  if (!req.user) throw unauthorized();
}

export function requireRole(...roles: Role[]) {
  return async function (req: FastifyRequest) {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
  };
}

/** Alan katmanının beklediği sade aktör nesnesi. */
export function actorOf(req: FastifyRequest): Actor {
  const u = req.user;
  if (!u) throw unauthorized();
  return { id: u.id, role: u.role, departmentId: u.departmentId };
}
