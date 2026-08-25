/**
 * `pnpm pipeline images:resource` — re-sources every SKU's photographs from its own brand.
 *
 * Reads the official product page the fetch stage captured, ranks the photographs on it,
 * downloads the best candidates, keeps the ones that are large enough and genuinely
 * different from each other, and writes the winners back into the curated file so the
 * choice is reviewable in git rather than hidden in a cache.
 *
 * It never invents an image. A role with no candidate that passes stays empty, is reported,
 * and the image stage renders its labelled placeholder — which is honest, where a rival's
 * product photograph was not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_ROLES, type ImageRole } from '@buildobjects/catalog';
import { CURATED_DIR, RAW_DIR, REGISTRY_DIR } from '../config';
import { listCurated } from '../providers/curated';
import { ACCEPT_IMAGE, download, head } from '../util/http';
import { type BrandDomains, type Candidate, discoverImages, fullSizeVariants, isRivalHost } from './discover';
import { inspect, MIN_SOURCE_WIDTH, SOFT_SOURCE_WIDTH, studioScore } from './images';

/* The floor and the soft threshold live in media/images.ts, so this pass cannot keep an image
   the ingest stage will then refuse. */
const MIN_WIDTH = SOFT_SOURCE_WIDTH;
const SOFT_WIDTH = MIN_SOURCE_WIDTH;
/** Downloading every candidate on a busy page is rude and pointless; the ranking earns its keep here. */
const MAX_DOWNLOADS = 18;
/**
 * How many images to gather before choosing the five that ship. Wider than the five roles so
 * a product shot the ranking put tenth still gets a hearing, and narrower than MAX_DOWNLOADS
 * so a page with a hundred assets is not trawled end to end.
 */
const CANDIDATE_POOL = 12;
/** What a flawless studio frame is worth against the discovery score — see the hero pick below. */
const STUDIO_WEIGHT = 60;
/** Stock libraries and marketplaces: real listings, but not the manufacturer's own photograph. */
const STOCK_OR_MARKETPLACE = /(unsplash|pexels|pixabay|shutterstock|istockphoto|gettyimages|imimg\.com|tistatic|media-amazon|flipkart|moglix|indiamart)/i;

export interface ResourceReport {
  sku: string;
  brand: string;
  kept: { role: ImageRole; url: string; width: number; height: number; why: string }[];
  empty: ImageRole[];
  rejected: { url: string; reason: string }[];
}

const bytesKey = (buf: Buffer): string => `${buf.length}`;

/**
 * Roles a person has pinned by hand, in registry/image-overrides.json, with the reason beside
 * them. Ranking gets most SKUs right; it cannot tell Vikram's M10 144-cell module from their
 * G12 120-cell one, and it cannot know that Dahua stopped publishing a photograph of a
 * discontinued camera. A `null` pins the role empty on purpose.
 */
type Overrides = Record<string, Record<string, string | null>>;
function loadOverrides(): Overrides {
  const file = path.join(REGISTRY_DIR, 'image-overrides.json');
  if (!fs.existsSync(file)) return {};
  return (JSON.parse(fs.readFileSync(file, 'utf8')).skus ?? {}) as Overrides;
}

