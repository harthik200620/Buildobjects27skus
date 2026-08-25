/**
 * Strict validator for curated SKU files — the contract check research agents run before
 * handing a category over. No database needed.
 *   pnpm --filter @buildobjects/pipeline exec tsx src/validate-curated.ts [category-slug]
 * Exit code 1 on any error. Warnings (soft rules) do not fail the run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CuratedSkuSchema, IMAGE_ROLES, type Registry, RegistrySchema } from '@buildobjects/catalog';
import { CURATED_DIR, REGISTRY_DIR } from './config';

/**
 * Strings that were used as a stand-in for a value and stamped `verified` at 0.98 confidence.
 * 12,895 of the 15,080 values in these files were the first of them. They are not values, and
 * a file may not contain one again.
 */
const PLACEHOLDER_VALUES = new Set(['verified industry standard', 'certified architectural standard', 'n/a', 'na', 'tbd']);

const only = process.argv[2];
const cats = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, 'categories.json'), 'utf8')).categories as {
  slug: string;
  code: string;
  brands: { slug: string; code: string }[];
}[];
let errors = 0,
  warnings = 0,
  files = 0;

function loadRegistry(slug: string): Registry | null {
  const f = path.join(REGISTRY_DIR, `${slug}.json`);
  return fs.existsSync(f) ? RegistrySchema.parse(JSON.parse(fs.readFileSync(f, 'utf8'))) : null;
}

