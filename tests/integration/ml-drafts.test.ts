import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/*
 * Kayıt taslağı yazılırken yapılan her tarama ML veritabanına metniyle
 * yazılır. Kayıt kısıtlı açılırsa bütün taramalar silinmeli, anonim açılırsa
 * kişiden koparılmalı — yalnızca son tarama değil. Testte ML veritabanı yok;
 * çağrılar sahte istemciyle yakalanır.
 */
const calls = vi.hoisted(() => [] as { op: string; args: unknown }[]);
vi.mock('../../src/ml/db.js', async (orig) => ({
  ...(await orig<typeof import('../../src/ml/db.js')>()),
  mlDb: () => ({
    inference: {
      create: async (args: unknown) => { calls.push({ op: 'create', args }); return { id: 'inf-' + calls.length }; },
      deleteMany: async (args: unknown) => { calls.push({ op: 'deleteMany', args }); return { count: 0 }; },
      updateMany: async (args: unknown) => { calls.push({ op: 'updateMany', args }); return { count: 0 }; },
      findUnique: async () => null,
    },
  }),
}));

const { createDept, createUser, loginAs, makeApp, resetDb } = await import('./helpers.js');

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); calls.length = 0; });

async function setup() {
  const ik = await createDept('İnsan Kaynakları');
  const u = await createUser({ name: 'Açan', departmentId: ik.id });
  return { ik, u, headers: await loginAs(app, u.id) };
}
const draft = { type: 'bilgi', title: 'Kişisel konu başlığı', description: 'Ayrıntılı açıklama metni burada.' };

describe('ML taslak taramaları', () => {
  it('kısıtlı işaretliyken tarama ML veritabanına yazılmaz', async () => {
    const { headers } = await setup();
    const scan = (restricted: boolean) =>
      app.inject({ method: 'POST', url: '/api/similar', headers, payload: { title: draft.title, description: draft.description, restricted } });
    expect((await scan(true)).json().inferenceId).toBeNull();
    expect(calls.filter((c) => c.op === 'create')).toHaveLength(0);
    expect((await scan(false)).json().inferenceId).toBeTruthy();
  });

  it('kısıtlı kayıt açılınca kişinin bütün taslak taramaları silinir', async () => {
    const { ik, u, headers } = await setup();
    const res = await app.inject({
      method: 'POST', url: '/api/records', headers,
      payload: { ...draft, department: ik.id, restricted: true, mlInferenceIds: ['a', 'b'], mlInferenceId: 'c' },
    });
    expect(res.statusCode).toBe(201);
    expect(calls).toContainEqual({ op: 'deleteMany', args: { where: { id: { in: ['a', 'b', 'c'] }, userId: u.id } } });
  });

  it('anonim kayıtta taramalar kişiden koparılır', async () => {
    const { ik, u, headers } = await setup();
    await app.inject({
      method: 'POST', url: '/api/records', headers,
      payload: { ...draft, department: ik.id, anonymous: true, mlInferenceIds: ['a', 'b'] },
    });
    expect(calls).toContainEqual({ op: 'updateMany', args: { where: { id: { in: ['a', 'b'] }, userId: u.id }, data: { userId: null } } });
  });
});
