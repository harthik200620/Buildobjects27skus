/**
 * `npx tsx services/pipeline/tools/category-art-thumbs.mts`
 *
 * Derive a 400 px rendition of every category photograph.
 *
 * The home page draws thirty-seven category tiles. The smallest rendition that existed was
 * `hero-card` at 800 × 450, so every tile shipped an 800 px image into a box that is about 280 px
 * wide on a desktop grid and 170 px on a phone — 1.3 MB of photographs to paint roughly 400 KB
 * worth of pixels. That is the single largest thing the front door was waiting on.
 *
 * No model is called and no artwork is regenerated: this resamples what is already on disk. The
 * hash in the filename is the content version of the *original*, shared across renditions, so a
 * thumb keeps its card's hash and `lib/image-loader.ts` can swap the size segment and nothing else.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CATEGORIES = path.join(ROOT, 'storage', 'media', 'categories');
const WIDTH = 400;
const RATIO = 9 / 16;

/** Prefer the largest source available: resampling from the gallery beats resampling a resample. */
const SOURCE_ORDER = ['hero-gallery-', 'hero-card-'];

async function main() {
  if (!fs.existsSync(CATEGORIES)) throw new Error(`no category art at ${CATEGORIES}`);
  const force = process.argv.includes('--force');
  let written = 0;
  let already = 0;
  let missing = 0;
  let bytes = 0;

  for (const slug of fs.readdirSync(CATEGORIES).sort()) {
    const dir = path.join(CATEGORIES, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    const files = fs.readdirSync(dir);

    const source = SOURCE_ORDER.map((prefix) => files.find((f) => f.startsWith(prefix) && f.endsWith('.webp'))).find(Boolean);
    if (!source) {
      missing += 1;
      process.stdout.write(`  ${slug.padEnd(26)} no card or gallery rendition\n`);
      continue;
    }

    const hash = source.replace(/^hero-(gallery|card)-/, '').replace(/\.webp$/, '');
    const out = path.join(dir, `hero-thumb-${hash}.webp`);
    if (fs.existsSync(out) && !force) {
      already += 1;
      continue;
    }

    await sharp(path.join(dir, source))
      .resize(WIDTH, Math.round(WIDTH * RATIO), { fit: 'cover' })
      .webp({ quality: 78 })
      .toFile(out);
    written += 1;
    bytes += fs.statSync(out).size;
  }

  process.stdout.write(
    `\n${written} written${written ? ` (${(bytes / 1024 / written).toFixed(0)} KB average)` : ''}` +
      `${already ? ` · ${already} already current` : ''}${missing ? ` · ${missing} with no source` : ''}\n`,
  );
}

await main();
