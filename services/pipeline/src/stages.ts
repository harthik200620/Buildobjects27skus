/**
 * The seven per-SKU stages. Each takes the SkuWork context, mutates it, and persists what it
 * produced. Stages are idempotent by sku_code + content hash so `--resume` can skip them.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { type AttributeValue, brandLogoKey, type CuratedSku, docKey, IMAGE_ROLES, type ImageRole, type Registry } from '@buildobjects/catalog';
import {
  attributes as attributesTable,
  brands,
  categories,
  getDb,
  gstRates,
  products,
  skuAttributeValues,
  skuDocuments,
  skuImages,
  skus,
} from '@buildobjects/db';
import { eq } from 'drizzle-orm';
import { env, RAW_DIR } from './config';
import { type BrandDomains, isRivalHost } from './media/discover';
import { deriveRenditions, inspect, MIN_SOURCE_WIDTH, renderPlaceholder, SOFT_SOURCE_WIDTH, studioScore } from './media/images';
import { mediaStore } from './media/store';
import { llm } from './providers';
import { ACCEPT_IMAGE, download, head, slugify } from './util/http';

export interface SkuWork {
  code: string;
  curated: CuratedSku;
  registry: Registry;
  ids: { categoryId: number; brandId: number; productId: number; skuId: number };
  raw: { pageText: string; pdfText: string; pdfUrl: string | null; secondaryText: string; secondaryUrl: string; fetched: boolean };
  values: Record<string, AttributeValue>;
  log: (msg: string) => void;
  notes: string[];
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

/* ── skeleton rows: brand / product / sku exist before any stage writes ─────── */
export async function ensureRows(c: CuratedSku, log: (s: string) => void): Promise<SkuWork['ids']> {
  const db = getDb();
  const [cat] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, c.category));
  if (!cat) throw new Error(`category ${c.category} not seeded — run pnpm registry:seed`);
  await db
    .insert(brands)
    .values({
      slug: c.brand.slug,
      code: c.sku_code.split('-')[1],
      name: c.brand.name,
      officialDomains: c.brand.official_domains,
      intel: c.brand.intel as never,
    })
    .onDuplicateKeyUpdate({ set: { name: c.brand.name, officialDomains: c.brand.official_domains, intel: c.brand.intel as never } });
  const [brand] = await db.select({ id: brands.id, logoKey: brands.logoKey }).from(brands).where(eq(brands.slug, c.brand.slug));
  if (!brand.logoKey && c.brand.logo_url) {
    try {
      const { buf, contentType } = await download(c.brand.logo_url, { timeoutMs: 15_000, maxBytes: 5 * 1024 * 1024 });
      const ext =
        /svg/.test(contentType) || c.brand.logo_url.endsWith('.svg') ? 'svg' : /png/.test(contentType) ? 'png' : /webp/.test(contentType) ? 'webp' : 'jpg';
      const key = brandLogoKey(c.brand.slug, ext);
      await mediaStore().put(key, buf, contentType || 'image/png');
      await db.update(brands).set({ logoKey: key }).where(eq(brands.id, brand.id));
      log(`logo stored for ${c.brand.name}`);
    } catch (e) {
      log(`logo skipped (${(e as Error).message})`);
    }
  }
  await db
    .insert(products)
    .values({
      categoryId: cat.id,
      brandId: brand.id,
      name: c.product.name,
      slug: c.product.slug,
      modelNo: c.product.model_no ?? null,
      status: c.product.status,
    })
    .onDuplicateKeyUpdate({ set: { name: c.product.name, modelNo: c.product.model_no ?? null, status: c.product.status } });
  const [prod] = await db.select({ id: products.id }).from(products).where(eq(products.slug, c.product.slug));

  const [gst] = await db.select().from(gstRates).where(eq(gstRates.categorySlug, c.category));
  const gstRate = gst ? Number(gst.rate) : c.gst_rate;
  const gstFlag = gst ? gst.needsVerification : true;
  if (gst && Number(gst.rate) !== c.gst_rate) log(`gst: curated ${c.gst_rate}% overridden by gst_rates table ${gstRate}%`);
  const price = c.price;
  const selling = price.selling_price ?? price.mrp;
  const values = {
    productId: prod.id,
    categoryId: cat.id,
    skuCode: c.sku_code,
    variantLabel: c.variant_label,
    unit: c.unit,
    packQty: String(c.pack_qty),
    mrp: price.mrp !== null ? String(price.mrp) : null,
    sellingPrice: selling !== null ? String(selling) : null,
    priceProvenance: price.provenance,
    priceSourceUrl: price.source_url ?? null,
    priceNote: price.note?.slice(0, 255) ?? null,
    priceFetchedAt: price.fetched_at ? new Date(price.fetched_at) : new Date(),
    gstRate: String(gstRate),
    gstNeedsVerification: gstFlag,
    officialUrl: c.sources.official_product_url,
    shortDescription: c.short_description.slice(0, 200),
    seo: c.seo as never,
  };
  await db.insert(skus).values(values).onDuplicateKeyUpdate({ set: values });
  const [sku] = await db.select({ id: skus.id }).from(skus).where(eq(skus.skuCode, c.sku_code));
  return { categoryId: cat.id, brandId: brand.id, productId: prod.id, skuId: sku.id };
}

