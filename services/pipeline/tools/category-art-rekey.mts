/**
 * `npx tsx services/pipeline/tools/category-art-rekey.mts`
 *
 * Move every category image already on disk onto a content-versioned key, and point the database
 * at it.
 *
 * /media is served `immutable, max-age=31536000`. That is correct for content-derived keys and it
 * was wrong for `categories/{slug}/hero-card.webp`, which is a stable path: regenerating the
 * artwork left every browser that had seen the previous file pinned to it for a year. The
 * storefront showed drawn placeholder tiles while thirty-four real photographs sat on disk behind
 * the same URLs.
 *
 * This is the one-time repair. It re-derives both renditions from the gallery original already
 * present, names them by a hash of their own bytes, updates `categories.hero_image_key`, and
 * removes the unversioned files so nothing can serve them again. No image is regenerated and no
 * model is called.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { categoryHeroKey, type ImageSize } from '@buildobjects/catalog';
import { categories, closeDb, getDb } from '@buildobjects/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { mediaStore } from '../src/media/store';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CATEGORIES_DIR = path.join(ROOT, 'storage', 'media', 'categories');
const SIZES: { size: ImageSize; width: number }[] = [
  { size: 'card', width: 800 },
  { size: 'gallery', width: 1600 },
];
const RATIO = 9 / 16;

async function main() {
  if (!fs.existsSync(CATEGORIES_DIR)) throw new Error(`no category art at ${CATEGORIES_DIR}`);
  const store = mediaStore();
  const db = getDb();
  let moved = 0;
  let already = 0;
  let missing = 0;

  for (const slug of fs.readdirSync(CATEGORIES_DIR).sort()) {
    const dir = path.join(CATEGORIES_DIR, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    const files = fs.readdirSync(dir);

    if (files.some((f) => f.startsWith('hero-gallery-'))) {
      already += 1;
      continue;
    }
    const original = path.join(dir, 'hero-gallery.webp');
    if (!fs.existsSync(original)) {
      missing += 1;
      process.stdout.write(`  ${slug.padEnd(26)} no artwork on disk\n`);
      continue;
    }

    const source = fs.readFileSync(original);
    const version = createHash('sha1').update(source).digest('hex').slice(0, 10);
    for (const { size, width } of SIZES) {
      const buf = await sharp(source)
        .resize(width, Math.round(width * RATIO), { fit: 'cover', position: 'centre' })
        .webp({ quality: 86 })
        .toBuffer();
      await store.put(categoryHeroKey(slug, size, version), buf, 'image/webp');
    }
    const cardKey = categoryHeroKey(slug, 'card', version);
    await db.update(categories).set({ heroImageKey: cardKey }).where(eq(categories.slug, slug));

    // Delete the unversioned files so a stale immutable cache can never be re-populated from them.
    for (const f of ['hero-card.webp', 'hero-gallery.webp']) {
      const old = path.join(dir, f);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    moved += 1;
    process.stdout.write(`  ${slug.padEnd(26)} → ${version}\n`);
  }

  process.stdout.write(`\n${moved} re-keyed, ${already} already versioned, ${missing} with no artwork\n`);
}

await main();
await closeDb();
