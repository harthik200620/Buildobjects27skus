import 'server-only';
import { parseRateSpec, type RateLimitResult, rateLimit } from '@buildobjects/llm';
import { NextResponse } from 'next/server';

/**
 * Web-route throttles for the calculator's AI routes, built on `@buildobjects/llm`'s in-memory
 * sliding window (`rateLimit`) — one process, one instance; Redis is the documented next step for
 * horizontal scale. Nothing here talks to Gemini; it only decides whether a route may.
 *
 *   REFINE_RATE_LIMIT="5/600"  calls per seconds, per IP + session, for POST /api/estimate/refine
 *   REFINE_DAILY_CAP=200       reviews per UTC day per process (the Gemini-wide GEMINI_DAILY_CALL_CAP still applies)
 *   drawing reads              10 per 10 minutes per IP (constant; no env knob)
 */
export { type RateLimitResult, rateLimit };

export interface WindowLimit {
  limit: number;
  windowMs: number;
}

/** Parses "calls/seconds" (e.g. "5/600"); unset or malformed → `fallback`. */
export function windowLimit(spec: string | undefined, fallback: WindowLimit): WindowLimit {
  return parseRateSpec(spec) ?? fallback;
}

/** Positive integer from the environment, else `fallback`. */
export function envCap(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const REFINE_DEFAULT_LIMIT: WindowLimit = { limit: 5, windowMs: 600_000 };
export const REFINE_DEFAULT_DAILY_CAP = 200;
export const DRAWING_LIMIT: WindowLimit = { limit: 10, windowMs: 600_000 };

export function refineLimits(): { window: WindowLimit; dailyCap: number } {
  return { window: windowLimit(process.env.REFINE_RATE_LIMIT, REFINE_DEFAULT_LIMIT), dailyCap: envCap('REFINE_DAILY_CAP', REFINE_DEFAULT_DAILY_CAP) };
}

/** Best-effort client address: first hop of x-forwarded-for → x-real-ip → 'local' (dev server, no proxy). */
export function clientIp(req: { headers: Headers }): string {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = req.headers.get('x-real-ip')?.trim();
  return real ? real.slice(0, 64) : 'local';
}

export interface DailyResult {
  ok: boolean;
  used: number;
  cap: number /** ms until the next UTC midnight when refused, else 0 */;
  retryAfterMs: number;
  date: string;
}

const days = new Map<string, { date: string; used: number }>();
const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
const msToNextUtcDay = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
};

/** Per-UTC-day counter for one feature (REFINE_DAILY_CAP). Consumes a slot when it answers ok. */
export function takeDaily(name: string, cap: number, now = Date.now()): DailyResult {
  const date = utcDay(now);
  let d = days.get(name);
  if (!d || d.date !== date) {
    d = { date, used: 0 };
    days.set(name, d);
  }
  if (d.used >= cap) return { ok: false, used: d.used, cap, retryAfterMs: msToNextUtcDay(now), date };
  d.used += 1;
  return { ok: true, used: d.used, cap, retryAfterMs: 0, date };
}

/** Slots used today for `name` (0 when the day rolled over). */
export function dailyUsed(name: string, now = Date.now()): number {
  const d = days.get(name);
  return d && d.date === utcDay(now) ? d.used : 0;
}

export const retryAfterSeconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** 429 with a `Retry-After` header (seconds) and `{ error, retryAfterMs, ...extra }`. */
export function tooManyRequests(error: string, retryAfterMs: number, extra: Record<string, unknown> = {}): NextResponse {
  const s = retryAfterSeconds(retryAfterMs);
  return NextResponse.json({ error, retryAfterMs: s * 1000, ...extra }, { status: 429, headers: { 'Retry-After': String(s), 'Cache-Control': 'no-store' } });
}
