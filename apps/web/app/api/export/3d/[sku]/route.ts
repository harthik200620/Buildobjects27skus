import type { Stats } from 'node:fs';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { type NextRequest, NextResponse } from 'next/server';
import { resolveStorageDir } from '@/lib/storage-root';

/**
 * Downloads one SKU's 3D asset: `/api/export/3d/{sku}?format=glb`. A real model at
 * assets/3d/{SKU}.glb wins over the generated placeholders/{SKU}.glb, matching `/3d/*`.
 *
 * Both path segments are attacker-controlled, so neither is interpolated into a filesystem path
 * before it is validated: the SKU against the code charset, the format against the table of
 * types we are willing to serve. An allowlist is used rather than a `..` check because there is
 * a known, closed set of formats — nothing else has a reason to be reachable here.
 */
export const dynamic = 'force-dynamic';

const ROOT = resolveStorageDir(process.env.ASSETS_3D_ROOT, './assets/3d');

const TYPES: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  usdz: 'model/vnd.usdz+zip',
  obj: 'model/obj',
  json: 'application/json',
};

/** SKU codes are upper-case alphanumerics and hyphens; see @buildobjects/catalog `skuCode`. */
const SKU_RE = /^[A-Z0-9-]{3,32}$/;

/** Errors are never cacheable: a model dropped into assets/3d a minute later must be picked up. */
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest, ctx: { params: Promise<{ sku: string }> }) {
  const { sku } = await ctx.params;
  const skuCode = sku.toUpperCase();
  const format = (req.nextUrl.searchParams.get('format') || 'glb').toLowerCase();

  if (!SKU_RE.test(skuCode)) return new NextResponse('bad sku', { status: 400, headers: NO_STORE });
  if (!Object.hasOwn(TYPES, format)) {
    return new NextResponse(`unsupported format — one of ${Object.keys(TYPES).join(', ')}`, { status: 400, headers: NO_STORE });
  }

  /*
   * The path is assembled from validated parts, but Turbopack cannot see that statically: left
   * alone it traces the whole project into the server bundle "just in case", which is how the
   * public folder ends up deployed as server code. The assets live outside the bundle and are
   * read at runtime, so the trace is opted out of here and at each fs call below.
   */
  const filename = `${skuCode}.${format}`;
  let file = path.join(/* turbopackIgnore: true */ ROOT, filename);
  // A real asset always wins; a generated placeholder is only ever a .glb.
  if (!existsSync(/* turbopackIgnore: true */ file) && format === 'glb') file = path.join(ROOT, 'placeholders', filename);

  let st: Stats;
  try {
    st = statSync(/* turbopackIgnore: true */ file);
  } catch {
    return new NextResponse('not found', { status: 404, headers: NO_STORE });
  }
  if (!st.isFile()) return new NextResponse('not found', { status: 404, headers: NO_STORE });

  return new NextResponse(Readable.toWeb(createReadStream(/* turbopackIgnore: true */ file)) as unknown as ReadableStream, {
    headers: {
      'Content-Type': TYPES[format],
      'Content-Length': String(st.size),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
