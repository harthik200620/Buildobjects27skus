/**
 * `npx tsx services/pipeline/tools/category-art-fallback.mts --only slug,slug [--all-missing]`
 *
 * A designed tile for a category that has no photograph yet.
 *
 * `category-art-gen.mts` photographs a category with Gemini and is the right tool whenever it can
 * run. Three of its thirty-seven calls failed on the run that produced the current set — two were
 * aborted and one returned no image — and what got written in their place is a near-white
 * rectangle with a faint grid and corner crop marks. On a grid of thirty-three dark photographs
 * that does not read as "photograph pending". It reads as a hole in the page, and it is the
 * brightest thing on the home page.
 *
 * Regenerating is blocked, not slow: the Gemini account answers every image request with
 * `429 RESOURCE_EXHAUSTED — "Your prepayment credits are depleted"`, on both image models the
 * project can address. That is a billing state, so no retry schedule reaches through it.
 *
 * So this draws the tile instead of photographing it, and does not pretend otherwise. It is a
 * deliberate graphic in the store's own palette — the same deep teal ground, the same falloff to
 * near-black, the same faint construction grid as the home page's hero field — carrying the
 * category's own Lucide mark large and quiet. It reads as a designed placeholder, which is what
 * it is, rather than as a photograph that failed to load.
 *
 * Two things it deliberately does NOT do:
 *
 *   · No baked-in text. The tile already prints the category name underneath it; a second name
 *     inside the image would be an untranslatable caption that no CSS can fix — the same reason
 *     `category-art-gen.mts` forbids lettering in its prompts.
 *   · No stock photograph. A search for "excavation" returns somebody's branded machine, and
 *     putting one manufacturer's excavator on the tile that means "excavation" is the
 *     misattribution this repository has already spent a pass removing from its SKU images.
 *
 * It writes through the same `categoryHeroKey(slug, size, version)` path as the photographic
 * generator and updates the same row, so a later `category-art-gen.mts --force` overwrites it
 * with a real photograph and nothing else has to change.
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
const LUCIDE = path.join(ROOT, 'node_modules', '.pnpm');

const SIZES: { size: ImageSize; width: number }[] = [
  { size: 'card', width: 800 },
  { size: 'gallery', width: 1600 },
];
const RATIO = 9 / 16;
const W = 1600;
const H = Math.round(W * RATIO);

/* The store's own tokens. Copied as literals because this writes a PNG, not a stylesheet — but
   they are the same five values theme.css defines, and the contrast gate reads that file. */
const CANVAS = '#06181d';
const CANVAS_2 = '#0a2229';
const TEAL_50 = '#0f333b';
const BRAND = '#56d3d8';
const LINE_2 = '#163a43';

/** Which Lucide mark stands for a category. Mirrors CATEGORY_ICONS in apps/web/components/icons.tsx. */
const MARK: Record<string, string> = {
  excavation: 'shovel',
  'storage-packaging': 'boxes',
  'total-stations': 'crosshair',
  presentation: 'presentation',
  safety: 'hard-hat',
  centering: 'construction',
  steel: 'bolt',
};

/**
 * Lucide's own geometry, read out of the installed package.
 *
 * Not redrawn by hand: the whole reason this store imports Lucide is that seventy-five hand-cut
 * glyphs drifted apart in exactly the ways optical correction exists to prevent, and drawing two
 * more by hand here would reintroduce that at the largest size the mark is ever shown.
 */
