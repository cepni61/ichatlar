import type { FastifyBaseLogger } from 'fastify';
import { env } from '../env.js';
import { isHttpUrl } from '../domain/kb.js';

/**
 * Cortex — kurumsal uygulama / süreç / bilgi araması için dış kaynak.
 *
 * Kaynağın sözleşmesi henüz belli değil; bu dosya bağdaştırıcıdır. Varsayılan
 * sözleşme (değişirse yalnızca `toItems` ve istek satırı güncellenir):
 *
 *   GET {CORTEX_URL}?q=<sorgu>&limit=8
 *   Authorization: Bearer {CORTEX_TOKEN}      (token boşsa başlık gönderilmez)
 *   → { results: [{ title, summary?, url?, type? }] }
 *
 * CORTEX_URL boşsa çağrı yapılmaz, arama yalnızca Bilgi Bankası ve çözülmüş
 * kayıtlarla çalışır. Cortex yavaşsa ya da hata verirse arama beklemez:
 * CORTEX_TIMEOUT_MS sonra vazgeçilir, sonuç "hata" olarak işaretlenir.
 */
export interface CortexItem {
  title: string;
  text: string;
  url: string | null;
  kind: string;
}

export type CortexStatus = 'kapali' | 'ok' | 'hata';

function toItems(body: unknown): CortexItem[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, 8).flatMap((r) => {
    const x = r as { title?: unknown; summary?: unknown; url?: unknown; type?: unknown };
    if (typeof x.title !== 'string' || !x.title.trim()) return [];
    const url = typeof x.url === 'string' && isHttpUrl(x.url) ? x.url : null;
    return [{
      title: x.title.slice(0, 200),
      text: typeof x.summary === 'string' ? x.summary.slice(0, 600) : '',
      url,
      kind: typeof x.type === 'string' ? x.type.slice(0, 40) : 'Cortex',
    }];
  });
}

export async function cortexSearch(
  q: string,
  log: FastifyBaseLogger,
): Promise<{ status: CortexStatus; items: CortexItem[] }> {
  if (!env.CORTEX_URL) return { status: 'kapali', items: [] };
  try {
    const url = new URL(env.CORTEX_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '8');
    const res = await fetch(url, {
      headers: env.CORTEX_TOKEN ? { Authorization: `Bearer ${env.CORTEX_TOKEN}` } : {},
      signal: AbortSignal.timeout(env.CORTEX_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: 'ok', items: toItems(await res.json()) };
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'Cortex araması başarısız');
    return { status: 'hata', items: [] };
  }
}
