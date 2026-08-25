/**
 * Normalise a provider GLB into the store's convention: metres, Y up, base at y = 0, centred on
 * x / z, front facing +Z, at the SKU's real dimensions, ≤ 100k triangles, textures ≤ 2048 px,
 * no animations / cameras, ≤ 12 MB.
 *
 * Order: read → strip → dequantize / dedup / prune / weld → simplify (meshoptimizer) → bounds →
 * axis permutation best matching (w, h, d) (Y↔Z fix) → scale the major axis to the spec →
 * aspect check (warn > 15 %, reject > 35 %) → front check (CPU silhouette rasteriser vs the hero
 * cut-out over 4 yaws) → re-centre, base y = 0 → texture compression (sharp) → size check.
 */
import { type Document, type mat4, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, dequantize, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp, { type Metadata as SharpMetadata } from 'sharp';
import type { Dims } from '../builders';
import { alphaBbox } from '../textures';
import { compressGlb } from './compress';

type V3 = [number, number, number];

export interface NormaliseOptions {
  /** Target size in metres (w → x, h → y, d → z). */
  dims: Dims;
  /** RGBA PNG of the photographed front; enables the front check. */
  heroCutout?: Buffer | null;
  maxTriangles?: number;
  maxTexturePx?: number;
  sizeWarnMb?: number;
  sizeRejectMb?: number;
  aspectWarn?: number;
  aspectReject?: number;
  yawCandidates?: number[];
}
export interface NormaliseResult {
  glb: Buffer | null;
  rejected: string | null;
  warnings: string[];
  axis_map: string;
  front_yaw_deg: number;
  scale: number;
  bbox_m: { x: number; y: number; z: number };
  triangles: number;
  textures: { count: number; max_px: number };
  silhouette_iou: number | null;
  iou_by_yaw: Record<string, number> | null;
  aspect_mismatch: number;
  size_mb: number;
}

/**
 * A product is a "sheet" when its thinnest dimension is under this fraction of its longest:
 * glass at 0.003, a solar module at 0.013, a tile at 0.011, against a cement bag at 0.4 and a
 * bulb at 0.9. Nothing in the catalogue sits near the boundary.
 */
export const FLAT_RATIO = 0.06;

export const DEFAULTS = {
  maxTriangles: 100_000,
  maxTexturePx: 2048,
  sizeWarnMb: 8,
  sizeRejectMb: 12,
  aspectWarn: 0.15,
  aspectReject: 0.85,
  /* Below this, the mesh's outline disagrees with its own source photograph. See the front
     check for the distribution this was set against. */
  iouReject: 0.2,
  yawCandidates: [0, 90, 180, 270],
};

/** Proper rotations (det +1) covering every axis permutation; `m` is row-major 3 × 3, target = m · source. */
export const AXIS_PERMUTATIONS: { name: string; m: number[] }[] = [
  { name: 'x,y,z', m: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
  { name: 'x,z,-y', m: [1, 0, 0, 0, 0, 1, 0, -1, 0] }, // Z-up → Y-up (rotate −90° about X)
  { name: 'z,y,-x', m: [0, 0, 1, 0, 1, 0, -1, 0, 0] }, // yaw 90°
  { name: '-y,z,-x', m: [0, -1, 0, 0, 0, 1, -1, 0, 0] },
  { name: '-y,x,z', m: [0, -1, 0, 1, 0, 0, 0, 0, 1] }, // X-up → Y-up
  { name: 'z,x,y', m: [0, 0, 1, 1, 0, 0, 0, 1, 0] },
];

export interface TriSoup {
  positions: Float32Array;
  indices: Uint32Array;
  count: number;
}

let ioPromise: Promise<NodeIO> | null = null;
/** A NodeIO with every KHR/EXT extension registered and the meshopt decoder (Draco is not bundled: such files are rejected with a clear reason). */
export function gltfIO(): Promise<NodeIO> {
  if (!ioPromise)
    ioPromise = (async () => {
      await MeshoptDecoder.ready;
      return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    })();
  return ioPromise;
}

const mulMat4Vec3 = (m: mat4 | number[], x: number, y: number, z: number): V3 => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/** World-space triangle soup of every TRIANGLES primitive in every scene. */
export function collectTriangles(doc: Document): TriSoup {
  const pos: number[] = [],
    idx: number[] = [];
  const tmp: number[] = [0, 0, 0];
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const wm = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
        const p = prim.getAttribute('POSITION');
        if (!p) continue;
        const base = pos.length / 3,
          n = p.getCount();
        for (let i = 0; i < n; i++) {
          p.getElement(i, tmp);
          pos.push(...mulMat4Vec3(wm, tmp[0], tmp[1], tmp[2]));
        }
        const ind = prim.getIndices();
        if (ind) {
          const c = ind.getCount();
          for (let i = 0; i < c; i++) idx.push(base + ind.getScalar(i));
        } else for (let i = 0; i < n; i++) idx.push(base + i);
      }
    });
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), count: Math.floor(idx.length / 3) };
}

