/**
 * `npx tsx services/pipeline/tools/classify-images.mts [--only SKU,SKU] [--force] [--write]`
 *
 * Looks at every catalogue photograph and says what is actually in it, so the 3D pipeline can
 * model the PRODUCT instead of whatever happened to be filed at position 1.
 *
 * It exists because the role column cannot answer the question. Roles are assigned by position
 * (`stages.ts`: `const role = IMAGE_ROLES[i]`, enforced by `validate-curated.ts`), so all 27 SKUs
 * read `1:hero 2:angle 3:in_context 4:detail 5:pack_or_dimensions` no matter what the pictures
 * show — and `selectViews()`'s `role !== 'pack_or_dimensions'` filter has therefore never
 * excluded a single packaging photo. It only ever drops position 5.
 *
 * Writes `services/pipeline/registry/image-content.json`: per SKU, what each position shows and
 * which position — if any — is a bare, single, correctly-branded unit on a clean ground that a
 * model can honestly be built from. `--write` also refreshes the `photos` block of
 * `assets/3d/review.json` from it, which is what `pnpm assets:3d` reads.
 *
 * Verdicts are cached by sha1(image) + model + prompt version, so re-running is free.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv } from '@buildobjects/db';
import { ASSETS_3D_DIR, env, REGISTRY_DIR } from '../src/config';
import { classifyImage, hasVision, type ImageVerdict, type ProductIdentity, visionModel } from '../src/media/vision';

loadEnv();

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: false,
  options: { only: { type: 'string' }, force: { type: 'boolean' }, write: { type: 'boolean' } },
});
const only = String(values.only ?? '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

if (!hasVision()) {
  console.error('No vision key. Set BO_CHAT_API_KEY (or ANTHROPIC_API_KEY) in .env.');
  process.exit(1);
}

/** The catalogue snapshot is the one source that works without a database running. */
const SNAPSHOT = path.join(env.mediaRoot, '..', '..', 'apps', 'web', 'data', 'catalogue', 'skus.json');
interface SnapSku {
  sku: { code: string };
  product: { name: string };
  brand: { name: string };
  category: { slug: string };
  images: { position: number; role: string }[];
}
const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) as Record<string, SnapSku>;

const shard = (code: string): string => path.basename(path.dirname(code));
const imageDir = (code: string): string | null => {
  const root = path.join(env.mediaRoot, 'skus');
  for (const sh of fs.readdirSync(root)) {
    const dir = path.join(root, sh, code, 'img');
    if (fs.existsSync(dir)) return dir;
  }
  return null;
};
void shard;

