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
 *
 * EVERY SNAPSHOT, NOT JUST skus.json. `lib/static-catalogue.ts` — which IS the live site, because
 * the Vercel deployment has no database — imports four of these files, and `flagship.json`,
 * `listings.json` and `search-all.json` carry their own copies of the hash. Patching only
 * `skus.json` fixed the product page and left the pale flash on every card in the listings, the
 * search results and the home strip: correct locally against MySQL, wrong on the deployment. So
 * this walks the whole directory and rewrites any object that has a blurhash and an image path to
 * recompute it from.
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

/**
 * What a node calls the picture its hash describes. `card` is the grid's rendition and the frame
 * the mount is sampled from, so it leads; `hero_image_key` is what the listing, search and
 * flagship snapshots use for the same image.
 */
const IMAGE_KEYS = ['card', 'hero_image_key', 'gallery', 'thumb'] as const;

let changed = 0;
let same = 0;
let missing = 0;

/** Every object anywhere in the tree that has a hash and something to recompute it from. */
async function walk(node: unknown): Promise<void> {
  if (Array.isArray(node)) {
    for (const child of node) await walk(child);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  if (typeof rec.blurhash === 'string') {
    const key = IMAGE_KEYS.find((k) => typeof rec[k] === 'string');
    if (!key) missing++;
    else {
      const file = path.join(MEDIA, rec[key] as string);
      if (!fs.existsSync(file)) missing++;
      else {
        const next = await blurhashOf(file);
        if (next === rec.blurhash) same++;
        else {
          changed++;
          if (!DRY) rec.blurhash = next;
        }
      }
    }
  }
  for (const v of Object.values(rec)) await walk(v);
}

const dir = path.dirname(SNAPSHOT);
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const file = path.join(dir, name);
  const before = changed;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  await walk(doc);
  if (changed > before) {
    if (!DRY) fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`  ${name.padEnd(20)} ${changed - before} rewritten`);
  }
}
console.log(`${changed} hashes rewritten · ${same} already current · ${missing} with nothing to read${DRY ? ' — dry run, nothing written' : ''}`);
/*
 * IT REWRITES THE WHOLE FILE, NOT THE ONE FIELD. JSON.stringify(…, 2) puts every array element on
 * its own line; biome keeps short ones inline, so a run that touches one hash reformats thousands
 * of unrelated lines and `pnpm lint` fails on files this script had no business changing. Saying so
 * is cheaper than the next person rediscovering it from a red gate.
 */
if (changed && !DRY) console.log('  now run: npx biome format --write apps/web/data/catalogue/');