export async function resourceImages(
  log: (s: string) => void = console.log,
  opts: { sku?: string; category?: string; write?: boolean } = {},
): Promise<ResourceReport[]> {
  const all = listCurated(opts.category);
  const overrides = loadOverrides();
  const brands: BrandDomains[] = all.map((c) => ({ slug: c.brand.slug, domains: c.brand.official_domains ?? [] }));
  const targets = opts.sku ? all.filter((c) => c.sku_code === opts.sku) : all;
  const reports: ResourceReport[] = [];

  for (const sku of targets) {
    const report: ResourceReport = { sku: sku.sku_code, brand: sku.brand.slug, kept: [], empty: [], rejected: [] };
    const pageFile = path.join(RAW_DIR, sku.sku_code, 'page.html');
    const pageUrl = sku.sources.official_product_url;

    /*
     * No captured page is not the end of the SKU. Wipro answers 429 to a robot and
     * Saint-Gobain 403, so the fetch stage has nothing to hand over — but the curated
     * fallback below can still find a dealer's photograph of the right product.
     */
    const hasPage = fs.existsSync(pageFile);
    if (!hasPage) report.rejected.push({ url: pageUrl, reason: 'the brand’s own page could not be captured (it refuses automated requests)' });

    const ranked = hasPage
      ? discoverImages({
          html: fs.readFileSync(pageFile, 'utf8'),
          pageUrl,
          brandSlug: sku.brand.slug,
          brandName: sku.brand.name,
          productName: sku.product.name,
          modelNo: sku.product.model_no,
          brands,
        })
      : [];

    // Download in rank order, keeping one image per role and skipping byte-identical repeats
    // (a page that shows the same photo in a carousel and a thumbnail strip is the norm).
    const seen = new Set<string>();
    const kept: { cand: Candidate; url: string; width: number; height: number; studio: number }[] = [];
    let tried = 0;
    let fallbacks = 0;
    let pins = 0;
    /*
     * Look past the first five that pass.
     *
     * Stopping as soon as five images cleared the floor meant the hero could only ever be one
     * of the first five the ranking happened to offer. UltraTech's page lists six identical
     * carousel photographs of a dam, a road and a skyline before it reaches the bag — the bag
     * is candidate ten, so it was never downloaded and never considered. Now a pool is
     * gathered first and the five that ship are chosen from it.
     */
    for (const cand of ranked) {
      if (kept.length >= CANDIDATE_POOL || tried >= MAX_DOWNLOADS) break;
      tried++;
      const got = await fetchLargest(cand.url, MIN_WIDTH, report);
      if (!got) continue;
      const fingerprint = bytesKey(got.buf);
      if (seen.has(fingerprint)) {
        report.rejected.push({ url: got.url, reason: 'byte-identical to an image already kept' });
        continue;
      }
      seen.add(fingerprint);
      kept.push({ cand, url: got.url, width: got.width, height: got.height, studio: await studioScore(got.buf) });
    }

    /*
     * Some manufacturers will not serve a robot at all — Wipro answers 429 and Saint-Gobain
     * 403 — so their own page yields nothing. Rather than drop those SKUs to a placeholder,
     * fall back to the URL a human already recorded, but only after it passes the same rival
     * test: a dealer's photograph of the right lamp is useful, a competitor's is not, and
     * that distinction is the whole point of this pass.
     */
    for (const previous of sku.images) {
      if (kept.length >= CANDIDATE_POOL) break;
      const url = previous.source_url;
      if (!url) continue;
      const rival = isRivalHost(url, sku.brand.slug, brands);
      if (rival) {
        report.rejected.push({ url, reason: `previously curated, but it is ${rival}'s domain — a competitor's product` });
        continue;
      }
      if (STOCK_OR_MARKETPLACE.test(url)) {
        report.rejected.push({ url, reason: 'previously curated, but a stock library or marketplace listing' });
        continue;
      }
      const got = await fetchLargest(url, MIN_WIDTH, report);
      if (!got || seen.has(bytesKey(got.buf))) continue;
      seen.add(bytesKey(got.buf));
      kept.push({
        cand: { url: got.url, origin: 'img', score: 0, why: ['kept from the curated file: the brand’s own page refused us'] },
        ...got,
        studio: await studioScore(got.buf),
      });
      fallbacks++;
    }

    /*
     * The hero is the best blend of "names this product" and "looks like a product shot".
     *
     * Neither signal works alone. Filename ranking put a photograph of a glazed building at
     * the top for three glass SKUs and a city skyline for UltraTech. Studio-likeness alone is
     * worse in a different way: CP Plus also sell routers, and a router on a white sweep
     * outscores their own camera, so the camera SKU led with a router. STUDIO_WEIGHT puts a
     * perfect studio shot on the same footing as a filename that carries the model number
     * (+60), so a strong name still wins and a weak one is broken by how the frame looks.
     */
    if (kept.length > 1) {
      const heroRank = (k: (typeof kept)[number]) => k.cand.score + STUDIO_WEIGHT * k.studio;
      const best = kept.reduce((a, b) => (heroRank(b) > heroRank(a) ? b : a));
      kept.splice(kept.indexOf(best), 1);
      kept.unshift(best);
    }
    // The rest keep the page's own order; only the first IMAGE_ROLES.length of them ship.
    kept.length = Math.min(kept.length, IMAGE_ROLES.length);

    /*
     * Roles are assigned before the pins are applied, and a pin replaces one role in place.
     * Splicing the array instead shifted every later image up a slot, so pinning Dahua's hero
     * empty promoted a category navigation thumbnail into the hero rather than leaving it
     * empty — the opposite of what the pin asked for.
     */
    const byRole = new Map<ImageRole, (typeof kept)[number] | null>(IMAGE_ROLES.map((role, i) => [role, kept[i] ?? null]));

    for (const [role, url] of Object.entries(overrides[sku.sku_code] ?? {})) {
      if (!(IMAGE_ROLES as readonly string[]).includes(role)) continue;
      if (url === null) {
        byRole.set(role as ImageRole, null);
        report.rejected.push({
          url: `(${role})`,
          reason: 'pinned empty in registry/image-overrides.json — the brand publishes no photograph of this product',
        });
        pins++;
        continue;
      }
      const rival = isRivalHost(url, sku.brand.slug, brands);
      if (rival) {
        report.rejected.push({ url, reason: `pinned in image-overrides.json, but it is ${rival}'s domain — refused` });
        continue;
      }
      const got = await fetchLargest(url, MIN_WIDTH, report);
      if (!got) continue;
      byRole.set(role as ImageRole, {
        cand: { url: got.url, origin: 'img', score: 0, why: ['pinned in registry/image-overrides.json'] },
        ...got,
        studio: await studioScore(got.buf),
      });
      pins++;
    }

    for (const role of IMAGE_ROLES) {
      const hit = byRole.get(role);
      if (!hit) {
        report.empty.push(role);
        continue;
      }
      const soft = hit.width < SOFT_WIDTH ? ` (soft: ${hit.width}px, zoom hidden)` : '';
      report.kept.push({
        role,
        url: hit.url,
        width: hit.width,
        height: hit.height,
        why: `${hit.cand.why.join('; ') || 'on the brand’s own page'}${soft} · studio ${hit.studio.toFixed(2)}`,
      });
    }

    if (opts.write) writeCuratedImages(sku.category, sku.sku_code, report);
    reports.push(report);
    log(
      `  ${sku.sku_code.padEnd(26)} ${String(report.kept.length).padStart(2)}/${IMAGE_ROLES.length} from ${new URL(pageUrl).hostname}` +
        `${pins ? ` · ${pins} pinned` : ''}${fallbacks ? ` · ${fallbacks} from a dealer` : ''}${report.empty.length ? ` · ${report.empty.length} empty` : ''}` +
        ` · ${ranked.length} candidates, ${tried} fetched`,
    );
  }
  return reports;
}

