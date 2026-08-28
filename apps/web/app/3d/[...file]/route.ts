import { type NextRequest, NextResponse } from 'next/server';
import { NO_STORE, send3d } from '@/lib/serve-3d';

/**
 * Serves assets/3d at /3d/*. A real model at assets/3d/{SKU}.glb always wins over the
 * generated placeholders/{SKU}.glb — drop a file in, nothing else changes.
 */
const TYPES: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  usdz: 'model/vnd.usdz+zip',
  json: 'application/json',
  md: 'text/markdown',
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string[] }> }) {
  const { file } = await ctx.params;
  const rel = file.join('/');
  /* The path is free-form here, so it is the caller's job to refuse a traversal. */
  if (rel.includes('..')) return new NextResponse('bad path', { status: 400, headers: NO_STORE });
  return send3d(rel, TYPES[rel.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream');
}
