/**
 * `pnpm --filter @buildobjects/web rehash-blur [--dry]`
 *
 * Recompute the blurhash of every catalogue image from the file that is actually on disk, and
 * patch `data/catalogue/skus.json` in place.
 *
 * A blurhash is a twenty-character summary of the picture, shown while the real one loads. It is
 * therefore a COPY of the image, and `scripts/blend-skus.mts` changes the image — so the moment
 * the studio sweep was recoloured from silver to the dark mount, every hash in the snapshot
 * described a photograph that no longer exists. The placeholder was a pale rectangle that snapped
 * to a dark one, on every card, which is the flash the placeholder exists to prevent.
 *
 * `lib/plate.ts` reads the same hashes to choose a mount, so a stale hash is not only a flash: it
 * picks the silver plate for a photograph that is now dark. `lib/plate.test.ts` fails on exactly
 * that disagreement, which is how this came to light.
 *
 * It patches rather than regenerates because `services/pipeline/tools/export-catalogue.mts` cannot
 * be re-run — it imports loaders that statically import the JSON it deletes, so it destroys its
 * own input partway through. Reading each `{n}-card.webp` and writing back one field is the small,
 * safe half of that job.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from 'blurhash';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const REPO = path.resolve(WEB, '..', '..');
const SNAPSHOT = path.join(WEB, 'data', 'catalogue', 'skus.json');
const MEDIA = path.join(REPO, 'storage', 'media');
const DRY = process.argv.includes('--dry');

/** The same 32 px / 4x3 encode the pipeline uses — see services/pipeline/src/media/images.ts. */
async function blurhashOf(file: string): Promise<string> {
  const { data, info } = await sharp(file).resize(32, 32, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
}

interface Img {
  position: number;
  blurhash?: string;
  card?: string;
  gallery?: string;
  thumb?: string;
}
const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) as Record<string, { images?: Img[] }>;

let changed = 0;
let same = 0;
let missing = 0;

for (const [sku, row] of Object.entries(snap)) {
  for (const im of row.images ?? []) {
    /* The card rendition is the one the grid shows and the one the mount is sampled from, so it
       is the frame the hash has to describe. */
    const rel = im.card ?? im.gallery ?? im.thumb;
    if (!rel) continue;
    const file = path.join(MEDIA, rel);
    if (!fs.existsSync(file)) {
      missing++;
      continue;
    }
    const next = await blurhashOf(file);
    if (next === im.blurhash) {
      same++;
      continue;
    }
    changed++;
    if (!DRY) im.blurhash = next;
  }
  void sku;
}

if (!DRY && changed) fs.writeFileSync(SNAPSHOT, `${JSON.stringify(snap, null, 2)}\n`);
console.log(`${changed} hashes rewritten · ${same} already current · ${missing} with no file${DRY ? ' — dry run, nothing written' : ''}`);
