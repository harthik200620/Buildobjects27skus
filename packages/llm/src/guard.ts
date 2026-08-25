import { USAGE_LOG_FILE } from './cost';
import { LlmBudgetError } from './errors';
import { readReportTail } from './paths';

/** GEMINI_DAILY_CALL_CAP — logical calls per UTC day per process (default 2000). */
export function dailyCallCap(): number {
  const n = Number(process.env.GEMINI_DAILY_CALL_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

let daily: { date: string; used: number } | null = null;

/**
 * Seeds today's counter from the tail of llm-usage.jsonl once per process, so a pipeline re-run
 * after a crash does not restart the budget from zero. Best effort: unreadable log → 0.
 */
function seedFromLog(date: string): number {
  const tail = readReportTail(USAGE_LOG_FILE, 2_000_000);
  if (!tail) return 0;
  const needle = `"ts":"${date}`;
  let count = 0;
  for (const line of tail.split('\n')) if (line.includes(needle)) count += 1;
  return count;
}

function today(): { date: string; used: number } {
  const date = utcDay();
  if (!daily || daily.date !== date) daily = { date, used: daily ? 0 : seedFromLog(date) };
  return daily;
}

export interface DailyBudget {
  date: string;
  used: number;
  cap: number;
  remaining: number;
}

export function dailyBudget(): DailyBudget {
  const d = today();
  const cap = dailyCallCap();
  return { date: d.date, used: d.used, cap, remaining: Math.max(0, cap - d.used) };
}

/** Counts one logical call (retries are not counted). Throws `LlmBudgetError` once the cap is reached. */
export function takeDailyCall(caller: string): DailyBudget {
  const d = today();
  const cap = dailyCallCap();
  if (d.used >= cap)
    throw new LlmBudgetError(`GEMINI_DAILY_CALL_CAP (${cap}) reached for ${d.date} — ${caller} refused; raise the cap or wait for the next UTC day`);
  d.used += 1;
  return { date: d.date, used: d.used, cap, remaining: Math.max(0, cap - d.used) };
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Milliseconds until a slot frees (0 when ok). */
  retryAfterMs: number;
}

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;

/**
 * Sliding-window limiter keyed by anything (IP, IP+session, route). `limit` calls per `windowMs`.
 * In-memory per process — enough for one web instance; note Redis for horizontal scale.
 * Returns `{ ok:false, retryAfterMs }` without consuming when the window is full.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, stamps] of buckets) if (stamps.length === 0 || now - stamps[stamps.length - 1] > windowMs) buckets.delete(k);
  }
  const stamps = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (stamps.length >= limit) {
    buckets.set(key, stamps);
    return { ok: false, limit, remaining: 0, retryAfterMs: Math.max(1, stamps[0] + windowMs - now) };
  }
  stamps.push(now);
  buckets.set(key, stamps);
  return { ok: true, limit, remaining: limit - stamps.length, retryAfterMs: 0 };
}

/** Parses "5/600" (calls per seconds) the way REFINE_RATE_LIMIT is documented; null when malformed. */
export function parseRateSpec(spec: string | undefined): { limit: number; windowMs: number } | null {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(spec ?? '');
  if (!m) return null;
  const limit = Number(m[1]);
  const seconds = Number(m[2]);
  if (!(limit > 0) || !(seconds > 0)) return null;
  return { limit, windowMs: seconds * 1000 };
}

/** @internal */
export function __resetGuardsForTests(opts: { seedDaily?: number } = {}): void {
  daily = opts.seedDaily !== undefined ? { date: utcDay(), used: opts.seedDaily } : null;
  buckets.clear();
}
