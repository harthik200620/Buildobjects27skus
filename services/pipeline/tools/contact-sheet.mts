/**
 * Lays out every photograph a SKU's own product page offers, numbered, as one PNG.
 *
 *   npx tsx services/pipeline/tools/contact-sheet.mts <SKU> [outDir]
 *
 * Six SKUs ended up with a hero that was the right brand and the wrong subject — a city
 * skyline for UltraTech, a field for Vikram, a pole-mount bracket for Dahua. No ranking rule
 * separates those from the product without also breaking a SKU it had got right, so the
 * choice goes to a person. This is what a person needs to make it: the candidates, in rank
 * order, with the index to quote back and the URL to paste into the curated file.
 *
 * Writes `<outDir>/<SKU>.png` and prints one line per tile.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { RAW_DIR } from '../src/config';
import { discoverImages, fullSizeVariants } from '../src/media/discover';
import { studioScore } from '../src/media/images';
import { listCurated } from '../src/providers/curated';
import { ACCEPT_IMAGE, download } from '../src/util/http';

const TILE = 260;
const COLS = 6;
const MAX = 30;

const code = process.argv[2];
const outDir = process.argv[3] ?? '.';
if (!code) throw new Error('usage: contact-sheet.mts <SKU> [outDir]');

const all = listCurated();
const sku = all.find((c) => c.sku_code === code);
if (!sku) throw new Error(`no curated file for ${code}`);

const pageFile = path.join(RAW_DIR, code, 'page.html');
if (!fs.existsSync(pageFile)) throw new Error(`no captured page for ${code}`);

const ranked = discoverImages({
  html: fs.readFileSync(pageFile, 'utf8'),
  pageUrl: sku.sources.official_product_url,
  brandSlug: sku.brand.slug,
  brandName: sku.brand.name,
  productName: sku.product.name,
  modelNo: sku.product.model_no,
  brands: all.map((c) => ({ slug: c.brand.slug, domains: c.brand.official_domains ?? [] })),
}).slice(0, MAX);

console.log(`${code} — ${sku.product.name}`);
console.log(`page: ${sku.sources.official_product_url}\n`);

const tiles: { buf: Buffer; label: string }[] = [];
for (const [i, cand] of ranked.entries()) {
  for (const variant of fullSizeVariants(cand.url)) {
    try {
      const { buf } = await download(variant, { accept: ACCEPT_IMAGE, maxBytes: 40 * 1024 * 1024 });
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) continue;
      tiles.push({ buf, label: `${i}` });
      console.log(
        `${String(i).padStart(2)}  ${String(meta.width).padStart(4)}x${String(meta.height).padEnd(4)}  score ${String(cand.score).padStart(4)}  studio ${(await studioScore(buf)).toFixed(2)}  ${variant}`,
      );
      break;
    } catch {
      /* the next variant, or the next candidate */
    }
  }
}

const rows = Math.ceil(tiles.length / COLS);
const sheet = sharp({ create: { width: COLS * TILE, height: Math.max(1, rows) * TILE, channels: 3, background: '#ffffff' } });
const composites = await Promise.all(
  tiles.map(async (t, i) => {
    // The index is burned into the tile so the printed list and the picture cannot drift apart.
    const badge = Buffer.from(
      `<svg width="${TILE}" height="${TILE}"><rect x="0" y="0" width="34" height="22" fill="#0f7c84"/><text x="17" y="16" font-family="Arial" font-size="14" font-weight="bold" fill="#fff" text-anchor="middle">${t.label}</text></svg>`,
    );
    const img = await sharp(t.buf)
      .flatten({ background: '#ffffff' })
      .resize(TILE - 8, TILE - 8, { fit: 'inside' })
      .png()
      .toBuffer();
    return [
      { input: img, top: ((i / COLS) | 0) * TILE + 4, left: (i % COLS) * TILE + 4 },
      { input: badge, top: ((i / COLS) | 0) * TILE, left: (i % COLS) * TILE },
    ];
  }),
);
const out = path.join(outDir, `${code}.png`);
await sheet.composite(composites.flat()).png().toFile(out);
console.log(`\n${tiles.length} candidates → ${out}`);