/**
 * Download one candidate at the largest size its CDN will give up.
 *
 * Tries the un-resized variant of the URL before the URL the page wrote, because a page that
 * renders a 49-pixel Wix thumbnail is still holding the full photograph one path segment away.
 * Returns null and records why when nothing clears the floor.
 */
async function fetchLargest(url: string, floor: number, report: ResourceReport): Promise<{ buf: Buffer; url: string; width: number; height: number } | null> {
  let best: { buf: Buffer; url: string; width: number; height: number } | null = null;
  let reason = 'unreachable';
  for (const variant of fullSizeVariants(url)) {
    try {
      const h = await head(variant, { accept: ACCEPT_IMAGE });
      if (!h.ok || !(/^image\//.test(h.contentType) || /\.(jpe?g|png|webp|avif)(\?|$)/i.test(variant))) {
        reason = `not an image (${h.status} ${h.contentType || 'no type'})`;
        continue;
      }
      const d = await download(variant, { accept: ACCEPT_IMAGE, maxBytes: 40 * 1024 * 1024 });
      const meta = await inspect(d.buf);
      if (!meta) {
        reason = 'undecodable';
        continue;
      }
      if (!best || meta.width > best.width) best = { buf: d.buf, url: variant, width: meta.width, height: meta.height };
      // The first variant is the un-resized one; if it cleared the floor there is nothing better to find.
      if (best.width >= floor) return best;
    } catch (e) {
      reason = (e as Error).message.slice(0, 120);
    }
  }
  if (best) reason = `${best.width}×${best.height} — under the ${floor}px floor for this slot`;
  report.rejected.push({ url, reason });
  return null;
}

/** Rewrite the `images` array of a curated file in place, keeping every other field untouched. */
function writeCuratedImages(category: string, skuCode: string, report: ResourceReport): void {
  const file = path.join(CURATED_DIR, category, `${skuCode}.json`);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    images: { role: string; source_url: string | null; alt: string; content_type?: string; checked?: boolean }[];
    product: { name: string };
    brand: { name: string };
  };
  const byRole = new Map(report.kept.map((k) => [k.role, k]));
  doc.images = IMAGE_ROLES.map((role) => {
    const hit = byRole.get(role);
    const previous = doc.images.find((i) => i.role === role);
    return {
      role,
      source_url: hit?.url ?? null,
      alt: previous?.alt ?? `${doc.brand.name} ${doc.product.name} — ${role.replace(/_/g, ' ')}`,
      content_type: 'image/jpeg',
      checked: !!hit,
    };
  });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}

/** Printable summary: how many of the 27 × 5 slots a real, on-brand photograph now fills. */
export function printResourceSummary(reports: ResourceReport[]): string {
  const slots = reports.length * IMAGE_ROLES.length;
  const filled = reports.reduce((n, r) => n + r.kept.length, 0);
  const heroes = reports.filter((r) => r.kept.some((k) => k.role === 'hero')).length;
  const thin = reports.filter((r) => r.kept.length < 3);
  const lines = [
    `${filled}/${slots} image slots filled from the brand's own page (${Math.round((100 * filled) / slots)}%)`,
    `${heroes}/${reports.length} SKUs have a hero`,
  ];
  if (thin.length) lines.push(`under three images: ${thin.map((r) => `${r.sku} (${r.kept.length})`).join(', ')}`);
  return lines.join('\n');
}
