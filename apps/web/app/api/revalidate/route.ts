import { loadEnv } from '@buildobjects/db';
import { revalidatePath } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';

/* Reading the repo-root .env is not automatic: Next loads env files from `apps/web`, and the root
   one reaches a server route only because @buildobjects/db loads it at module scope. Every other
   route pulls that package in for its own reasons; this one has no database work to do, so it
   would have compared the caller's secret against `undefined` and refused every legitimate call.
   A deployment supplies real environment variables and never noticed — a laptop would have. */
loadEnv();

/**
 * Ingest webhook: the pipeline calls this after a run so ISR pages pick up new data at once.
 *
 * The guard used to read `if (SECRET && provided !== SECRET)`, which skipped itself entirely when
 * no secret was configured — so the deployment that most needed protecting was the one where
 * anybody could flush the whole cache on demand. A missing secret now closes the endpoint.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.SESSION_SECRET;
  const provided = req.headers.get('x-revalidate-secret') ?? req.nextUrl.searchParams.get('secret');
  if (!expected || provided !== expected) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const paths: string[] = Array.isArray(body.paths) ? body.paths : ['/'];
  for (const p of paths) revalidatePath(p);
  revalidatePath('/p/[sku]', 'page');
  revalidatePath('/c/[category]', 'page');
  return NextResponse.json({ ok: true, revalidated: paths.length + 2 });
}