function lucidePath(name: string): string {
  const dirs = fs.readdirSync(LUCIDE).filter((d) => d.startsWith('lucide-react@'));
  for (const d of dirs) {
    const file = path.join(LUCIDE, d, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons', `${name}.mjs`);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const parts: string[] = [];
    for (const m of src.matchAll(/\[\s*"(path|circle|rect|line|polyline|polygon|ellipse)",\s*\{([\s\S]*?)\}\s*\]/g)) {
      const kind = m[1];
      const attrs = Object.fromEntries([...m[2].matchAll(/(\w+):\s*"([^"]*)"/g)].map((a) => [a[1], a[2]]));
      if (kind === 'path' && attrs.d) parts.push(`<path d="${attrs.d}"/>`);
      else if (kind === 'circle') parts.push(`<circle cx="${attrs.cx}" cy="${attrs.cy}" r="${attrs.r}"/>`);
      else if (kind === 'rect') parts.push(`<rect x="${attrs.x}" y="${attrs.y}" width="${attrs.width}" height="${attrs.height}" rx="${attrs.rx ?? 0}"/>`);
      else if (kind === 'line') parts.push(`<line x1="${attrs.x1}" y1="${attrs.y1}" x2="${attrs.x2}" y2="${attrs.y2}"/>`);
      else if (kind === 'polyline') parts.push(`<polyline points="${attrs.points}"/>`);
      else if (kind === 'polygon') parts.push(`<polygon points="${attrs.points}"/>`);
      else if (kind === 'ellipse') parts.push(`<ellipse cx="${attrs.cx}" cy="${attrs.cy}" rx="${attrs.rx}" ry="${attrs.ry}"/>`);
    }
    if (parts.length) return parts.join('');
  }
  throw new Error(`no lucide geometry for "${name}"`);
}

/**
 * The tile.
 *
 * Built from the same three layers the home page's hero field is built from, in the same order:
 * a teal wash off-centre, a construction grid masked so it fades before it reaches the edges, and
 * a vignette that drops the corners to canvas black. The mark sits on top at 44% of the frame
 * height, in brand teal at low opacity, off-centre to the right so the composition has the same
 * asymmetry as the photographs it sits beside.
 */
function tileSvg(mark: string): string {
  const glyph = lucidePath(mark);
  /* Lucide draws on a 24-unit grid. 520 units tall on a 900-tall frame is 58%, which is roughly
     the height the subject occupies in the photographs this sits beside — at 44% the mark read
     as a small thing floating in a lot of nothing while its neighbours filled their frames. */
  const scale = 520 / 24;
  const gx = W * 0.6 - (24 * scale) / 2;
  const gy = H * 0.46 - (24 * scale) / 2;
  /* The pool of light the mark stands in. Every photograph in the set is lit on a surface, so a
     mark hanging in a void is the one thing that would still mark these two out. */
  const floorY = gy + 24 * scale + 26;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="wash" cx="26%" cy="30%" r="78%">
      <stop offset="0%" stop-color="${TEAL_50}"/>
      <stop offset="62%" stop-color="${CANVAS_2}"/>
      <stop offset="100%" stop-color="${CANVAS}"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="48%" r="72%">
      <stop offset="55%" stop-color="${CANVAS}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${CANVAS}" stop-opacity="0.92"/>
    </radialGradient>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M56 0H0V56" fill="none" stroke="${LINE_2}" stroke-width="1"/>
    </pattern>
    <linearGradient id="gridfade" x1="0" y1="0" x2="0.9" y2="1">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.85"/>
      <stop offset="82%" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="gridmask"><rect width="${W}" height="${H}" fill="url(#gridfade)"/></mask>
    <linearGradient id="markink" x1="0" y1="0" x2="0.55" y2="1">
      <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="${BRAND}" stop-opacity="0.16"/>
    </linearGradient>
    <radialGradient id="floor" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.13"/>
      <stop offset="100%" stop-color="${BRAND}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="key" cx="24%" cy="22%" r="58%">
      <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="${BRAND}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#wash)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)" mask="url(#gridmask)"/>
  <!-- the key light, upper left, exactly where every photograph in the set is lit from -->
  <rect width="${W}" height="${H}" fill="url(#key)"/>
  <ellipse cx="${(gx + (24 * scale) / 2).toFixed(0)}" cy="${floorY.toFixed(0)}" rx="${(24 * scale * 0.62).toFixed(0)}" ry="34" fill="url(#floor)"/>
  <g transform="translate(${gx} ${gy}) scale(${scale})"
     fill="none" stroke="url(#markink)" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
</svg>`;
}

async function writeRenditions(slug: string, source: Buffer): Promise<string> {
  const store = mediaStore();
  const version = createHash('sha1').update(source).digest('hex').slice(0, 10);
  for (const { size, width } of SIZES) {
    const height = Math.round(width * RATIO);
    const buf = await sharp(source).resize(width, height, { fit: 'cover', position: 'centre' }).webp({ quality: 86 }).toBuffer();
    await store.put(categoryHeroKey(slug, size, version), buf, 'image/webp');
  }
  const cardKey = categoryHeroKey(slug, 'card', version);
  await getDb().update(categories).set({ heroImageKey: cardKey }).where(eq(categories.slug, slug));
  return cardKey;
}

async function main() {
  const argv = process.argv.slice(2);
  const onlyIdx = argv.indexOf('--only');
  const raw = argv.find((a) => a.startsWith('--only='))?.slice(7) ?? (onlyIdx >= 0 ? (argv[onlyIdx + 1] ?? '') : '');
  const only = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (only.length === 0) {
    console.log('nothing to do — pass --only slug,slug');
    return;
  }

  for (const slug of only) {
    const mark = MARK[slug];
    if (!mark) {
      console.log(`  ${slug.padEnd(24)} SKIPPED — no mark mapped for this category`);
      continue;
    }
    /* A grain overlay so the flat gradients do not band on an 8-bit display; sharp's noise is
       cheaper and more even than anything the SVG filter primitives produce at this size. */
    const flat = await sharp(Buffer.from(tileSvg(mark)))
      .png()
      .toBuffer();
    const grain = await sharp({ create: { width: W, height: H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 5 } } })
      .png()
      .toBuffer();
    const composed = await sharp(flat)
      .composite([{ input: grain, blend: 'overlay', opacity: 0.12 }])
      .png()
      .toBuffer();

    const key = await writeRenditions(slug, composed);
    console.log(`  ${slug.padEnd(24)} drawn  ${mark.padEnd(14)} → ${key}`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