/* ── 1. fetch: raw capture for the audit trail (best effort, never fatal) ────── */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  try {
    const mod = await import('pdf-parse/lib/pdf-parse.js' as string);
    const parse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string; numpages: number }>;
    const r = await parse(buf);
    return { text: r.text ?? '', pages: r.numpages ?? 0 };
  } catch (_e) {
    return { text: '', pages: 0 };
  }
}
async function renderedText(url: string): Promise<string | null> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BuildObjectsBot/1.0' });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: env.fetchTimeoutMs });
      await page.waitForTimeout(1500);
      return await page.evaluate(() => document.body?.innerText ?? '');
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}
export async function stageFetch(w: SkuWork) {
  const dir = path.join(RAW_DIR, w.code);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  const url = w.curated.sources.official_product_url;
  try {
    const { buf, contentType } = await download(url, { accept: 'text/html,application/xhtml+xml' });
    const html = buf.toString('utf8');
    fs.writeFileSync(path.join(dir, 'page.html'), html);
    let text = htmlToText(html);
    if (text.length < 600 && /text\/html/.test(contentType)) {
      const r = await renderedText(url);
      if (r && r.length > text.length) text = r;
    }
    fs.writeFileSync(path.join(dir, 'page.txt'), text);
    w.raw.pageText = text;
    w.raw.fetched = true;
    w.log(`page captured (${text.length} chars)`);
  } catch (e) {
    w.log(`page capture failed: ${(e as Error).message}`);
  }
  const pdfUrls = [...w.curated.sources.datasheet_urls, ...w.curated.documents.map((d) => d.source_url)]
    .filter((u, i, a) => u && a.indexOf(u) === i)
    .slice(0, 3);
  for (const pdfUrl of pdfUrls) {
    try {
      const { buf } = await download(pdfUrl, { accept: 'application/pdf' });
      if (!buf.subarray(0, 5).toString().startsWith('%PDF')) throw new Error('not a PDF');
      fs.writeFileSync(path.join(dir, 'docs', `${slugify(path.basename(new URL(pdfUrl).pathname)) || 'doc'}.pdf`), buf);
      const { text } = await pdfText(buf);
      if (text.length > w.raw.pdfText.length) {
        w.raw.pdfText = text;
        w.raw.pdfUrl = pdfUrl;
      }
      w.log(`datasheet captured (${text.length} chars)`);
    } catch (e) {
      w.log(`datasheet skipped: ${(e as Error).message}`);
    }
  }
  const sec = w.curated.sources.secondary_urls[0];
  if (sec) {
    try {
      const { buf } = await download(sec, { accept: 'text/html' });
      w.raw.secondaryText = htmlToText(buf.toString('utf8'));
      w.raw.secondaryUrl = sec;
      fs.writeFileSync(path.join(dir, 'secondary.txt'), w.raw.secondaryText);
    } catch (e) {
      w.log(`secondary skipped: ${(e as Error).message}`);
    }
  }
}