const origFor = (dir: string, position: number): string | null => {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const f = path.join(dir, `${position}-orig.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
};

interface SkuRecord {
  brand: string;
  name: string;
  category: string;
  /** Position that may be used to build or texture a 3D model, or null when none may. */
  product_photo: number | null;
  why: string;
  positions: Record<string, ImageVerdict>;
}

const out: Record<string, SkuRecord> = {};
let calls = 0;
const started = Date.now();

for (const entry of Object.values(snap)) {
  const code = entry.sku.code.toUpperCase();
  if (only.length && !only.includes(code)) continue;
  const dir = imageDir(code);
  if (!dir) {
    console.log(`  ${code.padEnd(26)} no media on disk — skipped`);
    continue;
  }
  const identity: ProductIdentity = { sku: code, brand: entry.brand.name, name: entry.product.name, category: entry.category.slug };
  const positions: Record<string, ImageVerdict> = {};
  for (const img of entry.images) {
    const file = origFor(dir, img.position);
    if (!file) continue;
    try {
      const before = fs.existsSync(path.join(env.mediaRoot)) ? 0 : 0;
      void before;
      const v = await classifyImage(file, identity, { force: !!values.force });
      positions[String(img.position)] = v;
      calls++;
    } catch (e) {
      console.error(`  ${code} #${img.position}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  /* Prefer a usable photo; among several, the earliest position, because the catalogue orders
     them best-first within whatever its ranking believed. */
  const usable = Object.entries(positions)
    .filter(([, v]) => v.usable_for_3d)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
  const best = usable[0] ?? null;
  const why = best
    ? positions[String(best)].why
    : `no bare, single, correctly-branded unit on a clean ground among ${Object.keys(positions).length} images — ` +
      Object.entries(positions)
        .map(([k, v]) => `#${k} ${v.shows}`)
        .join(', ');
  out[code] = { brand: identity.brand, name: identity.name, category: identity.category, product_photo: best, why, positions };
  const mark = best ? `#${best}` : '——';
  console.log(
    `  ${code.padEnd(26)} ${mark.padEnd(4)} ${Object.entries(positions)
      .map(([k, v]) => `${k}:${v.shows.replace('_or_stock', '').replace('product_in_packaging', 'in_pack')}`)
      .join(' ')}`,
  );
}

const file = path.join(REGISTRY_DIR, 'image-content.json');
const doc = {
  _: 'What each catalogue photograph actually shows, read by a vision model rather than inferred from its position.',
  _why: [
    'sku_images.role is assigned by POSITION (stages.ts: `const role = IMAGE_ROLES[i]`, enforced by',
    'validate-curated.ts), so it says 1:hero 2:angle 3:in_context 4:detail 5:pack for every SKU in the',
    'catalogue whatever the pictures show. It cannot describe content, and the 3D pipeline was reading',
    'it as though it could — which is how a bulb came to be modelled as its cardboard carton.',
    '',
    '`product_photo` is the only position a 3D model may be built or textured from: a bare, single,',
    'correctly-branded unit on a clean ground. null means this SKU has no such photograph, and the',
    'honest thing to draw is a parametric model at its real dimensions.',
    '',
    'Regenerate with: npx tsx services/pipeline/tools/classify-images.mts --write',
  ],
  model: visionModel(),
  generated_at: new Date().toISOString(),
  skus: out,
};
fs.mkdirSync(REGISTRY_DIR, { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);

const withPhoto = Object.values(out).filter((r) => r.product_photo !== null).length;
console.log(
  `\n${Object.keys(out).length} SKUs · ${calls} images read · ${withPhoto} have a usable product photograph · ${Object.keys(out).length - withPhoto} do not`,
);
console.log(`written: ${path.relative(env.mediaRoot, file)}  (${((Date.now() - started) / 1000).toFixed(0)}s)`);

if (values.write) {
  /* The `photos` block of the 3D review is DERIVED from this, so the two can never drift. The
     `models` block is a separate judgement about geometry and is left alone. */
  const reviewFile = path.join(ASSETS_3D_DIR, 'review.json');
  const review = JSON.parse(fs.readFileSync(reviewFile, 'utf8')) as Record<string, unknown>;
  const photos: Record<string, string> = {
    _:
      'Derived — do not hand-edit. SKUs whose photographs must not texture a parametric model, with what the ' +
      'vision pass saw. Regenerate with `npx tsx services/pipeline/tools/classify-images.mts --write`.',
  };
  for (const [code, r] of Object.entries(out)) if (r.product_photo === null) photos[code] = r.why;
  review.photos = photos;
  /* And WHICH position, where one is allowed. Without this the build still reaches for
     `role === 'hero'` — position 1 for every SKU in the catalogue, which is the assumption this
     whole pass exists to replace. */
  const positions: Record<string, number | string> = {
    _: 'Derived — the position that actually shows the product. Not position 1 by default: that is the assumption this replaces.',
  };
  for (const [code, r] of Object.entries(out)) if (r.product_photo !== null) positions[code] = r.product_photo;
  review.photo_positions = positions;
  fs.writeFileSync(reviewFile, `${JSON.stringify(review, null, 2)}\n`);
  console.log(`review.json rewritten: ${Object.keys(photos).length - 1} blocked, ${Object.keys(positions).length - 1} pinned to a position`);
}
