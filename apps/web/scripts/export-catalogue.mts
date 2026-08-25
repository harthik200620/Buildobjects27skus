/**
 * `npx tsx apps/web/scripts/export-catalogue.mts`
 *
 * Freeze the catalogue into JSON so the storefront can run with no database, no search server
 * and no Redis — which is what makes it deployable to Vercel as-is.
 *
 * The catalogue is 37 categories and 27 SKUs. That is small enough that a database is a
 * deployment burden rather than a capability: it needs a host, a connection string, a migration
 * and a restore before a single page renders. A JSON snapshot needs none of those, ships in the
 * repo, and is served from the edge.
 *
 * The snapshot is taken by CALLING THE REAL LOADERS rather than by re-querying the tables. That
 * guarantees the frozen objects are shape-identical to what the live path returns — no second
 * mapping to drift out of step, and no chance of the static site rendering a subtly different
 * object from the database-backed one.
 *
 * The database stays the source of truth. This is a build artefact of it, regenerated whenever
 * the pipeline changes the catalogue.
 */
import fs from 'node:fs';
import path from 'node:path';
import { closeDb } from '@buildobjects/db';
import { loadFacetConfig, loadFlagshipSkus, loadSkuPage, searchSkus } from '../lib/catalog';
import { loadCategories } from '../lib/data';

/** An unfiltered state, built the way parseFilters builds one — `attrs` must exist, not be absent. */
const emptyState = (category?: string) => ({ attrs: {}, q: '', page: 1, ...(category ? { category } : {}) });

const OUT = path.resolve(import.meta.dirname, '..', 'data', 'catalogue');

function write(name: string, value: unknown): void {
  const file = path.join(OUT, `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  process.stdout.write(`  ${name.padEnd(34)} ${kb.padStart(5)} KB\n`);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  process.stdout.write('freezing the catalogue\n\n');

  const categories = await loadCategories();
  if (!categories.length) throw new Error('no categories — is the database up? run pnpm infra:up');
  write('categories', categories);

  const flagship = await loadFlagshipSkus();
  write('flagship', flagship);

  /* Every SKU's product page, keyed by code. 27 of them; the largest is a few tens of KB. */
  const codes = flagship.map((s) => s.sku_code);
  const skus: Record<string, unknown> = {};
  for (const code of codes) {
    const page = await loadSkuPage(code.toLowerCase());
    if (page) skus[code.toLowerCase()] = page;
  }
  write('skus', skus);

  /*
   * One unfiltered listing per live category, plus the facet config that drives its rail. The
   * filtered permutations are not frozen — 27 SKUs filter in memory faster than a network hop,
   * and freezing a combinatorial space is how a snapshot becomes bigger than the database.
   */
  const listings: Record<string, unknown> = {};
  const facets: Record<string, unknown> = {};
  for (const c of categories.filter((x) => x.status === 'live')) {
    const config = await loadFacetConfig(c.slug);
    facets[c.slug] = config;
    listings[c.slug] = await searchSkus({ state: emptyState(c.slug), config, fixedCategory: c.slug });
  }
  write('listings', listings);
  write('facets', facets);

  /* The all-products view, and its facet config. */
  const allConfig = await loadFacetConfig(null);
  write('facets-all', allConfig);
  write('search-all', await searchSkus({ state: emptyState(), config: allConfig }));

  const total = fs
    .readdirSync(OUT)
    .map((f) => fs.statSync(path.join(OUT, f)).size)
    .reduce((a, b) => a + b, 0);
  process.stdout.write(`\n${categories.length} categories · ${codes.length} SKUs · ${(total / 1024).toFixed(0)} KB total\n`);
}

await main();
await closeDb();
