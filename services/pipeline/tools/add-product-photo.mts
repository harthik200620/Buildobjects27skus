/**
 * `npx tsx services/pipeline/tools/add-product-photo.mts --from candidates.json [--write]`
 *
 * The hand-fed half of `source-product-photos.mts`: take candidate image URLs found by a person
 * in a browser, put them through exactly the same vision gate, and keep the first that is
 * genuinely the product.
 *
 * WHY A SECOND ENTRY POINT. `source-product-photos.mts` reads the brand pages already captured
 * under storage/raw and ranks the images on them. That works where a capture exists and the page
 * shows the product. It cannot help with the thirteen SKUs still without a photograph, and the
 * two reasons are different:
 *
 *   · Wipro and Saint-Gobain refuse automated capture outright (429 / 403), so there is no page
 *     to rank. A browser with a real session reaches what a fetch cannot.
 *   · Glass, cement and epoxy brand pages carry architectural scenes and application shots.
 *     Guardian offered fourteen candidates and all fourteen were buildings. Nothing on the page
 *     is the product, so better ranking cannot find one — a person has to look elsewhere.
 *
 * WHAT DOES NOT CHANGE is the gate. A URL somebody pasted in is not evidence; `classifyImage`
 * still has to come back `usable_for_3d` — bare product, single unit, right brand, right model,
 * clean ground — or the candidate is refused however promising it looked. That gate is the whole
 * reason a carton stopped being the 3D model of a bulb, and hand-feeding must not be a way round
 * it. Rejections are printed with what the model saw, so a bad candidate teaches something.
 *
 * Kept photographs land at position 6 beside the originals, and `image-content.json` and
 * `assets/3d/review.json` are updated exactly as the automatic path updates them.
 *
 * candidates.json:  { "CEM-ULT-PPC50": ["https://…/bag.jpg", "https://…/alt.png"], … }
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv } from '@buildobjects/db';
import sharp from 'sharp';
import { ASSETS_3D_DIR, env, REGISTRY_DIR } from '../src/config';
import { type BrandDomains, isRivalHost } from '../src/media/discover';
import { classifyImage, hasVision, type ProductIdentity } from '../src/media/vision';

loadEnv();

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: false,
  options: { from: { type: 'string' }, write: { type: 'boolean' } },
});

if (!hasVision()) {
  console.error('No vision key. Set BO_CHAT_API_KEY (or ANTHROPIC_API_KEY) in .env.');
  process.exit(1);
}
if (!values.from) {
  console.error('--from candidates.json is required.');
  process.exit(1);
}

const SOURCED_POSITION = 6;
const MIN_PX = 480;
const MAX_BYTES = 12_000_000;

const contentFile = path.join(REGISTRY_DIR, 'image-content.json');
const content = JSON.parse(fs.readFileSync(contentFile, 'utf8')) as {
  skus: Record<string, { brand: string; name: string; category: string; product_photo: number | null }>;
};
const reviewFile = path.join(ASSETS_3D_DIR, 'review.json');
const review = JSON.parse(fs.readFileSync(reviewFile, 'utf8')) as Record<string, Record<string, unknown>>;

const candidates = JSON.parse(fs.readFileSync(path.resolve(String(values.from)), 'utf8')) as Record<string, string[]>;

/*
 * The brand domain table, so the rival-host rule can be enforced here exactly as the automatic
 * sourcer enforces it. A URL a person pasted in is MORE likely to be a marketplace's, not less —
 * a search result is usually a reseller before it is the manufacturer — so this check matters
 * more on the hand-fed path, not less.
 */
/* One file per SKU, with `sku_code` at the top level — not a container holding a `skus` array.
   Getting that wrong made `brandSlugFor` return '' and `isRivalHost` refuse Dahua's own domain as
   a rival's, because no brand slug matched the one being excluded from the comparison. */
interface Curated {
  sku_code: string;
  brand: { slug: string; official_domains?: string[] };
}
const CURATED_DIR = path.join(REGISTRY_DIR, '..', 'data', 'curated');
const curated: Curated[] = [];
for (const cat of fs.readdirSync(CURATED_DIR)) {
  const dir = path.join(CURATED_DIR, cat);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) curated.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Curated);
}
const brands: BrandDomains[] = curated.map((c) => ({ slug: c.brand.slug, domains: c.brand.official_domains ?? [] }));
const brandSlugFor = (code: string): string => curated.find((c) => c.sku_code === code)?.brand.slug ?? '';