for (const dir of fs.readdirSync(CURATED_DIR, { withFileTypes: true })) {
  if (!dir.isDirectory() || (only && dir.name !== only)) continue;
  const cat = cats.find((c) => c.slug === dir.name);
  const reg = loadRegistry(dir.name);
  if (!cat) {
    console.log(`✗ ${dir.name}: not a category in categories.json`);
    errors++;
    continue;
  }
  if (!reg) {
    console.log(`✗ ${dir.name}: registry/${dir.name}.json missing`);
    errors++;
    continue;
  }
  const keys = new Set(reg.attributes.map((a) => a.key));
  for (const f of fs.readdirSync(path.join(CURATED_DIR, dir.name)).filter((x) => x.endsWith('.json'))) {
    files++;
    const file = path.join(CURATED_DIR, dir.name, f);
    const err = (m: string) => {
      console.log(`✗ ${dir.name}/${f}: ${m}`);
      errors++;
    };
    const warn = (m: string) => {
      console.log(`! ${dir.name}/${f}: ${m}`);
      warnings++;
    };
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      err(`invalid JSON — ${(e as Error).message}`);
      continue;
    }
    const parsed = CuratedSkuSchema.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues.slice(0, 8)) err(`${i.path.join('.') || '(root)'}: ${i.message}`);
      continue;
    }
    const s = parsed.data;
    if (s.category !== dir.name) err(`category "${s.category}" ≠ folder "${dir.name}"`);
    if (f !== `${s.sku_code}.json`) err(`file name must be ${s.sku_code}.json`);
    const [cc, bc] = s.sku_code.split('-');
    if (cc !== cat.code) err(`sku_code prefix ${cc} ≠ category code ${cat.code}`);
    const brand = cat.brands.find((b) => b.code === bc);
    if (!brand) err(`sku_code brand segment ${bc} is not one of ${cat.brands.map((b) => b.code).join('/')}`);
    else if (brand.slug !== s.brand.slug) err(`brand.slug "${s.brand.slug}" should be "${brand.slug}" for code ${bc}`);
    const unknown = Object.keys(s.attributes).filter((k) => !keys.has(k));
    if (unknown.length) err(`attribute keys not in registry: ${unknown.join(', ')}`);
    const filled = Object.values(s.attributes).filter((v) => v.value !== null && v.value !== '').length;
    if (filled / reg.attributes.length < 0.6)
      warn(`only ${filled}/${reg.attributes.length} attributes filled (${Math.round((filled / reg.attributes.length) * 100)}%) — target ≥ 80%`);
    for (const [k, v] of Object.entries(s.attributes)) {
      // A key the registry does not define is already reported above; carrying on with an
      // undefined `a` threw a TypeError and took the rest of the run with it.
      const a = reg.attributes.find((x) => x.key === k);
      if (!a) continue;
      if (a.data_type === 'number' && v.value !== null && typeof v.value !== 'number') err(`${k}: registry says number, got ${JSON.stringify(v.value)}`);
      if (a.data_type === 'boolean' && v.value !== null && typeof v.value !== 'boolean') err(`${k}: registry says boolean, got ${JSON.stringify(v.value)}`);
      if (a.data_type === 'enum' && a.enum_values && v.value !== null && !a.enum_values.includes(String(v.value)))
        warn(`${k}: "${v.value}" is not one of the registry enum values (${a.enum_values.join(' | ')})`);
      if (typeof v.value === 'string' && PLACEHOLDER_VALUES.has(v.value.trim().toLowerCase()))
        err(`${k}: "${v.value}" is a placeholder, not a value — leave the attribute out instead`);
      if (v.provenance === 'ai_filled' && (v.confidence ?? 0) > 0.7) err(`${k}: ai_filled confidence must be ≤ 0.7`);
      if (v.provenance === 'verified' && !(v.source_urls && v.source_urls.length >= 2)) err(`${k}: verified needs two source_urls`);
      if (v.provenance === 'fetched' && !v.source_url) err(`${k}: fetched needs a source_url`);
      if (
        /(licen[cs]e|certificate_no|cert_no|cm_l|report_no|registration_no|test_report|bis_no|isi_no|almm_no|crs_no)/i.test(k) &&
        v.provenance === 'ai_filled'
      )
        err(`${k}: certificate / licence numbers must never be ai_filled`);
    }
    if (s.images.length !== 5) err(`images must have exactly 5 entries (has ${s.images.length})`);
    s.images.forEach((im, i) => {
      if (im.role !== IMAGE_ROLES[i]) err(`images[${i}].role must be ${IMAGE_ROLES[i]}`);
    });
    const realImgs = s.images.filter((i) => i.source_url).length;
    if (realImgs < 3) warn(`only ${realImgs}/5 images have a source_url`);
    if (s.key_specs.length !== 8) err(`key_specs must have exactly 8 keys (has ${s.key_specs.length})`);
    for (const k of s.key_specs) {
      if (!keys.has(k)) err(`key_specs "${k}" not in registry`);
      else if (!(k in s.attributes)) warn(`key_specs "${k}" has no value in attributes`);
    }
    const mandatory = ['dim_w_mm', 'dim_h_mm', 'dim_d_mm', 'net_weight_kg', 'model_number', 'country_of_origin', 'is_standard', 'hsn_code', 'warranty_months'];
    for (const k of mandatory) if (!(k in s.attributes)) warn(`mandatory key "${k}" missing (the AR engine reads dim_* — fill it, ai_filled is fine)`);
    if (s.price.provenance !== 'estimated' && !s.price.source_url) err(`price.provenance ${s.price.provenance} requires price.source_url`);
    if (s.price.provenance === 'estimated' && !s.price.note) warn('estimated price should carry a note with its basis');
    if (s.short_description.length > 160) warn(`short_description is ${s.short_description.length} chars (≤ 160)`);
    const words = s.long_description.split(/\s+/).length;
    if (words < 200 || words > 500) warn(`long_description is ${words} words (250–450)`);
    if (!s.sources.official_product_url.startsWith('http')) err('sources.official_product_url required');
    const intelLeaves = Object.keys(s.brand.intel).length;
    if (intelLeaves < 15) warn(`brand.intel has ${intelLeaves}/19 leaves`);
    if (s.seo.keywords_te.length === 0 || s.seo.keywords_hi.length === 0) warn('seo needs Telugu and Hindi keywords');
    console.log(`✓ ${dir.name}/${f}: ${filled}/${reg.attributes.length} attrs, ${realImgs}/5 images, ${s.documents.length} docs, price ${s.price.provenance}`);
  }
}
console.log(`\n${files} files · ${errors} errors · ${warnings} warnings`);
process.exit(errors ? 1 : 0);
