/**
 * WHAT THE ASSISTANT IS ALLOWED TO KNOW.
 *
 * ── THE ONE IDEA ────────────────────────────────────────────────────────────────────────────
 * The model knows nothing. Every price, every brand, every quantity and every specification it
 * says comes back from a call in this file, in this turn, and everything it returns is deposited
 * into a FactLedger that lib/chat/validator.ts holds the draft against afterwards. A sentence
 * containing a figure no tool produced does not reach the reader.
 *
 * That is why these functions return the ledger as well as the payload. A tool that returned only
 * data would leave the validator with nothing to check against, and the whole guarantee rests on
 * the two being produced together, by the same call, from the same numbers.
 *
 * ── WHY IT IS THIS STORE'S OWN CODE UNDERNEATH ──────────────────────────────────────────────
 * Search is the same Meilisearch index the header's search field queries. The estimate is the
 * same `estimate(inputs, catalog)` the /estimate page runs, priced off the same live catalogue.
 * Nothing here is a second implementation of anything: if the assistant and the page ever
 * disagreed about what a house costs, the assistant would be worthless, and the only way to
 * guarantee they cannot is to make them the same function.
 */

import { type EstimateInputs, estimate, type Tier } from '@buildobjects/estimator';
import { allBrands, allCategories, skuDocsByCodes, suggest } from '@/lib/catalog';
import { loadCalculatorCatalog } from '@/lib/estimator';
import { FactLedger } from './ledger';
import { categoriesNamed } from './routing';

export interface ToolContext {
  /** Where the reader is, so prices and delivery are theirs. */
  pincode: string;
  regionId: string;
}