export function extents(positions: Float32Array): { min: V3; max: V3; size: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity],
    max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

export function applyMat3(positions: Float32Array, m: number[]): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z;
    out[i + 1] = m[3] * x + m[4] * y + m[5] * z;
    out[i + 2] = m[6] * x + m[7] * y + m[8] * z;
  }
  return out;
}
const mulMat3 = (a: number[], b: number[]): number[] => {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
export const yawMat3 = (deg: number): number[] => {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};

/**
 * The permutation whose (|m| · extents) best matches the target proportions under one uniform
 * scale — least-squares in log space so a 6 mm pane and a 2 m module weigh the same. Ties keep
 * the earlier (identity first) candidate.
 */
export function chooseAxisPermutation(size: V3, target: V3): { index: number; name: string; m: number[]; permuted: V3; score: number } {
  const EPS = 1e-6;
  let best = { index: 0, name: AXIS_PERMUTATIONS[0].name, m: AXIS_PERMUTATIONS[0].m, permuted: size, score: Infinity };
  AXIS_PERMUTATIONS.forEach((p, index) => {
    const permuted: V3 = [0, 0, 0];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) permuted[r] += Math.abs(p.m[r * 3 + c]) * size[c];
    const logs = [0, 1, 2].map((k) => Math.log(Math.max(target[k], EPS)) - Math.log(Math.max(permuted[k], EPS)));
    const mean = (logs[0] + logs[1] + logs[2]) / 3;
    const score = logs.reduce((s, l) => s + (l - mean) * (l - mean), 0);
    if (score < best.score - 1e-9) best = { index, name: p.name, m: p.m, permuted, score };
  });
  return best;
}

/** Fit a (bw × bh) box into `size` px with a 1 px margin, aspect preserved, centred. */
function fit(bw: number, bh: number, size: number) {
  const s = (size - 2) / Math.max(bw, bh, 1e-9);
  return { s, ox: (size - bw * s) / 2, oy: (size - bh * s) / 2 };
}

/**
 * Orthographic silhouette seen from +Z after rotating the model by `yawDeg` about +Y: screen
 * x = world x, screen y = world y (row 0 at the top), bbox-normalised into a size² bitmap.
 */
