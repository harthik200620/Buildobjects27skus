import { type NextRequest, NextResponse } from 'next/server';
import { loadSavedEstimate } from '@/lib/estimates-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await loadSavedEstimate(id);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(row, { headers: { 'Cache-Control': 'public, max-age=300, immutable' } });
}
