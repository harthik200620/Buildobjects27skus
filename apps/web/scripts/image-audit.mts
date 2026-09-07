/**
 * pnpm --filter @buildobjects/web images:audit [--write] [--strict]
 *
 * Which of the catalogue's photographs are not photographs.
 *
 * WHAT THIS CAUGHT. Somany's Duragres tile shipped with four blank frames — 282-byte WebPs, one
 * flat colour, no image — and the fifth was the only real one. Frame 1 is the hero, so the store
 * showed an EMPTY BOX as that product's face on the flooring category page, in every search
 * result, and at the top of its own product page. Nothing failed: a solid-colour WebP decodes
 * perfectly, `next/image` renders it happily, and every test passed.
 *
 * That is the whole reason this exists. A missing file is loud — a 404, a broken-image glyph,
 * something in a log. A file that decodes to nothing is silent, and the only way to find it is to
 * look at the pixels, which is what this does: `sharp().stats()` per channel, and a frame whose
 * strongest channel varies by less than FLAT is not a picture of anything.
 *
 * `lib/hero-image.ts` already refused to lead with a frame the pipeline had FLAGGED as a
 * placeholder. These frames are not flagged — they are simply empty — so that rule never fired.
 * `--write` regenerates `lib/blank-frames.ts` so the same rule can act on measurement instead.
 *
 *   (no flags)  report only
 *   --write     regenerate lib/blank-frames.ts
 *   --strict    exit 1 if any SKU's hero frame is blank and no real frame could replace it
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { values } = parseArgs({ args: process.argv.slice(2), strict: false, options: { write: { type: 'boolean' }, strict: { type: 'boolean' } } });
const WRITE = !!values.write;
const STRICT = !!values.strict;

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '..');
const SKUS = path.join(WEB, 'public', 'media', 'skus');

/**
 * The threshold, and why it is 6.
 *
 * `stats().channels[].stdev` is the per-channel standard deviation over every pixel, in 0–255.
 * The blanks measure 0.08 and 0.52; the thinnest REAL frame in this catalogue — a white marble
 * tile that is very nearly one colour — measures 18.6. Two orders of magnitude of daylight
 * between them, so the exact number matters far less than being inside that gap. Six is low
 * enough that no photograph has ever tripped it and high enough to catch a blank that carries a
 * little compression noise.
 */
const FLAT = 6;

interface Frame {
  sku: string;
  position: number;
  file: string;
  bytes: number;
  stdev: number;
}

async function measure(): Promise<Frame[]> {
  const out: Frame[] = [];
  if (!fs.existsSync(SKUS)) {
    console.error(`no media at ${SKUS} — run: pnpm --filter @buildobjects/web stage`);
    process.exit(STRICT ? 1 : 0);
  }
  for (const shard of fs.readdirSync(SKUS)) {
    for (const sku of fs.readdirSync(path.join(SKUS, shard))) {
      const dir = path.join(SKUS, shard, sku, 'img');
      if (!fs.existsSync(dir)) continue;
      /* The CARD rendition, because that is the one a listing draws. Every other rendition of the
         same position comes from the same source, so one is enough to judge the frame. */
      for (const file of fs.readdirSync(dir).filter((f) => /^\d+-card\.webp$/.test(f))) {
        const full = path.join(dir, file);
        const position = Number(file.split('-')[0]);
        try {
          const stats = await sharp(full).stats();
          out.push({ sku, position, file, bytes: fs.statSync(full).size, stdev: Math.max(...stats.channels.map((c) => c.stdev)) });
        } catch (e) {
          /* An unreadable frame is worse than a flat one, so it counts as blank. */
          out.push({ sku, position, file, bytes: fs.statSync(full).size, stdev: 0 });
          console.warn(`  ! ${sku}/${file}: ${(e as Error).message}`);
        }
      }
    }
  }
  return out.sort((a, b) => a.sku.localeCompare(b.sku) || a.position - b.position);
}

const frames = await measure();
const bySku = new Map<string, Frame[]>();
for (const f of frames) bySku.set(f.sku, [...(bySku.get(f.sku) ?? []), f]);

const blanks = new Map<string, number[]>();
for (const [sku, list] of bySku) {
  const flat = list.filter((f) => f.stdev < FLAT).map((f) => f.position);
  if (flat.length) blanks.set(sku, flat);
}

console.log(`${frames.length} card frames across ${bySku.size} products; ${[...blanks.values()].flat().length} are blank (max channel stdev < ${FLAT})\n`);

let fatal = 0;
for (const [sku, positions] of blanks) {
  const list = bySku.get(sku) ?? [];
  const real = list.filter((f) => f.stdev >= FLAT).map((f) => f.position);
  const heroBlank = positions.includes(Math.min(...list.map((f) => f.position)));
  const mark = heroBlank ? (real.length ? 'HERO BLANK -> falls back to' : 'HERO BLANK, NO REAL FRAME') : 'gallery only, hero is fine';
  if (heroBlank && !real.length) fatal++;
  console.log(`  ${sku.padEnd(26)} blank ${positions.join(',').padEnd(9)} ${mark} ${heroBlank && real.length ? real[0] : ''}`);
  for (const f of list.filter((x) => positions.includes(x.position)))
    console.log(`      ${f.file.padEnd(14)} ${String(f.bytes).padStart(6)}B  stdev ${f.stdev.toFixed(2)}`);
}
if (!blanks.size) console.log('  (none)');

if (WRITE) {
  const entries = [...blanks.entries()].sort(([a], [b]) => a.localeCompare(b));
  const body = entries.map(([sku, positions]) => `  '${sku.toUpperCase()}': [${positions.join(', ')}],`).join('\n');
  const file = `/**
 * GENERATED by scripts/image-audit.mts — do not edit by hand.
 *
 * Frames that decode to a single flat colour: files that exist, decode without error, and are
 * pictures of nothing. They are indistinguishable from real photographs to every part of the
 * stack except a pixel measurement, which is what produced this list.
 *
 * \`lib/hero-image.ts\` treats a frame named here exactly as it treats one the pipeline flagged as
 * a placeholder — kept in the gallery, never allowed to lead.
 *
 * Regenerate with: pnpm --filter @buildobjects/web images:audit --write
 */

/** SKU code (upper case) -> the 1-based frame positions that carry no image. */
export const BLANK_FRAMES: Readonly<Record<string, readonly number[]>> = {
${body}
};

/** Is this product's frame at \`position\` a blank? */
export const isBlankFrame = (skuCode: string, position: number): boolean => BLANK_FRAMES[skuCode.toUpperCase()]?.includes(position) === true;
`;
  const out = path.join(WEB, 'lib', 'blank-frames.ts');
  fs.writeFileSync(out, file, 'utf8');
  console.log(`\nwrote lib/blank-frames.ts (${entries.length} products)`);
}

if (STRICT && fatal) {
  console.error(`\n${fatal} product(s) have a blank hero and no real frame to fall back to.`);
  process.exit(1);
}
