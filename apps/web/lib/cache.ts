import 'server-only';
import { LRUCache } from 'lru-cache';

/**
 * Per-process read-through cache for catalogue reads.
 *
 * Reads here are hot and identical across requests (a PDP is rendered many times a minute from
 * one row), so we hold them briefly in memory rather than paying MySQL or Meilisearch per view.
 * Two properties matter and are easy to get wrong by hand:
 *
 *   bounded    — LRU eviction, so a crawler walking 400k SKUs cannot grow the heap without limit.
 *   coalesced  — concurrent misses on the same key share one upstream call. Without this a cold
 *                cache under load fans every in-flight request out to the database at once.
 *
 * Scope is one Node process. Behind more than one instance each keeps its own copy, which is
 * fine at this TTL; a shared cache is a Redis change, not a change here.
 */

/** Long enough to collapse a burst, short enough that a re-index shows up without a deploy. */
export const DEFAULT_TTL_MS = 60_000;

export interface MemoOptions {
  /** Entries to keep before evicting the least recently used. */
  max?: number;
  /** How long an entry stays fresh. */
  ttlMs?: number;
}

/**
 * Values are boxed so a loader that legitimately resolves `null` — "no such SKU" — is cached as
 * a negative result instead of being re-fetched on every miss. `lru-cache` treats a bare
 * `undefined` from `fetchMethod` as "nothing to store".
 */
interface Box<V> {
  value: V;
}

/**
 * Wraps an async loader in a read-through cache keyed by its single argument.
 *
 *   const loadThing = memo((id: string) => db.thing(id), { max: 5_000 });
 *
 * Loader rejections are not cached — the next call retries.
 */
export function memo<K extends {}, V>(load: (key: K) => Promise<V>, { max = 1_000, ttlMs = DEFAULT_TTL_MS }: MemoOptions = {}): (key: K) => Promise<V> {
  const cache = new LRUCache<K, Box<V>, void>({
    max,
    ttl: ttlMs,
    // Serve one upstream call per key; every concurrent miss awaits the same promise.
    fetchMethod: async (key) => ({ value: await load(key) }),
  });
  return async (key: K) => (await cache.forceFetch(key)).value;
}

/**
 * The no-argument case: one value, refreshed on the first read after it goes stale.
 * Used for the small reference tables (regions, categories, brands) every page needs.
 */
export function memoOnce<V>(load: () => Promise<V>, opts: MemoOptions = {}): () => Promise<V> {
  const inner = memo<string, V>(load, { ...opts, max: 1 });
  return () => inner('value');
}
