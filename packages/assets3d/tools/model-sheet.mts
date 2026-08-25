/**
 * `npx tsx packages/assets3d/tools/model-sheet.mts [out.png]`
 *
 * One picture of every 3D model in the catalogue.
 *
 * Rendering the GLBs here would need a GL context, and headless GL on Windows is a yak worth
 * skipping when the provider already rendered each mesh to check its own work: `previewUrl` in
 * assets/3d/jobs.json is Meshy's turntable frame of the exact model that was downloaded. That is
 * a render of the shipped geometry, not of the photograph it came from, so a mesh that came back
 * as a bracket or a smear is visible here rather than a surprise on a product page.
 *
 * Placeholder SKUs are included deliberately, marked, so the sheet answers "what does the
 * catalogue look like in 3D" rather than "what worked".
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ASSETS_DIR } from '../src/build';

interface Job {
  sku: string;
  state: string;
  previewUrl?: string | null;
  outputFile?: string | null;
}

const TILE = 260;
const COLS = 6;
const LABEL_H = 22;
const BG = { r: 6, g: 24, b: 29, alpha: 1 };

async function main() {
  const out = process.argv[2] ?? path.join(ASSETS_DIR, 'model-sheet.png');
  const jobs = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'jobs.json'), 'utf8')) as { jobs: Record<string, Job> };
  const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'manifest.json'), 'utf8')) as {
    assets: Record<string, { placeholder?: boolean; triangles?: number }>;
  };

  const skus = Object.keys(manifest.assets).sort();
  const tiles: { input: Buffer; top: number; left: number }[] = [];
  let ok = 0;
  let missing = 0;

  for (const [i, sku] of skus.entries()) {
    const row = (i / COLS) | 0;
    const col = i % COLS;
    const asset = manifest.assets[sku];
    const job = jobs.jobs[sku];
    const real = !asset.placeholder;

    let img: Buffer | null = null;
    if (real && job?.previewUrl) {
      try {
        const res = await fetch(job.previewUrl);
        if (res.ok) img = Buffer.from(await res.arrayBuffer());
      } catch {
        img = null;
      }
    }

    if (img) {
      ok += 1;
      tiles.push({
        input: await sharp(img)
          .flatten({ background: BG })
          .resize(TILE - 6, TILE - 6, { fit: 'contain', background: BG })
          .png()
          .toBuffer(),
        top: row * (TILE + LABEL_H) + 3,
        left: col * TILE + 3,
      });
    } else {
      missing += 1;
      const why = real ? 'no preview' : 'parametric placeholder';
      tiles.push({
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE - 6}" height="${TILE - 6}">
             <rect width="100%" height="100%" fill="#0a2229" stroke="#1e4a55" stroke-dasharray="5 5"/>
             <text x="50%" y="50%" font-family="Arial" font-size="13" fill="#9bb1b5" text-anchor="middle">${why}</text>
           </svg>`,
        ),
        top: row * (TILE + LABEL_H) + 3,
        left: col * TILE + 3,
      });
    }

    const tris = asset.triangles ? `${(asset.triangles / 1000).toFixed(0)}k tris` : '';
    tiles.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${LABEL_H}">
           <text x="4" y="15" font-family="Arial" font-size="11" fill="${real ? '#eaf2f3' : '#9bb1b5'}">${sku}</text>
           <text x="${TILE - 4}" y="15" font-family="Arial" font-size="10" fill="#56d3d8" text-anchor="end">${real ? tris : ''}</text>
         </svg>`,
      ),
      top: row * (TILE + LABEL_H) + TILE,
      left: col * TILE,
    });
    process.stdout.write(`  ${sku.padEnd(28)} ${img ? 'rendered' : real ? 'no preview url' : 'placeholder'}\n`);
  }

  const rows = Math.ceil(skus.length / COLS);
  await sharp({ create: { width: COLS * TILE, height: rows * (TILE + LABEL_H), channels: 4, background: BG } })
    .composite(tiles)
    .png()
    .toFile(out);
  process.stdout.write(`\n${ok} models rendered, ${missing} without a preview → ${out}\n`);
}

await main();
