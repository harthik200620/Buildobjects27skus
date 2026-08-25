import type { Stats } from 'node:fs';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { type NextRequest, NextResponse } from 'next/server';
import { resolveStorageDir } from '@/lib/storage-root';

/**
 * Serves assets/3d at /3d/*. A real model at assets/3d/{SKU}.glb always wins over the
 * generated placeholders/{SKU}.glb — drop a file in, nothing else changes.
 * ASSETS_3D_ROOT is repo-root relative, not cwd relative.
 */
const ROOT = resolveStorageDir(process.env.ASSETS_3D_ROOT, './assets/3d');
/** Errors are never cacheable: a model dropped into assets/3d a minute later must be picked up. */
const NO_STORE = { 'Cache-Control': 'no-store' };
const TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.usdz': 'model/vnd.usdz+zip',
  '.json': 'application/json',
  '.md': 'text/markdown',
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string[] }> }) {
  const { file } = await ctx.params;
  const rel = file.join('/');
  if (rel.includes('..')) return new NextResponse('bad path', { status: 400, headers: NO_STORE });
  let abs = path.join(ROOT, rel);
  if (!existsSync(/* turbopackIgnore: true */ abs) && /^[A-Z0-9-]+\.glb$/i.test(rel)) abs = path.join(ROOT, 'placeholders', rel);
  let st: Stats;
  try {
    st = statSync(/* turbopackIgnore: true */ abs);
  } catch {
    return new NextResponse('not found', { status: 404, headers: NO_STORE });
  }
  if (!st.isFile()) return new NextResponse('not found', { status: 404, headers: NO_STORE });
  const type = TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  return new NextResponse(Readable.toWeb(createReadStream(/* turbopackIgnore: true */ abs)) as unknown as ReadableStream, {
    headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' },
  });
}
