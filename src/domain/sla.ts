import { Priority } from './enums.js';
import { prisma } from '../db.js';
import { HOUR_MS } from './constants.js';

export type SlaLevel = 'green' | 'yellow' | 'red' | 'off';

export interface SlaRuleView {
  priority: string;
  hours: number;
  warnRatio: number;
}

/**
 * SLA kuralları yönetim ekranından değiştirilebildiği için veritabanında
 * durur. Her istekte sorgulamamak adına kısa süreli önbelleğe alınır.
 */
let cache: { at: number; rules: Map<string, SlaRuleView> } | null = null;
const CACHE_MS = 30_000;

export function invalidateSlaCache() {
  cache = null;
}

export async function slaRules(): Promise<Map<string, SlaRuleView>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rules;

  const rows = await prisma.slaRule.findMany();
  const rules = new Map<string, SlaRuleView>();
  for (const r of rows) {
    rules.set(r.priority, { priority: r.priority, hours: r.hours, warnRatio: r.warnRatio });
  }

  // Kural satırı silinmişse sistem çalışmaya devam etsin.
  const fallback: Record<Priority, number> = { NORMAL: 48, YUKSEK: 24, KRITIK: 8 };
  for (const p of Object.values(Priority)) {
    if (!rules.has(p)) rules.set(p, { priority: p, hours: fallback[p], warnRatio: 0.7 });
  }

  cache = { at: Date.now(), rules };
  return rules;
}

export async function dueDateFor(priority: string, createdAt: Date): Promise<Date> {
  const rule = (await slaRules()).get(priority)!;
  return new Date(createdAt.getTime() + rule.hours * HOUR_MS);
}

/**
 * Kaydın süre durumu. Prototiple aynı eşikler: hedefin %70'i geçilince sarı,
 * hedef aşılınca kırmızı. Kapanmış kayıtta sayaç durur.
 */
export async function slaStatus(rec: {
  priority: string;
  createdAt: Date;
  slaDueAt: Date;
  status: string;
}, openStatuses: readonly string[], now = new Date()) {
  const rule = (await slaRules()).get(rec.priority)!;
  const open = openStatuses.includes(rec.status);

  const limitMs = rec.slaDueAt.getTime() - rec.createdAt.getTime();
  const ageMs = now.getTime() - rec.createdAt.getTime();
  const pct = limitMs > 0 ? Math.min(100, Math.round((ageMs / limitMs) * 100)) : 100;

  if (!open) {
    return { level: 'off' as SlaLevel, pct: 0, remainingMs: 0, limitHours: rule.hours, open };
  }
  const remainingMs = rec.slaDueAt.getTime() - now.getTime();
  const level: SlaLevel =
    remainingMs <= 0 ? 'red' : ageMs >= limitMs * rule.warnRatio ? 'yellow' : 'green';

  return { level, pct, remainingMs, limitHours: rule.hours, open };
}
