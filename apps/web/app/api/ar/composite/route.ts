import type { CompositeRequest } from '@buildobjects/ar-engine';
import { type NextRequest, NextResponse } from 'next/server';
import { compositeLive, compositeMock, geminiLive } from '@/lib/ar-providers';

/** POST CompositeRequest → CompositeResult. The fidelity check runs on the client (it has the reference pixels); this just generates. */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const isImg = (v: unknown): v is { mimeType: string; base64: string } =>
  !!v && typeof (v as { base64?: unknown }).base64 === 'string' && typeof (v as { mimeType?: unknown }).mimeType === 'string';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as CompositeRequest | null;
  if (!body || !isImg(body.photo) || !isImg(body.overlay) || !isImg(body.mask) || !isImg(body.productReference) || !body.placement || !body.rule)
    return NextResponse.json({ error: 'photo, overlay, mask, productReference, placement and rule required' }, { status: 400 });
  const total = body.photo.base64.length + body.overlay.base64.length + body.mask.base64.length + body.productReference.base64.length;
  if (total > 40 * 1024 * 1024) return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  if (!geminiLive()) return NextResponse.json(compositeMock(body));
  try {
    return NextResponse.json(await compositeLive(body));
  } catch (e) {
    console.error('[ar/composite]', e);
    return NextResponse.json({
      ...compositeMock(body),
      note: `Generative step failed (${(e as Error).message.slice(0, 120)}) — showing the overlay composite instead.`,
    });
  }
}
