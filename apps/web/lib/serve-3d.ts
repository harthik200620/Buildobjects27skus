import type { Stats } from 'node:fs';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { resolveStorageDir } from '@/lib/storage-root';

/**
 * The 3D asset root, and the one way a file leaves it.
 *
 * Two routes serve these bytes — `/3d/*` for the viewer and `/api/export/3d/{sku}` for a
 * download — and they had the same fourteen lines each: fall back to the placeholder, stat,
 * 404 twice over, stream with the same four headers. The callers still own what they alone
 * know, which is how the path is VALIDATED: a `..` check for a free-form path, an allowlist of
 * SKU codes and formats for the download. Nothing here validates anything, and it must not
 * start to — a helper that silently sanitises is a helper a caller stops checking.
 */
export const ASSETS_3D = resolveStorageDir(process.env.ASSETS_3D_ROOT, './assets/3d');

/** Errors are never cacheable: a model dropped into assets/3d a minute later must be picked up. */
export const NO_STORE = { 'Cache-Control': 'no-store' };

/** A bare `{SKU}.glb`, which is the only shape a generated placeholder is ever written under. */
const PLACEHOLDER_ELIGIBLE = /^[A-Z0-9-]+\.glb$/i;

/**
 * `rel` is already validated by the caller and relative to the asset root. `filename` turns the
 * response into a download.
 *
 * Turbopack cannot see statically that this path is safe: left alone it traces the whole project
 * into the server bundle "just in case", which is how a public folder ends up deployed as server
 * code. The assets live outside the bundle and are read at runtime, so the trace is opted out of
 * at each fs call.
 */
export function send3d(rel: string, type: string, filename?: string): NextResponse {
  /* A real asset always wins over the generated stand-in. */
  let abs = path.join(/* turbopackIgnore: true */ ASSETS_3D, rel);
  if (!existsSync(/* turbopackIgnore: true */ abs) && PLACEHOLDER_ELIGIBLE.test(rel)) abs = path.join(ASSETS_3D, 'placeholders', rel);

  let st: Stats;
  try {
    st = statSync(/* turbopackIgnore: true */ abs);
  } catch {
    return new NextResponse('not found', { status: 404, headers: NO_STORE });
  }
  if (!st.isFile()) return new NextResponse('not found', { status: 404, headers: NO_STORE });

  return new NextResponse(Readable.toWeb(createReadStream(/* turbopackIgnore: true */ abs)) as unknown as ReadableStream, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(st.size),
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
      ...(filename ? { 'Content-Disposition': `attachment; filename="${filename}"` } : {}),
    },
  });
}