export function rasteriseSilhouette(soup: TriSoup, yawDeg: number, size = 128): Uint8Array {
  const bits = new Uint8Array(size * size);
  const n = soup.positions.length / 3;
  if (!n) return bits;
  const a = (yawDeg * Math.PI) / 180,
    cs = Math.cos(a),
    sn = Math.sin(a);
  const sx = new Float32Array(n),
    sy = new Float32Array(n);
  let minx = Infinity,
    maxx = -Infinity,
    miny = Infinity,
    maxy = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = soup.positions[i * 3],
      y = soup.positions[i * 3 + 1],
      z = soup.positions[i * 3 + 2];
    const xr = x * cs + z * sn;
    sx[i] = xr;
    sy[i] = y;
    if (xr < minx) minx = xr;
    if (xr > maxx) maxx = xr;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  const { s, ox, oy } = fit(maxx - minx, maxy - miny, size);
  const px = (i: number) => ox + (sx[i] - minx) * s,
    py = (i: number) => oy + (maxy - sy[i]) * s;
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) bits[y * size + x] = 1;
  };
  for (let t = 0; t < soup.count; t++) {
    const i0 = soup.indices[t * 3],
      i1 = soup.indices[t * 3 + 1],
      i2 = soup.indices[t * 3 + 2];
    const ax = px(i0),
      ay = py(i0),
      bx = px(i1),
      by = py(i1),
      cx = px(i2),
      cy = py(i2);
    mark(Math.floor(ax), Math.floor(ay));
    mark(Math.floor(bx), Math.floor(by));
    mark(Math.floor(cx), Math.floor(cy));
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
      x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))),
      y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5,
          qy = y + 0.5;
        const w0 = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
        const w1 = (cx - bx) * (qy - by) - (cy - by) * (qx - bx);
        const w2 = (ax - cx) * (qy - cy) - (ay - cy) * (qx - cx);
        if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) bits[y * size + x] = 1;
      }
  }
  return bits;
}

export function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0,
    union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] | b[i];
    union += x;
    inter += a[i] & b[i];
  }
  return union ? inter / union : 0;
}

/** The cut-out's alpha > 127, cropped to its bounding box and fitted the same way as the model silhouette. `fill` = covered share of that box. */
export async function cutoutMask(png: Buffer, size = 128): Promise<{ bits: Uint8Array; fill: number } | null> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bb = alphaBbox(data, info.width, info.height, 127);
  if (!bb) return null;
  const bw = bb.x1 - bb.x0 + 1,
    bh = bb.y1 - bb.y0 + 1;
  const { s, ox, oy } = fit(bw, bh, size);
  const bits = new Uint8Array(size * size);
  let covered = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const col = bb.x0 + Math.floor((x + 0.5 - ox) / s),
        row = bb.y0 + Math.floor((y + 0.5 - oy) / s);
      if (col < bb.x0 || col > bb.x1 || row < bb.y0 || row > bb.y1) continue;
      if (data[(row * info.width + col) * 4 + 3] > 127) {
        bits[y * size + x] = 1;
        covered++;
      }
    }
  const boxPx = Math.round(bw * s) * Math.round(bh * s);
  return { bits, fill: boxPx ? covered / boxPx : 1 };
}

/** Best of the candidate yaws by IoU; a yaw only beats 0° when it wins by more than `margin`. */
export function bestYaw(
  soup: TriSoup,
  mask: Uint8Array,
  yaws = DEFAULTS.yawCandidates,
  margin = 0.02,
  size = 128,
): { yaw: number; best: number; byYaw: Record<string, number> } {
  const byYaw: Record<string, number> = {};
  for (const y of yaws) byYaw[String(y)] = iou(rasteriseSilhouette(soup, y, size), mask);
  let yaw = 0,
    best = byYaw['0'] ?? -1;
  for (const y of yaws)
    if (byYaw[String(y)] > best + margin) {
      yaw = y;
      best = byYaw[String(y)];
    }
  return { yaw, best, byYaw };
}

