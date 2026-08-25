import { type NextRequest, NextResponse } from 'next/server';
import { listSkusKeyset } from '@/lib/catalog';

/** Keyset-paginated catalogue API: /api/skus?category=cement&after=0&limit=48 → { items, next }. Never OFFSET. */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const t0 = Date.now();
  const out = await listSkusKeyset({
    category: p.get('category') ?? undefined,
    after: Number(p.get('after') ?? 0) || 0,
    limit: Number(p.get('limit') ?? 48) || 48,
  });
  return NextResponse.json({ ...out, ms: Date.now() - t0 }, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300' } });
}
