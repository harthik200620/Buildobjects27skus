import { hasGemini } from '@buildobjects/llm';
import { type NextRequest, NextResponse } from 'next/server';
import { clientIp, rateLimit, refineLimits, retryAfterSeconds, takeDaily, tooManyRequests } from '@/lib/rate-limit';
import { getCachedReview, refineCacheKey, refineStatus, reviewEstimate } from '@/lib/refine';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

/**
 * AI review of a cost estimate. Full contract in apps/web/lib/refine.ts.
 *   GET  → RefineStatus (live flag, model, limits, budget) for the panel's empty state.
 *   POST { inputs } → RefineResponse | 400 | 401 | 429 (+Retry-After) | 502 | 503 { unlock } | 504.
 * Order: session → body → key (503) → cache (hits are free) → per-IP+session window → daily cap → Gemini.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json(refineStatus(), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { inputs?: unknown } | null;
  if (!body || typeof body !== 'object' || !body.inputs || typeof body.inputs !== 'object') {
    return NextResponse.json({ error: 'inputs required' }, { status: 400 });
  }
  if (!hasGemini()) {
    return NextResponse.json(
      { error: 'AI review is off — set GEMINI_API_KEY in .env to unlock it', unlock: 'GEMINI_API_KEY', provider: 'off' },
      { status: 503 },
    );
  }

  const key = refineCacheKey(body.inputs as Record<string, unknown>);
  const cached = getCachedReview(key);
  if (cached) return NextResponse.json({ ...cached, cached: true }, { headers: { 'Cache-Control': 'private, no-store', 'X-Refine-Cache': 'hit' } });

  const { window, dailyCap } = refineLimits();
  const rl = rateLimit(`refine:${clientIp(req)}:${session.sid}`, window.limit, window.windowMs);
  if (!rl.ok) {
    return tooManyRequests(
      `AI review is limited to ${window.limit} per ${Math.round(window.windowMs / 60_000)} minutes — try again in ${retryAfterSeconds(rl.retryAfterMs)} s`,
      rl.retryAfterMs,
      { limit: rl.limit },
    );
  }
  const daily = takeDaily('refine', dailyCap);
  if (!daily.ok) return tooManyRequests(`Today's AI review allowance (${dailyCap}) is used up — it resets at 00:00 UTC`, daily.retryAfterMs, { dailyCap });

  try {
    const review = await reviewEstimate(body.inputs as never, { key });
    return NextResponse.json(review, { headers: { 'Cache-Control': 'private, no-store', 'X-Refine-Cache': 'miss' } });
  } catch (e) {
    const err = e as { code?: string; message?: string; name?: string };
    if (err.code === 'unavailable')
      return NextResponse.json(
        { error: 'AI review is off — set GEMINI_API_KEY in .env to unlock it', unlock: 'GEMINI_API_KEY', provider: 'off' },
        { status: 503 },
      );
    if (err.code === 'budget') {
      const untilMidnight = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1) - Date.now();
      return tooManyRequests('The Gemini daily call budget is used up — it resets at 00:00 UTC', untilMidnight);
    }
    if (err.code === 'aborted' || err.name === 'TimeoutError' || err.name === 'AbortError') {
      return NextResponse.json({ error: 'The review did not finish in time — try again' }, { status: 504 });
    }
    console.error('[refine] review failed', e);
    if (err.code === 'bad_output') return NextResponse.json({ error: 'The model did not return a usable review — try again' }, { status: 502 });
    return NextResponse.json({ error: 'AI review failed — try again shortly' }, { status: 502 });
  }
}
