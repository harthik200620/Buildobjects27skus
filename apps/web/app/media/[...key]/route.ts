import type { Stats } from 'node:fs';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { type NextRequest, NextResponse } from 'next/server';
import { resolveStorageDir } from '@/lib/storage-root';

/**
 * Serves MEDIA_ROOT at /media/* with immutable caching. Keys are content-derived, so the
 * cache never needs busting. On AWS this route is unused: MEDIA_BASE_URL points at CloudFront.
 * MEDIA_ROOT is repo-root relative (like the pipeline reads it), not cwd relative.
 */
const ROOT = resolveStorageDir(process.env.MEDIA_ROOT, './storage/media');
/** Errors are never cacheable: a file that is missing now may be written by the pipeline a minute later. */
const NO_STORE = { 'Cache-Control': 'no-store' };
const TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.usdz': 'model/vnd.usdz+zip',
  '.json': 'application/json',
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const rel = key.join('/');
  if (rel.includes('..')) return new NextResponse('bad key', { status: 400, headers: NO_STORE });
  const file = path.join(ROOT, rel);
  let st: Stats;
  try {
    st = statSync(/* turbopackIgnore: true */ file);
  } catch {
    return new NextResponse('not found', { status: 404, headers: NO_STORE });
  }
  if (!st.isFile()) return new NextResponse('not found', { status: 404, headers: NO_STORE });
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const stream = Readable.toWeb(createReadStream(/* turbopackIgnore: true */ file)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(st.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
    },
  });
}