/* ── 2–4. extract / verify / fill ──────────────────────────────────────────── */
export async function stageExtract(w: SkuWork) {
  const p = llm();
  const values = await p.extract({
    ...ctx(w),
    registry: w.registry,
    pageText: w.raw.pageText,
    pdfText: w.raw.pdfText,
    sourceUrl: w.curated.sources.official_product_url,
    pdfUrl: w.raw.pdfUrl,
  });
  w.values = { ...w.values, ...values };
  await persistValues(w);
  w.log(`${Object.keys(values).length} attributes via ${p.name}`);
}
export async function stageVerify(w: SkuWork) {
  const p = llm();
  const { values, conflicts } = await p.verify({
    ...ctx(w),
    registry: w.registry,
    values: w.values,
    secondaryText: w.raw.secondaryText,
    secondaryUrl: w.raw.secondaryUrl,
  });
  w.values = values;
  for (const c of conflicts)
    w.notes.push(`conflict ${c.key}: official ${JSON.stringify(c.official)} vs secondary ${JSON.stringify(c.secondary)} — kept official`);
  await persistValues(w);
  const verified = Object.values(values).filter((v) => v.provenance === 'verified').length;
  w.log(`${verified} verified, ${conflicts.length} conflicts (${p.name})`);
}
export async function stageFill(w: SkuWork) {
  const p = llm();
  const before = Object.keys(w.values).length;
  w.values = await p.fill({ ...ctx(w), registry: w.registry, values: w.values });
  await persistValues(w);
  w.log(`${Object.keys(w.values).length - before} gaps filled (${p.name}); ${Object.keys(w.values).length}/${w.registry.attributes.length} populated`);
}
function ctx(w: SkuWork) {
  return {
    skuCode: w.code,
    category: w.curated.category,
    brand: w.curated.brand.name,
    productName: w.curated.product.name,
    variant: w.curated.variant_label,
    officialUrl: w.curated.sources.official_product_url,
  };
}

async function persistValues(w: SkuWork) {
  const db = getDb();
  const attrs = await db
    .select({ id: attributesTable.id, key: attributesTable.key, dataType: attributesTable.dataType })
    .from(attributesTable)
    .where(eq(attributesTable.categoryId, w.ids.categoryId));
  const byKey = new Map(attrs.map((a) => [a.key, a]));
  for (const [key, v] of Object.entries(w.values)) {
    const a = byKey.get(key);
    if (!a || v.value === null) continue;
    const row = {
      skuId: w.ids.skuId,
      attributeId: a.id,
      valueText: a.dataType === 'number' || a.dataType === 'boolean' ? null : String(v.value).slice(0, 1024),
      valueNumber:
        a.dataType === 'number'
          ? typeof v.value === 'number'
            ? String(v.value)
            : Number.isFinite(parseFloat(String(v.value)))
              ? String(parseFloat(String(v.value)))
              : null
          : null,
      valueBool: a.dataType === 'boolean' ? (typeof v.value === 'boolean' ? v.value : /^(yes|true|1)$/i.test(String(v.value))) : null,
      unitOverride: v.unit ?? null,
      provenance: v.provenance,
      confidence: v.confidence !== undefined ? String(Math.round(v.confidence * 100) / 100) : null,
      sourceUrl: v.source_url ?? v.source_urls?.[0] ?? null,
      fetchedAt: new Date(),
      /* For a derived value this is the formula, and it is the only thing that makes the
         number auditable on the page. */
      note: v.note ? String(v.note).slice(0, 512) : null,
    };
    if (a.dataType === 'number' && row.valueNumber === null) row.valueText = String(v.value).slice(0, 1024);
    await db.insert(skuAttributeValues).values(row).onDuplicateKeyUpdate({ set: row });
  }
}

