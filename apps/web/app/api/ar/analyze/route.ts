import { type NextRequest, NextResponse } from 'next/server';
import { analyzeSceneLive, geminiLive } from '@/lib/ar-providers';

/**
 * GET  → { live } — whether a vision model is configured.
 * POST { image: {mimeType, base64}, width, height, category } → SceneAnalysis (Gemini).
 * Without a key the client runs the deterministic luminance analyser itself and asks the
 * user for the room type — this route answers 503 so nothing ever pretends to be a model.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ live: geminiLive(), unlock: geminiLive() ? null : 'GEMINI_API_KEY' });
}

export async function POST(req: NextRequest) {
  if (!geminiLive()) return NextResponse.json({ error: 'No vision provider configured — set GEMINI_API_KEY', live: false }, { status: 503 });
  const body = (await req.json().catch(() => null)) as {
    image?: { mimeType: string; base64: string };
    width?: number;
    height?: number;
    category?: string;
  } | null;
  if (!body?.image?.base64 || !body.width || !body.height) return NextResponse.json({ error: 'image, width and height required' }, { status: 400 });
  if (body.image.base64.length > 12 * 1024 * 1024) return NextResponse.json({ error: 'image too large' }, { status: 413 });
  try {
    const analysis = await analyzeSceneLive(body.image, body.width, body.height, body.category ?? 'product');
    return NextResponse.json(analysis);
  } catch (e) {
    console.error('[ar/analyze]', e);
    return NextResponse.json({ error: (e as Error).message || 'scene analysis failed' }, { status: 502 });
  }
}
