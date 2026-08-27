/**
 * Get the shipped product meshes down to something a phone will load over mobile data.
 *
 * `compressGlb` next door has existed for a while and was written for the house renders. It was
 * never run over the product catalogue, and it shows: the twenty-one GLBs in assets/3d run six to
 * eleven and a half megabytes each, twenty of them over the two-megabyte budget. Broken down, a
 * single cement bag is 5.2 MB of JPEG texture and 292,000 vertices of geometry — raw generator
 * output that nobody trimmed.
 *
 * The cost of that is not abstract. `SceneRenderer.create` awaits the whole file before there is
 * anything to place, so on localhost the AR view sits empty for about four seconds and on a phone
 * on mobile data for a great deal longer — which is indistinguishable, from the outside, from the
 * feature being broken. It was in fact reported as the feature being broken.
 *
 * ── WHY IT WRITES IN PLACE ──────────────────────────────────────────────────────────────────
 * The GLBs are tracked, so the originals are one `git checkout` away and there is no reason for a
 * second copy of 180 MB on disk. Anything that fails to compress is left exactly as it was.
 *
 * ── WHY IT REFUSES TO MAKE THINGS WORSE ─────────────────────────────────────────────────────
 * Compression can lose: a mesh already small, or one whose textures are already WebP, can come out
 * bigger. The result is only written when it is genuinely smaller, so running this twice is safe
 * and running it on an already-optimised catalogue is a no-op rather than a slow degradation.
 *
 *   pnpm --filter @buildobjects/assets3d optimise            # every SKU
 *   pnpm --filter @buildobjects/assets3d optimise CEM-ULT-PPC50
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compressGlb } from './compress';

const DIR = path.resolve(process.cwd(), '../../assets/3d');

/**
 * Tighter than COMPRESS_DEFAULTS on triangles.
 *
 * A cement bag is a rounded cuboid and a fire extinguisher is a cylinder; neither needs sixty
 * thousand triangles, let alone the three hundred thousand vertices they arrived with. Twenty-four
 * thousand holds the silhouette on every one of these shapes at the size a phone renders them,
 * and it is the difference between three megabytes of geometry and a quarter of one.
 *
 * Textures stay at 1024: these are product surfaces read at arm's length, and this is where the
 * label on a cement bag stops being legible if you go lower.
 */
const OPTS = { maxTriangles: 24_000, maxTexturePx: 1024, textureQuality: 82 };

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

async function main() {
  const only = process.argv.slice(2).map((s) => s.toUpperCase());
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.glb')).filter((f) => !only.length || only.includes(f.replace('.glb', '').toUpperCase()));

  if (!files.length) {
    console.error(`No .glb matched in ${DIR}`);
    process.exitCode = 1;
    return;
  }

  let saved = 0;
  let over = 0;
  console.log(`${files.length} model(s) · budget 2 MB · ${OPTS.maxTriangles} tris · ${OPTS.maxTexturePx}px textures\n`);

  for (const file of files.sort()) {
    const full = path.join(DIR, file);
    const before = (await stat(full)).size;
    const sku = file.replace('.glb', '');
    try {
      const res = await compressGlb(await readFile(full), OPTS);
      const after = res.glb.length;
      if (after >= before) {
        console.log(`  ${sku.padEnd(30)} ${mb(before).padStart(8)} → unchanged (compression would not help)`);
        continue;
      }
      await writeFile(full, res.glb);
      saved += before - after;
      if (after > 2 * 1_048_576) over += 1;
      const pct = Math.round((1 - after / before) * 100);
      const flag = after > 2 * 1_048_576 ? '  STILL OVER BUDGET' : '';
      console.log(
        `  ${sku.padEnd(30)} ${mb(before).padStart(8)} → ${mb(after).padStart(8)}  (−${pct}%)  ${res.before.triangles} → ${res.after.triangles} tris${flag}`,
      );
      for (const w of res.warnings) console.log(`      ! ${w}`);
    } catch (e) {
      /* Left exactly as it was. A model this cannot read is a model to look at by hand, not one to
         replace with whatever a half-finished transform produced. */
      console.log(`  ${sku.padEnd(30)} FAILED — left untouched: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }

  console.log(`\n${mb(saved)} saved across the catalogue${over ? ` · ${over} still over the 2 MB budget` : ' · every model inside the 2 MB budget'}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
