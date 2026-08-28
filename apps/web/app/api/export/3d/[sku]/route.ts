import { type NextRequest, NextResponse } from 'next/server';
import { NO_STORE, send3d } from '@/lib/serve-3d';

/**
 * Downloads one SKU's 3D asset: `/api/export/3d/{sku}?format=glb`.
 *
 * Both path segments are attacker-controlled, so neither is interpolated into a filesystem path
 * before it is validated: the SKU against the code charset, the format against the table of types
 * we are willing to serve. An allowlist rather than a `..` check, because there is a known, closed
 * set of formats — nothing else has a reason to be reachable here.
 */
export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  usdz: 'model/vnd.usdz+zip',
  obj: 'model/obj',
  json: 'application/json',
};

/** SKU codes are upper-case alphanumerics and hyphens; see @buildobjects/catalog `skuCode`. */
const SKU_RE = /^[A-Z0-9-]{3,32}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ sku: string }> }) {
  const { sku } = await ctx.params;
  const skuCode = sku.toUpperCase();
  const format = (req.nextUrl.searchParams.get('format') || 'glb').toLowerCase();

  if (!SKU_RE.test(skuCode)) return new NextResponse('bad sku', { status: 400, headers: NO_STORE });
  if (!Object.hasOwn(TYPES, format)) {
    return new NextResponse(`unsupported format — one of ${Object.keys(TYPES).join(', ')}`, { status: 400, headers: NO_STORE });
  }

  const filename = `${skuCode}.${format}`;
  return send3d(filename, TYPES[format], filename);
}
