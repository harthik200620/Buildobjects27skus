import { type NextRequest, NextResponse } from 'next/server';
import { suggest } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 120);
  if (q.trim().length < 1) return NextResponse.json({ skus: [], categories: [], brands: [], ms: 0 });
  const t0 = Date.now();
  const out = await suggest(q);
  return NextResponse.json({ ...out, ms: Date.now() - t0 }, { headers: { 'Cache-Control': 'private, max-age=30' } });
}