/** Resize every texture to ≤ maxPx; PNG stays PNG only when it has alpha, everything else becomes JPEG q85. */
export async function compressTextures(doc: Document, maxPx: number): Promise<{ count: number; max_px: number; warnings: string[] }> {
  const warnings: string[] = [];
  let count = 0,
    maxSeen = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const mime = tex.getMimeType();
    if (mime && !/^image\/(png|jpeg|webp)$/.test(mime)) {
      warnings.push(`texture "${tex.getName() || count}" left as ${mime}`);
      count++;
      continue;
    }
    let meta: SharpMetadata;
    try {
      meta = await sharp(img).metadata();
    } catch {
      warnings.push(`texture "${tex.getName() || count}" unreadable — left as is`);
      count++;
      continue;
    }
    const w = meta.width ?? 0,
      h = meta.height ?? 0;
    let isOpaque = true;
    if (meta.hasAlpha) {
      try {
        const stats = await sharp(img).stats();
        isOpaque = stats.isOpaque;
      } catch {
        isOpaque = false;
      }
    }
    const wantPng = !isOpaque;
    const needs = Math.max(w, h) > maxPx || (wantPng ? mime !== 'image/png' : mime !== 'image/jpeg');
    if (needs) {
      let p = sharp(img).resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true });
      p = wantPng ? p.png({ compressionLevel: 8 }) : p.jpeg({ quality: 85, mozjpeg: true });
      const { data, info } = await p.toBuffer({ resolveWithObject: true });
      tex.setImage(new Uint8Array(data)).setMimeType(wantPng ? 'image/png' : 'image/jpeg');
      maxSeen = Math.max(maxSeen, info.width, info.height);
    } else maxSeen = Math.max(maxSeen, w, h);
    count++;
  }
  return { count, max_px: maxSeen, warnings };
}

export function countTriangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
      const ind = prim.getIndices();
      n += Math.floor((ind ? ind.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0)) / 3);
    }
  return n;
}

