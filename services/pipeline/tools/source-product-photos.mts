/**
 * `npx tsx services/pipeline/tools/source-product-photos.mts [--only SKU,SKU] [--limit N] [--write]`
 *
 * Finds a photograph of the PRODUCT for the SKUs that have none, and proves it is one before
 * keeping it.
 *
 * `classify-images.mts` reads the five pictures already in the catalogue and, for eighteen of the
 * twenty-seven SKUs, finds no bare single correctly-branded unit among them — cartons, rival
 * brands' sacks, a WiFi router, marketing banners, an empty field. Those eighteen have nothing a
 * 3D model can honestly be built from, and no amount of gating fixes that; something has to go
 * and find a better picture.
 *
 * The machinery for finding one already exists. `discoverImages()` ranks the photographs on a
 * captured brand page, favouring what the page nominates as its own subject (og:image, JSON-LD)
 * and refusing rival domains, stock libraries and marketplaces. What it never had was a way to
 * tell whether the thing it ranked first is the product or the box it came in — the same gap the
 * 3D manifest records as "judge skipped — no vision assist wired".
 *
 * So this walks the ranked candidates and asks the vision model about each one, keeping the first
 * that comes back as a bare, single, correctly-branded unit. A candidate that is the carton is
 * rejected however highly the page ranked it, which is the entire point: ranking knows what a
 * page thinks is important, and only looking knows what is in the frame.
 *
 * Kept photographs are written as position 6 — beside the originals rather than over them, so
 * nothing already shipped is lost and the two can be compared.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv } from '@buildobjects/db';
import sharp from 'sharp';
import { ASSETS_3D_DIR, env, RAW_DIR, REGISTRY_DIR } from '../src/config';
import { type BrandDomains, type Candidate, discoverImages, isRivalHost } from '../src/media/discover';
import { classifyImage, hasVision, type ProductIdentity } from '../src/media/vision';

loadEnv();

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: false,
  options: { only: { type: 'string' }, limit: { type: 'string' }, write: { type: 'boolean' } },
});
const only = String(values.only ?? '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
/** How many ranked candidates to look at per SKU before giving up. */
const LIMIT = Number(values.limit ?? 14);
/** The position sourced photographs are written to, beside the five the catalogue already has. */
const SOURCED_POSITION = 6;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_BYTES = 12 * 1024 * 1024;
/** Below this on the long edge a photograph cannot carry a model or a texture. */
const MIN_PX = 500;
/**
 * Social-share furniture. An og:image is the page's nomination of its own subject, which is why
 * `discoverImages` ranks it first — but a 1200x627 share card is a letterboxed banner with the
 * product small in the middle and white bars above and below. Trimble's passed every content
 * check (it really is one bare C5 total station) and is still the wrong file to cut out.
 */
const SHARE_CARD = /(opengraph|og[-_]image|og[-_]default|social|share[-_]|twitter[-_]card|banner)/i;
/**
 * How oblong a photograph may be before it is a banner rather than a product shot — for products
 * that are not themselves oblong. A panel, a pane and a tile ARE long, so they are exempt.
 */
const MAX_ASPECT = 1.85;
const LONG_PRODUCTS = new Set(['solar-panels', 'glass', 'tiles']);

if (!hasVision()) {
  console.error('No vision key. Set BO_CHAT_API_KEY (or ANTHROPIC_API_KEY) in .env.');
  process.exit(1);
}

interface Curated {
  sku_code: string;
  category: string;
  brand: { slug: string; name: string; official_domains?: string[] };
  product: { name: string; model_no?: string | null };
  sources: { official_product_url: string };
}

const CURATED_DIR = path.join(REGISTRY_DIR, '..', 'data', 'curated');
const curated: Curated[] = [];
for (const cat of fs.readdirSync(CURATED_DIR)) {
  const dir = path.join(CURATED_DIR, cat);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) curated.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Curated);
}
const brands: BrandDomains[] = curated.map((c) => ({ slug: c.brand.slug, domains: c.brand.official_domains ?? [] }));

const contentFile = path.join(REGISTRY_DIR, 'image-content.json');
const content = JSON.parse(fs.readFileSync(contentFile, 'utf8')) as {
  skus: Record<string, { product_photo: number | null; why: string; positions: Record<string, unknown> }>;
};

const imageDir = (code: string): string | null => {
  const root = path.join(env.mediaRoot, 'skus');
  for (const sh of fs.readdirSync(root)) {
    const dir = path.join(root, sh, code, 'img');
    if (fs.existsSync(dir)) return dir;
  }
  return null;
};

const needs = curated
  .filter((c) => (content.skus[c.sku_code]?.product_photo ?? null) === null)
  .filter((c) => !only.length || only.includes(c.sku_code))
  .sort((a, b) => a.sku_code.localeCompare(b.sku_code));

console.log(`${needs.length} SKUs with no product photograph; up to ${LIMIT} candidates each.\n`);

