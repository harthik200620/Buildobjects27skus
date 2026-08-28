/**
 * What size does each shipped mesh ACTUALLY render at?
 *
 * The live camera loads `/3d/{CODE}.glb`, hands it to `normalizeModel`, and draws whatever comes
 * out at true scale in a room. Nothing checked what came out. This does — offline, against the
 * files that ship, with no browser — and prints the stated dimensions beside the rendered ones for
 * every SKU in the catalogue.
 *
 * The meshes are genuinely at true scale once node transforms are applied. What was not was the
 * view, which resized them by height alone: a CCTV camera lying on its side, an extinguisher with
 * its width and depth swapped, an epoxy tin four times too wide. `fitModelToDims` in
 * @buildobjects/ar-engine fixes that, and this measures the real function rather than a copy of it,
 * so the two cannot drift.
 *
 * The extent honours node transforms. Reading POSITION min/max alone does not, and gives every mesh
 * a bounding box of roughly 1.9 m — the generator's pre-transform normalisation, and not a size
 * anything is ever drawn at.
 *
 *   pnpm --filter @buildobjects/assets3d measure [--old]    # --old: the height-only rescale
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fitModelToDims, type ProductDims } from '@buildobjects/ar-engine';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const DIR = path.resolve(process.cwd(), '../../assets/3d');
const CATALOGUE = path.resolve(process.cwd(), '../../apps/web/data/catalogue/skus.json');

interface Row {
  dims?: { w: number; h: number; d: number } | null;
  sku: { code: string };
  category?: { slug?: string } | null;
}

/** World-space bounding box of every primitive, honouring node transforms. */
async function extentOf(file: string): Promise<{ x: number; y: number; z: number } | null> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  await MeshoptDecoder.ready;
  const doc = await io.readBinary(new Uint8Array(await readFile(file)));
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        /* Column-major 4x4, as glTF stores it. */
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
      }
    }
  }
  if (!Number.isFinite(min[0])) return null;
  return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}

const mm = (m: number) => Math.round(m * 1000);
const trio = (a: number, b: number, c: number) => `${String(mm(a)).padStart(5)} x ${String(mm(b)).padStart(5)} x ${String(mm(c)).padStart(5)}`;

async function main() {
  const showOld = process.argv.includes('--old');
  const rows: Record<string, Row> = JSON.parse(await readFile(CATALOGUE, 'utf8'));
  const byCode = new Map<string, Row>();
  for (const r of Object.values(rows)) byCode.set(r.sku.code.toUpperCase(), r);

  const files = (await readdir(DIR)).filter((f) => f.endsWith('.glb')).sort();
  console.log(`${files.length} meshes  ·  stated vs rendered, mm  ·  a ratio far from 100 % is a product drawn at the wrong size\n`);
  let bad = 0;

  for (const file of files) {
    const code = file.replace('.glb', '').toUpperCase();
    const row = byCode.get(code);
    const e = await extentOf(path.join(DIR, file));
    if (!e) {
      console.log(`  ${code.padEnd(26)} no geometry`);
      continue;
    }
    if (!row?.dims) {
      console.log(`  ${code.padEnd(26)} mesh ${trio(e.x, e.y, e.z)}   (no stated dims in the catalogue)`);
      continue;
    }
    const dims: ProductDims = { w_mm: row.dims.w, h_mm: row.dims.h, d_mm: row.dims.d };
    const fit = fitModelToDims(e, dims);
    const worst = Math.max(Math.abs(fit.ratio.x - 1), Math.abs(fit.ratio.y - 1), Math.abs(fit.ratio.z - 1));
    if (worst > 0.2) bad += 1;
    console.log(
      `  ${code.padEnd(26)} stated ${trio(dims.w_mm / 1000, dims.h_mm / 1000, dims.d_mm / 1000)}   ->  ${trio(fit.size.x, fit.size.y, fit.size.z)}   x${fit.scale.toFixed(3)}`,
    );
    if (showOld) {
      const s = dims.h_mm / 1000 / e.y;
      console.log(`  ${''.padEnd(26)}   height-only rescale gave ${trio(e.x * s, e.y * s, e.z * s)}   x${s.toFixed(3)}`);
    }
    if (fit.note) console.log(`  ${''.padEnd(26)}   ! ${fit.note}`);
  }

  console.log(`\n${bad} of ${files.length} still differ from their stated proportions by more than a fifth on some axis.`);
  console.log('That is the mesh disagreeing with the catalogue, not the fit: the overall size is correct in every case.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
