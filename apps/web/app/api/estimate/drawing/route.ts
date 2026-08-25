import { type NextRequest, NextResponse } from 'next/server';
import { DRAWING_INLINE_MAX_BYTES, DRAWING_MAX_BYTES, DRAWING_TYPES, DrawingError, drawingProvider, readDrawing } from '@/lib/drawing';
import { clientIp, DRAWING_LIMIT, rateLimit, tooManyRequests } from '@/lib/rate-limit';

/**
 * POST multipart { file } → DrawingExtraction (a prefill suggestion — the wizard asks the user to confirm).
 * 400 no/invalid file · 415 unsupported type · 413 over 20 MB (or over 14 MB for the Gemini reader's
 * inline cap — export as an image) · 429 over 10 reads / 10 min / IP (Retry-After) · 502 reader failure.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Attach a floor plan, elevation or render (image or PDF)' }, { status: 400 });
  const mime = (file.type || '').toLowerCase();
  if (!(DRAWING_TYPES as readonly string[]).includes(mime))
    return NextResponse.json({ error: `Unsupported file type ${mime || '(unknown)'} — use JPEG, PNG, WebP, GIF or PDF` }, { status: 415 });
  if (file.size > DRAWING_MAX_BYTES) return NextResponse.json({ error: 'File is larger than 20 MB' }, { status: 413 });
  if (drawingProvider() === 'gemini' && file.size > DRAWING_INLINE_MAX_BYTES) {
    return NextResponse.json({ error: 'This file is over 14 MB — export the drawing as an image (PNG or JPEG) and upload that instead' }, { status: 413 });
  }
  const rl = rateLimit(`drawing:${clientIp(req)}`, DRAWING_LIMIT.limit, DRAWING_LIMIT.windowMs);
  if (!rl.ok)
    return tooManyRequests(
      `Drawing reads are limited to ${DRAWING_LIMIT.limit} per ${Math.round(DRAWING_LIMIT.windowMs / 60_000)} minutes — try again shortly`,
      rl.retryAfterMs,
    );
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const reading = await readDrawing({ bytes, mimeType: mime, name: file.name });
    return NextResponse.json(reading);
  } catch (e) {
    if (e instanceof DrawingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[drawing] read failed', e);
    return NextResponse.json({ error: (e as Error).message || 'Could not read the drawing' }, { status: 502 });
  }
}