/* ── 5. images ──────────────────────────────────────────────────────────────── */
export async function stageImages(w: SkuWork) {
  const db = getDb();
  const byRole = new Map(w.curated.images.map((i) => [i.role, i]));
  /* `images:resource` already refuses a rival's photograph, but a curated file can be edited
     by hand and this is the last gate before a competitor's bag is served as UltraTech's. */
  const rivals: BrandDomains[] = await db
    .select({ slug: brands.slug, domains: brands.officialDomains })
    .from(brands)
    .then((rows) => rows.map((r) => ({ slug: r.slug, domains: (r.domains as string[] | null) ?? [] })));
  let placeholders = 0,
    soft = 0;
  const results: { position: number; role: ImageRole; key: string; blurhash: string }[] = [];
  for (let i = 0; i < IMAGE_ROLES.length; i++) {
    const role = IMAGE_ROLES[i];
    const position = i + 1;
    const cand = byRole.get(role);
    let buf: Buffer | null = null,
      sourceUrl: string | null = null,
      placeholder = false;
    const rival = cand?.source_url ? isRivalHost(cand.source_url, w.curated.brand.slug, rivals) : null;
    if (rival) {
      w.notes.push(`image ${position} (${role}) refused: ${new URL(cand!.source_url!).hostname} belongs to ${rival}, not ${w.curated.brand.slug}`);
    } else if (cand?.source_url) {
      try {
        const h = await head(cand.source_url, { accept: ACCEPT_IMAGE });
        if (/svg/i.test(h.contentType) || /\.svg(\?|$)/i.test(cand.source_url))
          w.notes.push(`image ${position} (${role}) is an SVG — not a product photograph; placeholder used`);
        else if (h.ok && (/^image\//.test(h.contentType) || /\.(jpe?g|png|webp|avif)(\?|$)/i.test(cand.source_url))) {
          const d = await download(cand.source_url, { accept: ACCEPT_IMAGE, maxBytes: 40 * 1024 * 1024 });
          const meta = await inspect(d.buf);
          if (meta && meta.width >= SOFT_SOURCE_WIDTH) {
            buf = d.buf;
            sourceUrl = cand.source_url;
            if (meta.width < MIN_SOURCE_WIDTH) {
              soft++;
              w.notes.push(`image ${position} (${role}) is ${meta.width}px wide — below the 1200 px zoom rule; re-source for crisp zoom`);
            }
          } else
            w.notes.push(
              `image ${position} (${role}) rejected: ${meta ? `${meta.width}px, under the ${SOFT_SOURCE_WIDTH}px floor` : 'unreadable'} — placeholder used`,
            );
        } else w.notes.push(`image ${position} (${role}) unreachable (${h.status} ${h.contentType}) — placeholder used`);
      } catch (e) {
        w.notes.push(`image ${position} (${role}) failed: ${(e as Error).message} — placeholder used`);
      }
    }
    if (!buf) {
      buf = await renderPlaceholder({ skuCode: w.code, brand: w.curated.brand.name, name: w.curated.product.name, role });
      placeholder = true;
      placeholders++;
    }
    let processed: Awaited<ReturnType<typeof deriveRenditions>>;
    try {
      processed = await deriveRenditions(w.code, position, buf, { placeholder });
    } catch (e) {
      // A source sharp cannot decode (corrupt header, exotic container) must never fail the SKU — fall back to the flagged placeholder.
      if (placeholder) throw e;
      w.notes.push(`image ${position} (${role}) could not be processed (${(e as Error).message.split('\n')[0].slice(0, 120)}) — placeholder used`);
      buf = await renderPlaceholder({ skuCode: w.code, brand: w.curated.brand.name, name: w.curated.product.name, role });
      placeholder = true;
      placeholders++;
      sourceUrl = null;
      processed = await deriveRenditions(w.code, position, buf, { placeholder });
    }
    const row = {
      skuId: w.ids.skuId,
      position,
      role,
      /* How much this reads as a product shot rather than a scene. `sku_images.quality_score`
         was declared and indexed by images v2 and never written; the category tile picker
         orders by it, which is how Cement stopped showing a photograph of a city skyline. */
      qualityScore: placeholder ? '0.00' : (await studioScore(buf)).toFixed(2),
      alt: (cand?.alt || `${w.curated.brand.name} ${w.curated.product.name} — ${role.replace(/_/g, ' ')}`).slice(0, 255),
      sourceUrl,
      width: processed.width,
      height: processed.height,
      blurhash: processed.blurhash,
      storageKeyOriginal: processed.originalKey,
      placeholder,
    };
    await db.insert(skuImages).values(row).onDuplicateKeyUpdate({ set: row });
    results.push({ position, role, key: processed.keys.card, blurhash: processed.blurhash });
  }
  const hero = results[0];
  await db.update(skus).set({ heroImageKey: hero.key, blurhash: hero.blurhash }).where(eq(skus.id, w.ids.skuId));
  w.log(`${5 - placeholders}/5 real images${soft ? ` (${soft} soft)` : ''}, ${placeholders} placeholders`);
}

/* ── 6. brochures ───────────────────────────────────────────────────────────── */
export async function stageBrochures(w: SkuWork) {
  const db = getDb();
  const store = mediaStore();
  await db.delete(skuDocuments).where(eq(skuDocuments.skuId, w.ids.skuId));
  let n = 0;
  for (const d of w.curated.documents) {
    try {
      const { buf } = await download(d.source_url, { accept: 'application/pdf', maxBytes: 60 * 1024 * 1024 });
      if (!buf.subarray(0, 5).toString().startsWith('%PDF')) throw new Error('not a PDF');
      const { pages } = await pdfText(buf);
      const key = docKey(w.code, slugify(d.title) || d.type);
      await store.put(key, buf, 'application/pdf');
      await db.insert(skuDocuments).values({
        skuId: w.ids.skuId,
        type: d.type,
        title: d.title.slice(0, 200),
        storageKey: key,
        sourceUrl: d.source_url,
        pages,
        sizeKb: Math.round(buf.length / 1024),
      });
      n++;
    } catch (e) {
      w.notes.push(`document "${d.title}" skipped: ${(e as Error).message}`);
    }
  }
  w.log(`${n}/${w.curated.documents.length} documents stored`);
}

/* ── 7. describe ────────────────────────────────────────────────────────────── */
export async function stageDescribe(w: SkuWork) {
  const p = llm();
  const copy = await p.describe({ ...ctx(w), registry: w.registry, values: w.values });
  await getDb()
    .update(skus)
    .set({
      shortDescription: copy.short_description.slice(0, 200),
      longDescription: copy.long_description,
      seo: { ...copy.seo, key_specs_order: copy.key_specs } as never,
    })
    .where(eq(skus.id, w.ids.skuId));
  w.log(`copy written (${copy.long_description.split(/\s+/).length} words, ${p.name})`);
}

/** Content hash used for resume: curated file + registry version. */
export function workHash(c: CuratedSku, registry: Registry): string {
  return sha(JSON.stringify(c) + registry.version);
}

export async function loadExistingValues(w: SkuWork) {
  const db = getDb();
  const rows = await db
    .select({
      key: attributesTable.key,
      dataType: attributesTable.dataType,
      unit: attributesTable.unit,
      vt: skuAttributeValues.valueText,
      vn: skuAttributeValues.valueNumber,
      vb: skuAttributeValues.valueBool,
      prov: skuAttributeValues.provenance,
      conf: skuAttributeValues.confidence,
      src: skuAttributeValues.sourceUrl,
      uo: skuAttributeValues.unitOverride,
    })
    .from(skuAttributeValues)
    .innerJoin(attributesTable, eq(skuAttributeValues.attributeId, attributesTable.id))
    .where(eq(skuAttributeValues.skuId, w.ids.skuId));
  for (const r of rows) {
    const value = r.dataType === 'number' ? (r.vn !== null ? Number(r.vn) : r.vt) : r.dataType === 'boolean' ? r.vb : r.vt;
    if (value === null || value === undefined) continue;
    w.values[r.key] = {
      value: value as AttributeValue['value'],
      provenance: r.prov,
      confidence: r.conf !== null ? Number(r.conf) : undefined,
      source_url: r.src,
      unit: r.uo,
    };
  }
}

export const STAGE_FNS: Record<string, (w: SkuWork) => Promise<void>> = {
  fetch: stageFetch,
  extract: stageExtract,
  verify: stageVerify,
  fill: stageFill,
  images: stageImages,
  brochures: stageBrochures,
  describe: stageDescribe,
};
