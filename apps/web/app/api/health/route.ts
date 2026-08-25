import { getDb } from '@buildobjects/db';
import { dailyBudget, hasGemini, usageSummary } from '@buildobjects/llm';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { drawingProvider } from '@/lib/drawing';
import { ensurePgSchema, getPg, hasPg } from '@/lib/pg-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const out: Record<string, unknown> = { ok: true, time: new Date().toISOString() };
  /*
   * The runtime store first, because that is the one a deployment actually has. `ok` follows it:
   * the catalogue comes from the frozen snapshot either way, so a missing MySQL is a laptop
   * without the pipeline running, not an unhealthy instance.
   */
  if (hasPg()) {
    try {
      await ensurePgSchema();
      await getPg().execute(sql`SELECT 1`);
      out.postgres = 'up';
    } catch (e) {
      out.postgres = `down: ${(e as Error).message}`;
      out.ok = false;
    }
  } else {
    out.postgres = 'not configured';
  }
  try {
    await getDb().execute(sql`SELECT 1`);
    out.mysql = 'up';
  } catch (e) {
    out.mysql = `down: ${(e as Error).message}`;
    if (!hasPg()) out.ok = false;
  }
  try {
    const r = await fetch(`${process.env.MEILI_HOST}/health`, { cache: 'no-store' });
    out.meilisearch = r.ok ? 'up' : `status ${r.status}`;
  } catch (e) {
    out.meilisearch = `down: ${(e as Error).message}`;
  }
  const gemini = hasGemini();
  const anthropic = !!process.env.ANTHROPIC_API_KEY;
  out.providers = {
    pipeline: gemini ? 'gemini' : anthropic ? 'anthropic' : 'curated',
    images_judge: gemini ? 'gemini' : 'heuristic',
    drawing: drawingProvider(),
    refine: gemini ? 'gemini' : 'off',
    ar: gemini ? 'gemini' : 'mock',
  };
  if (!gemini) out.unlock = 'GEMINI_API_KEY';
  const usage = usageSummary();
  out.llm = { budget: dailyBudget(), usage: { calls: usage.calls, failed: usage.failed, estUsd: usage.estUsd, priceBasis: usage.priceBasis } };
  return NextResponse.json(out, { status: out.ok ? 200 : 503 });
}