const imageDir = (code: string): string | null => {
  const root = path.join(env.mediaRoot, 'skus');
  for (const sh of fs.readdirSync(root)) {
    const dir = path.join(root, sh, code, 'img');
    if (fs.existsSync(dir)) return dir;
  }
  return null;
};

const found: Record<string, { url: string; why: string }> = {};

for (const [code, urls] of Object.entries(candidates)) {
  if (code.startsWith('_')) continue;
  const rec = content.skus[code];
  if (!rec) {
    console.log(`  ${code.padEnd(26)} not in image-content.json — skipped`);
    continue;
  }
  const dir = imageDir(code);
  if (!dir) {
    console.log(`  ${code.padEnd(26)} no media directory — skipped`);
    continue;
  }
  const identity: ProductIdentity = { sku: code, brand: rec.brand, name: rec.name, category: rec.category };
  console.log(`\n  ${code}  ${rec.brand} ${rec.name}`);

  let hit: { url: string; why: string } | null = null;
  let looked = 0;
  for (const url of urls) {
    if (hit) break;
    /* The same rule the automatic path enforces: never a competing catalogue's domain. */
    const rival = isRivalHost(url, brandSlugFor(code), brands);
    if (rival) {
      console.log(`     -- ${rival}'s domain, refused      ${url.slice(0, 60)}`);
      continue;
    }
    let buf: Buffer;
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', accept: 'image/*,*/*' },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        console.log(`     -- HTTP ${res.status}                      ${url.slice(-64)}`);
        continue;
      }
      const ab = await res.arrayBuffer();
      if (ab.byteLength > MAX_BYTES || ab.byteLength < 4096) {
        console.log(`     -- ${ab.byteLength} bytes, out of range   ${url.slice(-58)}`);
        continue;
      }
      buf = Buffer.from(ab);
    } catch (e) {
      console.log(`     -- fetch failed (${e instanceof Error ? e.message.slice(0, 34) : ''})  ${url.slice(-46)}`);
      continue;
    }
    let meta: sharp.Metadata;
    try {
      meta = await sharp(buf).metadata();
    } catch {
      console.log(`     -- not a readable image          ${url.slice(-62)}`);
      continue;
    }
    if (Math.max(meta.width ?? 0, meta.height ?? 0) < MIN_PX) {
      console.log(`     -- ${meta.width}x${meta.height}, under ${MIN_PX}px          ${url.slice(-52)}`);
      continue;
    }

    const tmp = path.join(dir, `.candidate-${SOURCED_POSITION}.tmp`);
    fs.writeFileSync(tmp, buf);
    looked++;
    try {
      const v = await classifyImage(tmp, identity, { hint: decodeURIComponent(url.split('/').pop() ?? '') });
      const tag = v.usable_for_3d ? 'USABLE' : v.wrong_model ? 'wrong_model' : v.shows;
      console.log(`     ${String(looked).padStart(2)}. ${tag.padEnd(20)} ${meta.width}x${meta.height}  ${v.why.slice(0, 62)}`);
      if (v.usable_for_3d) {
        if (values.write) {
          const ext = meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpg';
          fs.writeFileSync(path.join(dir, `${SOURCED_POSITION}-orig.${ext}`), buf);
        }
        hit = { url, why: v.why };
      }
    } catch (e) {
      console.log(`     ${String(looked).padStart(2)}. error  ${e instanceof Error ? e.message.slice(0, 70) : ''}`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  if (hit) {
    found[code] = hit;
    console.log(`  ${code.padEnd(26)} KEPT — ${hit.why.slice(0, 74)}`);
  } else console.log(`  ${code.padEnd(26)} nothing usable in ${looked} looked at`);
}

console.log(`\n${Object.keys(found).length} of ${Object.keys(candidates).filter((k) => !k.startsWith('_')).length} SKUs now have a product photograph.`);

if (values.write && Object.keys(found).length) {
  for (const [code, hit] of Object.entries(found)) {
    const rec = content.skus[code];
    if (rec) rec.product_photo = SOURCED_POSITION;
    void hit;
  }
  fs.writeFileSync(contentFile, `${JSON.stringify(content, null, 2)}\n`);

  const photos = (review.photos ?? {}) as Record<string, unknown>;
  const positions = (review.photo_positions ?? {}) as Record<string, unknown>;
  for (const code of Object.keys(found)) {
    delete photos[code];
    positions[code] = SOURCED_POSITION;
  }
  review.photos = photos;
  review.photo_positions = positions;
  fs.writeFileSync(reviewFile, `${JSON.stringify(review, null, 2)}\n`);
  console.log(`image-content.json and review.json updated — ${Object.keys(found).length} SKUs unblocked at position ${SOURCED_POSITION}.`);
}
