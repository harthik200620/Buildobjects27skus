import { getDb } from '@buildobjects/db';
import { dailyBudget, hasGemini, usageSummary } from '@buildobjects/llm';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { drawingProvider } from '@/lib/drawing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const out: Record<string, unknown> = { ok: true, time: new Date().toISOString() };
  try {
    await getDb().execute(sql`SELECT 1`);
    out.mysql = 'up';
  } catch (e) {
    out.mysql = `down: ${(e as Error).message}`;
    out.ok = false;
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
