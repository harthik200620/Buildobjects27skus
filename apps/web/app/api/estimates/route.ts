import { type NextRequest, NextResponse } from 'next/server';
import { saveEstimate } from '@/lib/estimates-store';

/** POST { inputs } → { id, url }. Totals are recomputed server-side from the inputs — the client never submits money. */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('inputs' in body)) return NextResponse.json({ error: 'inputs required' }, { status: 400 });
  try {
    const saved = await saveEstimate((body as { inputs: unknown }).inputs);
    return NextResponse.json({ ...saved, url: `/estimate?e=${saved.id}` });
  } catch (e) {
    console.error('[estimates] save failed', e);
    return NextResponse.json({ error: 'Could not save the estimate right now' }, { status: 503 });
  }
}
