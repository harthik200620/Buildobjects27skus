import { type NextRequest, NextResponse } from 'next/server';
import { QUOTE_MAX_BYTES, QUOTE_TYPES, QuoteError, quoteProvider, readQuote } from '@/lib/quote-reader';
import { clientIp, DRAWING_LIMIT, rateLimit, tooManyRequests } from '@/lib/rate-limit';

/**
 * POST multipart { file } → QuoteReading.
 *
 * A photographed or PDF contractor's quotation, read into typed lines. Everything the reader
 * returns is a READING — the comparison against the rate card happens in the estimator engine on
 * the client, and the interface shows both.
 *
 * 400 no/invalid file · 415 unsupported type · 413 over 14 MB · 422 nothing readable on the page
 * or not priced in rupees · 429 over 10 reads / 10 min / IP · 502 reader failure.
 *
 * NOTHING IS PERSISTED. A quotation is somebody's private commercial document; it is read in
 * memory, returned to the tab that asked, and forgotten. There is no store to write it to and
 * deliberately so.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Attach a photograph or PDF of the quotation' }, { status: 400 });

  const mime = (file.type || '').toLowerCase();
  if (!(QUOTE_TYPES as readonly string[]).includes(mime))
    return NextResponse.json({ error: `Cannot read ${mime || '(unknown)'} — send a JPEG, PNG, WebP or PDF` }, { status: 415 });
  if (file.size > QUOTE_MAX_BYTES) return NextResponse.json({ error: 'That file is over 14 MB — a photograph of the page is plenty' }, { status: 413 });

  /* Shares the drawing reader's budget: both are one expensive vision call per press. */
  const rl = rateLimit(`quote:${clientIp(req)}`, DRAWING_LIMIT.limit, DRAWING_LIMIT.windowMs);
  if (!rl.ok)
    return tooManyRequests(
      `Quote reads are limited to ${DRAWING_LIMIT.limit} per ${Math.round(DRAWING_LIMIT.windowMs / 60_000)} minutes — try again shortly`,
      rl.retryAfterMs,
    );

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const reading = await readQuote({ bytes, mimeType: mime, name: file.name });
    return NextResponse.json(reading);
  } catch (e) {
    if (e instanceof QuoteError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[quote] read failed', e);
    return NextResponse.json({ error: (e as Error).message || 'Could not read that quotation' }, { status: 502 });
  }
}

/** Which reader a press would use right now, so the interface can say so before anybody uploads. */
export async function GET() {
  return NextResponse.json({ provider: quoteProvider() });
}