const found: Record<string, { url: string; why: string }> = {};

for (const sku of needs) {
  const pageFile = path.join(RAW_DIR, sku.sku_code, 'page.html');
  if (!fs.existsSync(pageFile)) {
    console.log(`  ${sku.sku_code.padEnd(26)} no captured page`);
    continue;
  }
  const ranked: Candidate[] = discoverImages({
    html: fs.readFileSync(pageFile, 'utf8'),
    pageUrl: sku.sources.official_product_url,
    brandSlug: sku.brand.slug,
    brandName: sku.brand.name,
    productName: sku.product.name,
    modelNo: sku.product.model_no ?? null,
    brands,
  });
  const identity: ProductIdentity = { sku: sku.sku_code, brand: sku.brand.name, name: sku.product.name, category: sku.category };
  const dir = imageDir(sku.sku_code);
  if (!dir) {
    console.log(`  ${sku.sku_code.padEnd(26)} no media directory`);
    continue;
  }

  let looked = 0;
  let hit: { url: string; why: string } | null = null;
  const seen = new Set<string>();
  for (const cand of ranked) {
    if (looked >= LIMIT) break;
    if (seen.has(cand.url)) continue;
    seen.add(cand.url);
    const rival = isRivalHost(cand.url, sku.brand.slug, brands);
    if (rival) continue;
    if (SHARE_CARD.test(cand.url)) continue;
    let buf: Buffer;
    try {
      const res = await fetch(cand.url, { headers: { 'user-agent': UA, referer: sku.sources.official_product_url }, signal: AbortSignal.timeout(25_000) });
      if (!res.ok) continue;
      const ab = await res.arrayBuffer();
      if (ab.byteLength > MAX_BYTES || ab.byteLength < 4096) continue;
      buf = Buffer.from(ab);
    } catch {
      continue;
    }
    let meta: sharp.Metadata;
    try {
      meta = await sharp(buf).metadata();
    } catch {
      continue;
    }
    if (Math.max(meta.width ?? 0, meta.height ?? 0) < MIN_PX) continue;
    const aspect = (meta.width ?? 1) / (meta.height ?? 1);
    if (!LONG_PRODUCTS.has(sku.category) && (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT)) continue;

    /* Written to a scratch file because the classifier reads from disk and caches on the bytes —
       so a candidate seen twice across runs costs one call, not two. */
    const tmp = path.join(dir, `.candidate-${SOURCED_POSITION}.tmp`);
    fs.writeFileSync(tmp, buf);
    looked++;
    try {
      const v = await classifyImage(tmp, identity, { hint: decodeURIComponent(cand.url.split('/').pop() ?? '') });
      const tag = v.usable_for_3d ? 'USABLE' : v.wrong_model ? 'wrong_model' : v.shows;
      console.log(`     ${String(looked).padStart(2)}. ${tag.padEnd(20)} ${cand.url.slice(-64)}`);
      if (v.usable_for_3d) {
        if (values.write) {
          const ext = meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpg';
          fs.writeFileSync(path.join(dir, `${SOURCED_POSITION}-orig.${ext}`), buf);
        }
        hit = { url: cand.url, why: v.why };
        break;
      }
    } catch (e) {
      console.log(`     ${String(looked).padStart(2)}. error  ${e instanceof Error ? e.message.slice(0, 70) : ''}`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  if (hit) {
    found[sku.sku_code] = hit;
    console.log(`  ${sku.sku_code.padEnd(26)} FOUND after ${looked} — ${hit.why.slice(0, 80)}`);
  } else console.log(`  ${sku.sku_code.padEnd(26)} nothing usable in ${looked} candidates`);
}

console.log(`\n${Object.keys(found).length} of ${needs.length} SKUs now have a product photograph.`);

if (values.write && Object.keys(found).length) {
  for (const [code, hit] of Object.entries(found)) {
    const rec = content.skus[code];
    if (!rec) continue;
    rec.product_photo = SOURCED_POSITION;
    rec.why = `sourced from the brand's own page: ${hit.why}`;
    (rec as unknown as Record<string, unknown>).sourced_from = hit.url;
  }
  fs.writeFileSync(contentFile, `${JSON.stringify(content, null, 2)}\n`);

  const reviewFile = path.join(ASSETS_3D_DIR, 'review.json');
  const review = JSON.parse(fs.readFileSync(reviewFile, 'utf8')) as Record<string, unknown>;
  const photos = review.photos as Record<string, string>;
  const positions = review.photo_positions as Record<string, number | string>;
  for (const code of Object.keys(found)) {
    delete photos[code];
    positions[code] = SOURCED_POSITION;
  }
  fs.writeFileSync(reviewFile, `${JSON.stringify(review, null, 2)}\n`);
  console.log(`image-content.json and review.json updated — ${Object.keys(found).length} SKUs unblocked at position ${SOURCED_POSITION}.`);
}
