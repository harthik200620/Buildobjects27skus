import { revalidatePath } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';

/** Ingest webhook: the pipeline calls this after a run so ISR pages pick up new data at once. */
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-revalidate-secret') ?? req.nextUrl.searchParams.get('secret');
  if ((process.env.SESSION_SECRET ?? '') && secret !== process.env.SESSION_SECRET) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const paths: string[] = Array.isArray(body.paths) ? body.paths : ['/'];
  for (const p of paths) revalidatePath(p);
  revalidatePath('/p/[sku]', 'page');
  revalidatePath('/c/[category]', 'page');
  return NextResponse.json({ ok: true, revalidated: paths.length + 2 });
}