export interface ToolResult {
  /** What goes back to the model, as JSON. */
  data: Record<string, unknown>;
  /** Everything in `data` that the model is now permitted to say. */
  ledger: FactLedger;
  /** Structured payloads the panel renders as cards under the reply. */
  ui?: unknown[];
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/* ── the shelves ─────────────────────────────────────────────────────────── */

async function catalogueScope(): Promise<ToolResult> {
  const [cats, brands] = await Promise.all([allCategories(), allBrands()]);
  const ledger = new FactLedger();
  ledger.entity(...cats.map((c) => c.name), ...brands.map((b) => b.name));
  ledger.number(cats.length, brands.length);
  return {
    data: {
      /* Split, not one flat list. A category with no products yet is not a category we do not
         cover, and the assistant cannot tell the two apart from names alone — which is exactly
         how "steel" got answered as "we do not stock that" rather than "it is coming". */
      on_the_shelf: cats.filter((c) => c.status === 'live').map((c) => c.name),
      coming_soon: cats.filter((c) => c.status !== 'live').map((c) => c.name),
      coming_soon_means: 'Announced, ours, and not stocked yet. Say it is coming soon. Never say we do not stock it, and never quote a price for it.',
      brands: brands.map((b) => b.name),
      counts: { categories: cats.length, brands: brands.length },
      also: ['the BO Estimator — what a house costs to build in Telangana and Andhra Pradesh', 'the BO Passport', 'BO Coins', 'the cart and delivery dates'],
      not_covered: 'Anything that is not Build Objects: general knowledge, other retailers, news, code, medicine, politics, or advice of any kind.',
    },
    ledger,
  };
}

async function searchProducts(args: { query?: string }): Promise<ToolResult> {
  const q = String(args.query ?? '').trim();
  const ledger = new FactLedger();
  if (!q) return { data: { error: 'A query is required.' }, ledger };

  const [found, cats] = await Promise.all([suggest(q), allCategories()]);
  /*
   * THE ROUTING FACT, IN THE TOOL RESULT.
   *
   * The system prompt says not to search a coming-soon category, and sometimes it is searched
   * anyway. Asked "any steel reinforcement?" the assistant searched it, got cement back — cement
   * documents talk about reinforcement, so they matched — and answered a question about steel
   * with three bags of cement.
   *
   * Repeating the fact HERE fixes that far more reliably than repeating it in the instructions,
   * because a tool result is evidence about this specific question rather than a standing rule to
   * remember. Cheap, too: one memoised read that the ledger seeding already paid for.
   */
  const soon = categoriesNamed(q, cats, 'upcoming');
  if (soon.length) ledger.entity(...soon);
  const rows = found.skus.map((s) => ({
    sku: s.sku_code,
    name: s.name,
    brand: s.brand,
    category: s.category_name,
    price: s.selling_price,
    price_text: s.selling_price ? inr(s.selling_price) : null,
    unit: s.unit,
    /* Printed on the product page too, and the one thing about a price the cards do not show. */
    price_is_estimated: s.price_provenance === 'estimated',
    in_stock: s.in_stock,
    href: `/p/${s.sku_code.toLowerCase()}`,
  }));

  for (const r of rows) {
    ledger.entity(r.name, r.brand, r.category, r.sku, r.unit);
    ledger.number(r.price);
  }
  ledger.entity(...found.categories.map((c) => c.name), ...found.brands.map((b) => b.name));
  ledger.number(rows.length);

  return {
    data: {
      products: rows,
      coming_soon: soon.length ? soon : undefined,
      coming_soon_means: soon.length
        ? `${soon.join(' and ')} is announced and not stocked yet. Say it is coming soon. Any products listed above are OTHER things that happened to match the words — do not offer them as if they were what was asked for.`
        : undefined,
      categories: found.categories.map((c) => c.name),
      brands: found.brands.map((b) => b.name),
      note: rows.some((r) => r.price_is_estimated)
        ? 'Some of these prices are the store’s own estimate for the class, not a fetched brand price. Say so.'
        : null,
    },
    ledger,
    ui: rows.length ? [{ kind: 'products', rows }] : [],
  };
}

async function productDetail(args: { sku?: string }): Promise<ToolResult> {
  const code = String(args.sku ?? '').toUpperCase();
  const ledger = new FactLedger();
  const [doc] = await skuDocsByCodes([code]);
  if (!doc) return { data: { error: `No product with the code ${code}.` }, ledger };

  ledger.entity(doc.name, doc.brand, doc.category_name, doc.sku_code, doc.unit, ...(doc.spec_text ?? []));
  ledger.number(doc.selling_price, doc.mrp, doc.pack_qty);

  return {
    data: {
      sku: doc.sku_code,
      name: doc.name,
      brand: doc.brand,
      category: doc.category_name,
      price: doc.selling_price,
      price_text: doc.selling_price ? inr(doc.selling_price) : null,
      mrp: doc.mrp,
      unit: doc.unit,
      pack_qty: doc.pack_qty,
      stock: doc.stock,
      price_is_estimated: doc.price_provenance === 'estimated',
      specs: doc.spec_text ?? [],
      href: `/p/${doc.sku_code.toLowerCase()}`,
    },
    ledger,
    ui: [
      {
        kind: 'products',
        rows: [
          {
            sku: doc.sku_code,
            name: doc.name,
            brand: doc.brand,
            price_text: doc.selling_price ? inr(doc.selling_price) : null,
            unit: doc.unit,
            href: `/p/${doc.sku_code.toLowerCase()}`,
          },
        ],
      },
    ],
  };
}

/* ── the house ───────────────────────────────────────────────────────────── */

const TIERS: Tier[] = ['basic', 'medium', 'premium'];

/**
 * What a house costs — the SAME engine the /estimate page runs, on the same live catalogue.
 *
 * Defaults are named in the payload rather than hidden, because the model is required to say
 * which ones it took. An estimate whose assumptions are invisible is a number somebody will
 * quote at a contractor without knowing it assumed a 75 % footprint.
 */
async function houseEstimate(args: {
  length_ft?: number;
  width_ft?: number;
  plot_sqft?: number;
  floors?: number;
  tier?: string;
  city?: string;
}): Promise<ToolResult> {
  const ledger = new FactLedger();
  const tier = (TIERS.includes(args.tier as Tier) ? args.tier : 'medium') as Tier;
  const floors = Number.isFinite(args.floors) ? Math.max(0, Math.min(4, Math.round(args.floors as number))) : 1;
  const city = String(args.city ?? 'hyderabad').toLowerCase();

  const plot =
    Number.isFinite(args.length_ft) && Number.isFinite(args.width_ft)
      ? { lengthFt: Number(args.length_ft), widthFt: Number(args.width_ft) }
      : Number.isFinite(args.plot_sqft)
        ? { areaSqft: Number(args.plot_sqft) }
        : null;
  if (!plot) return { data: { error: 'A plot size is required — either length and width in feet, or an area in square feet.' }, ledger };

  const inputs: EstimateInputs = {
    state: city === 'vijayawada' || city === 'guntur' || city === 'visakhapatnam' ? 'AP' : 'TS',
    city,
    pincode: null,
    plot,
    floors,
    coverage: 0.75,
    constructionType: 'rcc_framed',
    parking: false,
    compoundWall: false,
    tier,
    addons: { solar: false, cctv: false, fireSafety: false },
    builtUpOverrideSqft: null,
    picks: [],
  };

  const catalog = await loadCalculatorCatalog([]);
  const r = estimate(inputs, catalog);

  /*
   * EVERY NUMBER THIS TOOL ASKS THE MODEL TO REPEAT HAS TO BE IN THE LEDGER.
   *
   * `assumptions_taken` below reads "G+1, 75 % ground coverage, RCC framed, medium finish", and
   * the prompt requires the model to say that clause back so nobody quotes the total at a
   * contractor without knowing what it assumed. The 75 was not in the ledger, so a model doing
   * exactly what it was told produced an ungrounded number and the validator refused the whole
   * answer — the flagship question came back as "I could not write a summary I trusted" with the
   * card underneath it. A tool that instructs and does not permit is a tool that fails closed on
   * its own advice.
   */
  ledger.number(r.grandTotal, r.perSqft, r.derived.builtUpSqft, floors, r.accuracy.pct, Math.round(inputs.coverage * 100));
  ledger.number(...TIERS.map((t) => r.tiers[t]));
  ledger.entity(r.derived.cityName, r.derived.floorsLabel, tier, r.version);
  for (const g of r.groups) {
    ledger.entity(g.label);
    ledger.number(g.amount);
  }

  return {
    data: {
      total: r.grandTotal,
      total_text: inr(r.grandTotal),
      per_sqft: Math.round(r.perSqft),
      built_up_sqft: Math.round(r.derived.builtUpSqft),
      floors_label: r.derived.floorsLabel,
      city: r.derived.cityName,
      tier,
      accuracy_pct: r.accuracy.pct,
      at_each_tier: Object.fromEntries(TIERS.map((t) => [t, r.tiers[t]])),
      where_it_goes: r.groups.map((g) => ({ group: g.label, amount: g.amount, amount_text: inr(g.amount) })),
      rate_card: r.version,
      assumptions_taken: `${floors === 0 ? 'ground floor only' : `G+${floors}`}, 75 % ground coverage, RCC framed, ${tier} finish`,
      full_estimator: '/estimate',
    },
    ledger,
    ui: [
      {
        kind: 'estimate',
        total: inr(r.grandTotal),
        sub: `${Math.round(r.derived.builtUpSqft).toLocaleString('en-IN')} sqft built-up · ${r.derived.floorsLabel} · ${r.derived.cityName} · ${tier}`,
        rows: r.groups.slice(0, 6).map((g) => ({ label: g.label, value: inr(g.amount) })),
        href: '/estimate',
      },
    ],
  };
}

/* ── dispatch ────────────────────────────────────────────────────────────── */

export async function callTool(name: string, args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
  switch (name) {
    case 'get_catalogue_scope':
      return catalogueScope();
    case 'search_products':
      return searchProducts(args as { query?: string });
    case 'get_product':
      return productDetail(args as { sku?: string });
    case 'estimate_house':
      return houseEstimate(args as Parameters<typeof houseEstimate>[0]);
    default:
      return { data: { error: `No such tool: ${name}` }, ledger: new FactLedger() };
  }
}
