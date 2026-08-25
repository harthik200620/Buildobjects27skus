import { type NextRequest, NextResponse } from 'next/server';
import { loadCalculatorCatalog } from '@/lib/estimator';

/** GET /api/estimate/catalog?codes=A,B → the calculator's price snapshot incl. those SKUs (bounded: mapped SKUs + the codes asked for). */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const codes = (req.nextUrl.searchParams.get('codes') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 50);
  const catalog = await loadCalculatorCatalog(codes);
  return NextResponse.json(catalog, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