export async function normaliseGlb(glb: Buffer, opts: NormaliseOptions): Promise<NormaliseResult> {
  const o = { ...DEFAULTS, ...opts };
  const warnings: string[] = [];
  const fail = (reason: string, partial: Partial<NormaliseResult> = {}): NormaliseResult => ({
    glb: null,
    rejected: reason,
    warnings,
    axis_map: 'x,y,z',
    front_yaw_deg: 0,
    scale: 1,
    bbox_m: { x: 0, y: 0, z: 0 },
    triangles: 0,
    textures: { count: 0, max_px: 0 },
    silhouette_iou: null,
    iou_by_yaw: null,
    aspect_mismatch: 0,
    size_mb: glb.length / 1048576,
    ...partial,
  });
  const io = await gltfIO();
  let doc: Document;
  try {
    doc = await io.readBinary(new Uint8Array(glb));
  } catch (e) {
    return fail(`unreadable GLB: ${(e as Error).message}`);
  }

  // strip what AR never plays
  const root = doc.getRoot();
  for (const a of root.listAnimations()) a.dispose();
  for (const c of root.listCameras()) c.dispose();
  try {
    await doc.transform(dequantize(), dedup(), prune(), weld());
  } catch (e) {
    return fail(`cleanup failed: ${(e as Error).message}`);
  }

  let triangles = countTriangles(doc);
  if (triangles > o.maxTriangles) {
    await MeshoptSimplifier.ready;
    const before = triangles;
    try {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: (o.maxTriangles / triangles) * 0.98, error: 0.001 }), prune());
    } catch (e) {
      warnings.push(`simplify failed: ${(e as Error).message}`);
    }
    triangles = countTriangles(doc);
    warnings.push(`simplified ${before.toLocaleString()} → ${triangles.toLocaleString()} triangles`);
    if (triangles > o.maxTriangles * 1.1)
      warnings.push(`still ${triangles.toLocaleString()} triangles after simplify (budget ${o.maxTriangles.toLocaleString()})`);
  }

  const soup = collectTriangles(doc);
  if (!soup.count) return fail('no triangle geometry');
  const raw = extents(soup.positions);
  if (Math.max(...raw.size) < 1e-9) return fail('degenerate geometry (zero extent)');

  // axis permutation + uniform scale on the major axis
  const target: V3 = [o.dims.w, o.dims.h, o.dims.d];
  const perm = chooseAxisPermutation(raw.size, target);
  const major = target.indexOf(Math.max(...target));
  const scale = target[major] / Math.max(perm.permuted[major], 1e-9);

  /*
   * Sheet products get their thin axis scaled to spec instead of uniformly.
   *
   * A pane of 5 mm float glass is 1200 × 1800 × 5 mm — the thickness is 0.3 % of the height.
   * Image-to-3D cannot produce that from a photograph and never will: it reconstructs a slab a
   * few centimetres thick, and under a single uniform scale that thickness lands ~600 % away
   * from spec, so the aspect gate rejected it. Three glass SKUs, two solar modules and two tiles
   * failed this way — every genuinely flat product in the catalogue.
   *
   * Rejecting them is the wrong call, because the mesh is not wrong: a sheet IS a thin box, and
   * compressing the depth axis to the real thickness is what normalising a sheet means. The two
   * faces a buyer ever sees are untouched. So when the spec itself says "this is a sheet" — the
   * smallest dimension under FLAT_RATIO of the largest — that axis is scaled independently and
   * excluded from the aspect check, which still guards the other two.
   */
  const minT = Math.min(...target);
  const flatAxis = minT / Math.max(...target) < FLAT_RATIO ? target.indexOf(minT) : -1;
  const flatScale = flatAxis >= 0 ? target[flatAxis] / Math.max(perm.permuted[flatAxis], 1e-9) : scale;
  if (flatAxis >= 0) {
    warnings.push(
      `sheet product: ${'xyz'[flatAxis]} scaled to ${Math.round(target[flatAxis] * 1000)} mm independently (${(perm.permuted[flatAxis] * scale * 1000).toFixed(0)} mm under a uniform scale)`,
    );
  }

  let aspect = 0;
  for (let k = 0; k < 3; k++) {
    if (k === major || k === flatAxis) continue;
    const got = perm.permuted[k] * scale;
    aspect = Math.max(aspect, Math.abs(got - target[k]) / Math.max(target[k], 0.1 * target[major]));
  }
  const pct = Math.round(aspect * 100);
  if (aspect > o.aspectReject)
    return fail(`aspect mismatch ${pct} % vs spec ${target.map((v) => Math.round(v * 1000)).join('×')} mm (reject > ${Math.round(o.aspectReject * 100)} %)`, {
      axis_map: perm.name,
      scale,
      aspect_mismatch: aspect,
      triangles,
    });
  if (aspect > o.aspectWarn) warnings.push(`aspect mismatch ${pct} % vs spec (warn > ${Math.round(o.aspectWarn * 100)} %)`);

  // front check against the hero cut-out
  const permuted: TriSoup = { positions: applyMat3(soup.positions, perm.m), indices: soup.indices, count: soup.count };
  let yaw = 0,
    best: number | null = null,
    byYaw: Record<string, number> | null = null;
  if (o.heroCutout) {
    const mask = await cutoutMask(o.heroCutout).catch(() => null);
    if (!mask) warnings.push('front check skipped: hero cut-out has no alpha');
    else if (mask.fill > 0.97) warnings.push('front check skipped: hero cut-out is a full rectangle (no silhouette)');
    else {
      const r = bestYaw(permuted, mask.bits, o.yawCandidates);
      yaw = r.yaw;
      best = r.best;
      byYaw = r.byYaw;
      /*
       * The silhouette check is the one measurement that asks "is this a model OF this product",
       * and it was only ever a warning. Across the catalogue the good meshes score 0.68–0.95 and
       * the borderline ones 0.49–0.55; the Kajaria tile scored 0.06 and shipped as a warped sheet
       * that looks nothing like a tile. Below `iouReject` the outline does not match the very
       * photograph the mesh was built from, which is not a near miss — it is a different object,
       * and the parametric placeholder at true dimensions is the better answer.
       */
      if (best < o.iouReject)
        return fail(`silhouette IoU ${best.toFixed(2)} at ${yaw}° — the mesh does not match the product photo (reject < ${o.iouReject})`, {
          axis_map: perm.name,
          front_yaw_deg: yaw,
          scale,
          triangles,
          silhouette_iou: best,
          iou_by_yaw: r.byYaw,
        });
      if (best < 0.5) warnings.push(`front uncertain: best silhouette IoU ${best.toFixed(2)} at ${yaw}°`);
    }
  } else warnings.push('front check skipped: no hero cut-out');

  // compose R = yaw · perm, S, T (base at y = 0, centred on x / z) and wrap every scene under one node
  const R = mulMat3(yawMat3(yaw), perm.m);
  /*
   * Scale per OUTPUT axis, not uniformly. `R` is row-major with target = R · source, so scaling
   * row k scales target axis k — which is what makes the sheet case correct whichever source
   * axis the permutation and the yaw happen to route into the thin one.
   */
  const axisScale: V3 = [scale, scale, scale];
  if (flatAxis >= 0) axisScale[flatAxis] = flatScale;
  const rs = R.map((v, i) => v * axisScale[Math.floor(i / 3)]);
  const placed = applyMat3(soup.positions, rs);
  const pb = extents(placed);
  const t: V3 = [-(pb.min[0] + pb.max[0]) / 2, -pb.min[1], -(pb.min[2] + pb.max[2]) / 2];
  const M = [rs[0], rs[3], rs[6], 0, rs[1], rs[4], rs[7], 0, rs[2], rs[5], rs[8], 0, t[0], t[1], t[2], 1] as unknown as mat4;
  for (const scene of root.listScenes()) {
    const wrap = doc.createNode('bo-normalised');
    for (const child of scene.listChildren()) {
      scene.removeChild(child);
      wrap.addChild(child);
    }
    wrap.setMatrix(M);
    scene.addChild(wrap);
  }

  const tex = await compressTextures(doc, o.maxTexturePx);
  warnings.push(...tex.warnings);

  let out: Uint8Array;
  try {
    out = await io.writeBinary(doc);
  } catch (e) {
    return fail(`write failed: ${(e as Error).message}`, { axis_map: perm.name, front_yaw_deg: yaw, scale, triangles });
  }
  let size_mb = out.byteLength / 1048576;

  /*
   * Too heavy is not the same as wrong.
   *
   * A mesh that is geometrically correct and 14.5 MB was being rejected outright, which threw
   * away a good model over a number that a second pass can change. So an oversized result gets
   * one round of `compressGlb` — decimate to the triangle budget, re-encode the textures — and is
   * only refused if it is STILL over after that. The first glass pane this applied to went from
   * 14.5 MB to comfortably inside the budget with no visible difference at the size it is drawn.
   */
  if (size_mb > o.sizeRejectMb) {
    try {
      const squeezed = await compressGlb(Buffer.from(out), { maxTriangles: o.maxTriangles, maxTexturePx: o.maxTexturePx });
      warnings.push(
        `${size_mb.toFixed(1)} MB over the ${o.sizeRejectMb} MB budget → compressed to ${(squeezed.after.bytes / 1048576).toFixed(1)} MB (${squeezed.after.triangles.toLocaleString()} triangles)`,
      );
      out = new Uint8Array(squeezed.glb);
      size_mb = out.byteLength / 1048576;
    } catch (e) {
      warnings.push(`compression failed: ${(e as Error).message}`);
    }
  }
  const base: NormaliseResult = {
    glb: Buffer.from(out.buffer, out.byteOffset, out.byteLength),
    rejected: null,
    warnings,
    axis_map: perm.name,
    front_yaw_deg: yaw,
    scale,
    bbox_m: { x: pb.size[0], y: pb.size[1], z: pb.size[2] },
    triangles,
    textures: { count: tex.count, max_px: tex.max_px },
    silhouette_iou: best,
    iou_by_yaw: byYaw,
    aspect_mismatch: aspect,
    size_mb,
  };
  if (size_mb > o.sizeRejectMb) return { ...base, glb: null, rejected: `GLB is ${size_mb.toFixed(1)} MB (reject > ${o.sizeRejectMb} MB)` };
  if (size_mb > o.sizeWarnMb) warnings.push(`GLB is ${size_mb.toFixed(1)} MB (warn > ${o.sizeWarnMb} MB)`);
  return base;
}
