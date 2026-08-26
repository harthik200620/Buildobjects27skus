/**
 * npx tsx services/pipeline/tools/regrade-plate.mts
 *
 * Settle the open item MANIFEST.md raises against `catalogue-aisle.webp`.
 *
 * WHAT WAS WRONG. The manifest records that this frame and `site-materials.webp` came back from
 * the generator carrying legible packaging — an invention of UltraTech's, ACC's, Kajaria's and
 * several other companies' trade dress, with some of the words misspelled. It records a partial
 * fix: the offending regions were thrown out of focus, and it says in as many words that this is
 * "a mitigation, not a fix".
 *
 * On `site-materials` the mitigation worked; its sacks are unreadable at native resolution and
 * nothing else in that frame carries branding. On this frame it did not. The near foreground was
 * softened and the MID-GROUND shelving was left sharp, and at native resolution the stacked sacks
 * on both sides read "… Cement" over and over down the pile.
 *
 * "You cannot read it at the size we display it" is not the test. The plate ships at 2560px on a
 * public CDN and anyone can open the file — and this plate is the backplate on all 35 category
 * pages and on search, so it would have been the most-served image in the store.
 *
 * WHAT THIS DOES, AND WHY NOT A BLUR. Blurring the shelves was tried first and it fails on this
 * composition: the two stacks sit at 32–43% and 56–67% of the frame, so the corridor between them
 * is about a seventh of the width, and a mask narrow enough to catch the lettering blurs almost
 * the whole photograph. The frame's subject IS the branded packaging, and there is no version of
 * it that keeps the subject and loses the brands.
 *
 * So it is cropped instead, to the upper 46%: the ceiling, the beams, and the lamp run receding
 * into black. No packaging is above 42% of the frame, and what clips the bottom edge is already
 * defocused past legibility — verified at native resolution, not at display size. The crop is
 * also the better plate: it is 3.9:1 against the original's 1.79, and every slot it fills is a
 * wide banner, so `object-fit: cover` now discards a sliver where it used to discard half the
 * composition.
 *
 * Rerun-safe: the pre-crop frame is stashed in `_source/` on the first run and every later run
 * works from there, so this never crops an already-cropped frame.
 *
 * After this, rebuild the served renditions:
 *   pnpm --filter @buildobjects/web stage
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const ART = path.resolve(here, '..', '..', '..', 'design-system', 'art');

/** The fraction of the frame's height kept, measured from the top. */
const KEEP = 0.46;

const target = path.join(ART, 'catalogue-aisle.webp');
const sourceDir = path.join(ART, '_source');
const source = path.join(sourceDir, 'catalogue-aisle.webp');

if (!fs.existsSync(source)) {
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.copyFileSync(target, source);
  console.log(`kept the pre-crop frame at ${path.relative(process.cwd(), source)}`);
}

const meta = await sharp(source).metadata();
const width = meta.width as number;
const height = Math.round((meta.height as number) * KEEP);

await sharp(source).extract({ left: 0, top: 0, width, height }).webp({ quality: 84 }).toFile(target);

const after = fs.statSync(target).size;
console.log(`catalogue-aisle.webp  ${width}×${meta.height} → ${width}×${height}  (${(width / height).toFixed(2)}:1, ${(after / 1024).toFixed(0)} KB)`);
console.log('now run: pnpm --filter @buildobjects/web stage');
