import { type Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, dequantize, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/**
 * Get a GLB down to something a browser will actually load.
 *
 * `normaliseGlb` next door does a different job: it takes a product mesh whose real-world
 * dimensions are known and forces it to them — axis permutation, scale, front-facing yaw,
 * silhouette check against the photograph. All of that needs a spec to normalise *to*.
 *
 * A house has no spec. It is whatever Meshy made of the render, and the only thing wrong with it
 * is the weight: the first one came back at 19 MB — 138k triangles and 11 MB of uncompressed PNG
 * and JPEG textures. Fifteen of those is 285 MB of models behind one page. So this trims rather
 * than normalises: weld, prune, decimate to a triangle budget, and re-encode every texture as
 * WebP at a sane resolution.
 */

export interface CompressOptions {
  maxTriangles?: number;
  /** Longest edge of any texture, in pixels. */
  maxTexturePx?: number;
  /** WebP quality for re-encoded textures. */
  textureQuality?: number;
}

export const COMPRESS_DEFAULTS = {
  maxTriangles: 60_000,
  maxTexturePx: 1024,
  textureQuality: 82,
} satisfies Required<CompressOptions>;

export interface CompressResult {
  glb: Buffer;
  before: { bytes: number; triangles: number };
  after: { bytes: number; triangles: number; textures: number; maxTexturePx: number };
  warnings: string[];
}

function countTriangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      n += idx ? idx.getCount() / 3 : (pos?.getCount() ?? 0) / 3;
    }
  }
  return Math.round(n);
}

export async function compressGlb(glb: Buffer, opts: CompressOptions = {}): Promise<CompressResult> {
  const o = { ...COMPRESS_DEFAULTS, ...opts };
  const warnings: string[] = [];
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(glb));
  const before = { bytes: glb.length, triangles: countTriangles(doc) };

  await doc.transform(dequantize(), dedup(), prune(), weld());

  const tris = countTriangles(doc);
  if (tris > o.maxTriangles) {
    try {
      await MeshoptSimplifier.ready;
      // 0.98 of the exact ratio: the simplifier overshoots slightly and a second pass is worse
      // than landing just under budget.
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: (o.maxTriangles / tris) * 0.98, error: 0.002 }), prune());
    } catch (e) {
      warnings.push(`simplify failed: ${(e as Error).message}`);
    }
  }

  /*
   * Textures are the bulk of it — 11 MB of the first 19 MB house. A 4096 px PNG of a facade is
   * indistinguishable from a 1024 px WebP of the same facade at the size this is ever drawn.
   */
  try {
    await doc.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: [o.maxTexturePx, o.maxTexturePx],
        quality: o.textureQuality,
      }),
    );
  } catch (e) {
    warnings.push(`texture compression failed: ${(e as Error).message}`);
  }

  const out = Buffer.from(await io.writeBinary(doc));
  const textures = doc.getRoot().listTextures();
  let maxPx = 0;
  for (const t of textures) {
    const size = t.getSize();
    if (size) maxPx = Math.max(maxPx, size[0], size[1]);
  }
  return {
    glb: out,
    before,
    after: { bytes: out.length, triangles: countTriangles(doc), textures: textures.length, maxTexturePx: maxPx },
    warnings,
  };
}
