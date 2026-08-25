/**
 * The automatic filter engine. Filters are computed, not written:
 *   1. take the category's filterable attributes,
 *   2. keep one only if live data supports it — coverage ≥ 60 % of in-stock SKUs AND
 *      (enum/text: 2–15 distinct values · number: a real spread · boolean: ≥1 true),
 *   3. emit a widget per data type; Brand, Price and Availability always,
 *   4. merge the per-category filter policy (registry/filter-policy.json — the category-filters
 *      skill applied): visibility (primary / more / toolbar), policy order, conditionals, radio
 *      bands on the real distribution, buyer-language labels and sublabels, deliberate omissions,
 *      the depth rule (< 20 SKUs → 4 primary facets, else 8; "More filters" holds 6), the page
 *      note for a lead attribute that is single-valued today, and the universal layer
 *      (Price basis = price provenance, Price freshness = price checked in the last 7 days),
 *   5. write filter_configs and update Meilisearch filterableAttributes in the same pass.
 * Adding a SKU and re-running is the only way a filter ever changes.
 *
 * Every aggregation runs inside MySQL (GROUP BY / MIN / MAX / COUNT DISTINCT / NTILE) against the
 * in-stock id set of the category, which the covering index (category_id, stock_status, id)
 * serves without touching a row — so a 44k-SKU category costs one small result per attribute,
 * not 44k rows per attribute through the driver.
 */

import { type CheckboxFacet, type Facet, type FacetBand, type FacetConfig, type FacetVisibility, niceStep, type ToggleFacet } from '@buildobjects/catalog';
import { attributes, categories, filterConfigs, getDb, num } from '@buildobjects/db';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import { ensureIndex } from '../search';
import { type BandSpec, type CategoryPolicy, loadPolicy, policyFor } from './policy';

const MIN_COVERAGE = 0.6;
const MIN_DISTINCT = 2;
const MAX_DISTINCT = 15;
/** "More filters" fold — beyond this the clutter has moved, not left. */
const MORE_CAP = 6;
/** Depth rule: a thin catalogue gets a short rail (filter-design-rules §10). */
const primaryLimit = (inStock: number) => (inStock < 20 ? 4 : 8);
const FRESH_DAYS = 7;

type Rows<T> = [T[], unknown];
type Dropped = { attr: string; reason: string; value?: string; count?: number };

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numberWord = (n: number) => NUMBER_WORDS[n] ?? n.toLocaleString('en-IN');

function fmtNum(x: number, unit: string | null | undefined): string {
  if (unit === '₹') {
    if (x >= 100_000) {
      const l = x / 100_000;
      return `₹${Number.isInteger(l) ? l.toFixed(0) : l.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} L`;
    }
    return `₹${Math.round(x).toLocaleString('en-IN')}`;
  }
  const s = Number.isInteger(x) ? x.toLocaleString('en-IN') : x.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return unit ? `${s} ${unit}` : s;
}
function bandLabel(lo: number | null, hi: number | null, unit: string | null | undefined): string {
  if (lo === null && hi !== null) return `Under ${fmtNum(hi, unit)}`;
  if (hi === null && lo !== null) return `${fmtNum(lo, unit)} and above`;
  return `${fmtNum(lo ?? 0, unit)} – ${fmtNum(hi ?? 0, unit)}`;
}

export async function buildFacetsForCategory(categorySlug: string): Promise<FacetConfig> {
  const db = getDb();
  const [cat] = await db.select().from(categories).where(eq(categories.slug, categorySlug));
  if (!cat) throw new Error(`unknown category ${categorySlug}`);
  const q = async <T>(query: SQL): Promise<T[]> => ((await db.execute(query)) as unknown as Rows<T>)[0];

  /* the in-stock population of the category — index-only */
  const [counts] = await q<{ total: number; in_stock: number; min_price: number | null; max_price: number | null }>(sql`
    SELECT COUNT(*) AS total, SUM(stock_status <> 'out_of_stock') AS in_stock,
           MIN(CASE WHEN stock_status <> 'out_of_stock' THEN selling_price END) AS min_price,
           MAX(CASE WHEN stock_status <> 'out_of_stock' THEN selling_price END) AS max_price
    FROM skus WHERE category_id = ${cat.id}`);
  const n = Number(counts?.in_stock ?? 0);
  const facets: Facet[] = [];
  const dropped: Dropped[] = [];
  const inStockIds = sql`(SELECT id FROM skus WHERE category_id = ${cat.id} AND stock_status <> 'out_of_stock')`;
  const priceSource = sql`skus WHERE category_id = ${cat.id} AND stock_status <> 'out_of_stock' AND selling_price IS NOT NULL`;

  /* always: brand (count-ordered), price, availability */
  const brandRows = await q<{ value: string; count: number }>(sql`
    SELECT b.name AS value, COUNT(*) AS count FROM skus s JOIN products p ON p.id = s.product_id JOIN brands b ON b.id = p.brand_id
    WHERE s.category_id = ${cat.id} AND s.stock_status <> 'out_of_stock' GROUP BY b.name ORDER BY count DESC, value ASC`);
  facets.push({
    key: 'brand',
    attr: 'brand',
    label: 'Brand',
    kind: 'checkbox',
    order: -3,
    values: brandRows.map((r) => ({ value: r.value, count: Number(r.count) })),
  });
  const minP = num(counts?.min_price),
    maxP = num(counts?.max_price);
  if (minP !== null && maxP !== null) {
    const min = Math.floor(minP),
      max = Math.ceil(maxP);
    facets.push({
      key: 'price',
      attr: 'selling_price',
      label: 'Price',
      kind: 'range',
      order: -2,
      unit: '₹',
      min,
      max: Math.max(max, min + 1),
      step: niceStep(min, max, 20),
    });
  }
  facets.push({ key: 'stock', attr: 'in_stock', label: 'Availability', kind: 'toggle', order: -1, true_count: n, true_label: 'In stock only' });

  /* the data rule — unchanged */
  const attrs = await db
    .select()
    .from(attributes)
    .where(and(eq(attributes.categoryId, cat.id), eq(attributes.isFilterable, true)))
    .orderBy(asc(attributes.filterOrder), asc(attributes.importanceRank));
  const numericAttrId = new Map<string, number>();
  for (const a of attrs) {
    const widget = a.filterWidget ?? (a.dataType === 'number' ? 'range' : a.dataType === 'boolean' ? 'toggle' : 'checkbox');
    if (a.dataType === 'number') {
      numericAttrId.set(a.key, a.id);
      const [r] = await q<{ c: number; d: number; mn: number | null; mx: number | null }>(sql`
        SELECT COUNT(*) AS c, COUNT(DISTINCT v.value_number) AS d, MIN(v.value_number) AS mn, MAX(v.value_number) AS mx
        FROM sku_attribute_values v JOIN ${inStockIds} i ON i.id = v.sku_id WHERE v.attribute_id = ${a.id} AND v.value_number IS NOT NULL`);
      const coverage = n ? Number(r?.c ?? 0) / n : 0;
      if (coverage < MIN_COVERAGE) {
        dropped.push({ attr: a.key, reason: `coverage ${Math.round(coverage * 100)}% < 60%` });
        continue;
      }
      const distinct = Number(r?.d ?? 0),
        min = num(r?.mn) ?? 0,
        max = num(r?.mx) ?? 0;
      if (distinct < MIN_DISTINCT) {
        dropped.push({
          attr: a.key,
          reason: `no spread (${distinct} distinct value${distinct === 1 ? '' : 's'})`,
          ...(distinct === 1 ? { value: fmtNum(min, a.unit), count: Number(r?.c ?? 0) } : {}),
        });
        continue;
      }
      const step = niceStep(min, max, 10);
      facets.push({
        key: a.key,
        attr: `attr_${a.key}`,
        label: a.label,
        kind: 'range',
        order: a.filterOrder,
        unit: a.unit,
        importance: a.importanceRank,
        min: Math.floor(min / step) * step,
        max: Math.ceil(max / step) * step,
        step,
      });
    } else if (a.dataType === 'boolean') {
      const [r] = await q<{ c: number; t: number | null }>(sql`
        SELECT COUNT(*) AS c, SUM(v.value_bool) AS t FROM sku_attribute_values v JOIN ${inStockIds} i ON i.id = v.sku_id WHERE v.attribute_id = ${a.id} AND v.value_bool IS NOT NULL`);
      const coverage = n ? Number(r?.c ?? 0) / n : 0;
      if (coverage < MIN_COVERAGE) {
        dropped.push({ attr: a.key, reason: `coverage ${Math.round(coverage * 100)}% < 60%` });
        continue;
      }
      const t = Number(r?.t ?? 0);
      if (t === 0) {
        dropped.push({ attr: a.key, reason: 'never true', value: 'No', count: Number(r?.c ?? 0) });
        continue;
      }
      facets.push({
        key: a.key,
        attr: `attr_${a.key}`,
        label: a.label,
        kind: 'toggle',
        order: a.filterOrder,
        importance: a.importanceRank,
        true_count: t,
        true_label: 'Yes',
      });
    } else {
      const rows = await q<{ value: string; count: number }>(sql`
        SELECT v.value_text AS value, COUNT(*) AS count FROM sku_attribute_values v JOIN ${inStockIds} i ON i.id = v.sku_id
        WHERE v.attribute_id = ${a.id} AND v.value_text IS NOT NULL AND v.value_text <> '' GROUP BY v.value_text ORDER BY count DESC, value ASC LIMIT ${MAX_DISTINCT + 1}`);
      const covered = rows.reduce((s, r) => s + Number(r.count), 0);
      const coverage = n ? covered / n : 0;
      if (coverage < MIN_COVERAGE) {
        dropped.push({ attr: a.key, reason: `coverage ${Math.round(coverage * 100)}% < 60%` });
        continue;
      }
      if (rows.length < MIN_DISTINCT || rows.length > MAX_DISTINCT) {
        dropped.push({
          attr: a.key,
          reason: `${rows.length > MAX_DISTINCT ? `more than ${MAX_DISTINCT}` : rows.length} distinct value${rows.length === 1 ? '' : 's'} (need 2–15)`,
          ...(rows.length === 1 ? { value: rows[0].value, count: Number(rows[0].count) } : {}),
        });
        continue;
      }
      facets.push({
        key: a.key,
        attr: `attr_${a.key}`,
        label: a.label,
        kind: widget === 'chips' ? 'chips' : 'checkbox',
        order: a.filterOrder,
        importance: a.importanceRank,
        values: rows.map((r) => ({ value: r.value, count: Number(r.count) })),
      });
    }
  }

  /* the policy merge */
  const policy =
    policyFor(categorySlug) ??
    defaultPolicy(
      cat.unit,
      attrs.map((a) => a.key),
    );
  const limit = primaryLimit(n);
  const ordered = applyPolicy(
    policy,
    facets,
    dropped,
    attrs.map((a) => a.key),
    limit,
  );

  /* radio bands on the real distribution (price always; other range facets when the policy says) */
  for (const f of ordered) {
    if (f.kind !== 'range') continue;
    const spec = f.key === 'price' ? (policy.bands?.price ?? 'quartiles') : policy.bands?.[f.key];
    if (!spec) continue;
    const source =
      f.key === 'price'
        ? priceSource
        : sql`sku_attribute_values v JOIN ${inStockIds} i ON i.id = v.sku_id WHERE v.attribute_id = ${numericAttrId.get(f.key) ?? -1} AND v.value_number IS NOT NULL`;
    const expr = f.key === 'price' ? sql`selling_price` : sql`v.value_number`;
    const bands = await computeBands(q, source, expr, spec, f.unit);
    if (bands && bands.length >= 2) f.bands = bands;
  }

  /* the universal layer */
  const universal = policy.universal ?? { price_basis: true, price_freshness: true };
  let nextOrder = ordered.filter((f) => f.visibility !== 'toolbar').length;
  const toolbarStart = ordered.findIndex((f) => f.visibility === 'toolbar');
  const insertAt = toolbarStart < 0 ? ordered.length : toolbarStart;
  const extra: Facet[] = [];
  if (universal.price_basis !== false) {
    const rows = await q<{ value: string; count: number }>(
      sql`SELECT price_provenance AS value, COUNT(*) AS count FROM skus WHERE category_id = ${cat.id} AND stock_status <> 'out_of_stock' GROUP BY price_provenance ORDER BY count DESC, value ASC`,
    );
    if (rows.length >= 2) {
      extra.push({
        key: 'price_basis',
        attr: 'price_provenance',
        label: 'Price basis',
        kind: 'checkbox',
        order: nextOrder++,
        visibility: 'more',
        default_off: true,
        values: rows.map((r) => ({ value: r.value, count: Number(r.count), label: r.value.charAt(0).toUpperCase() + r.value.slice(1) })),
        sublabel: {
          fetched: 'fetched from the brand or dealer page',
          verified: 'verified against the source',
          estimated: 'typical AP/TS dealer rate — marked on the card',
        },
        note: 'Every price is either fetched from a source page or an explicit estimate; filter on which.',
      } satisfies CheckboxFacet);
    } else dropped.push({ attr: 'price_basis', reason: `1 distinct value (need 2–15)`, value: rows[0]?.value, count: Number(rows[0]?.count ?? 0) });
  }
  if (universal.price_freshness !== false) {
    const [r] = await q<{ t: number }>(
      sql`SELECT COUNT(*) AS t FROM skus WHERE category_id = ${cat.id} AND stock_status <> 'out_of_stock' AND price_fetched_at >= DATE_SUB(NOW(), INTERVAL ${FRESH_DAYS} DAY)`,
    );
    const t = Number(r?.t ?? 0);
    if (t > 0)
      extra.push({
        key: 'price_freshness',
        attr: 'price_fetched_at',
        label: 'Price freshness',
        kind: 'toggle',
        order: nextOrder++,
        visibility: 'more',
        true_count: t,
        true_label: `Checked in the last ${FRESH_DAYS} days`,
        since_days: FRESH_DAYS,
        note: 'Prices carry the date they were last checked against the source.',
      } satisfies ToggleFacet);
    else dropped.push({ attr: 'price_freshness', reason: `no price checked in the last ${FRESH_DAYS} days` });
  }
  ordered.splice(insertAt, 0, ...extra);
  ordered.forEach((f, i) => {
    f.order = i;
  });

  const config: FacetConfig = {
    category: categorySlug,
    computed_at: new Date().toISOString(),
    sku_count: Number(counts?.total ?? 0),
    in_stock_count: n,
    facets: ordered,
    dropped,
    meili_filterable: Array.from(new Set(ordered.map((f) => f.attr))),
    canonical_unit: policy.canonical_unit,
    lead: policy.lead || undefined,
    lead_note: leadNote(policy, dropped, n),
    certification_note: policy.certification_note,
    depth_rule: { sku_count: n, primary_limit: limit },
    policy_version: loadPolicy().version,
  };
  await db
    .insert(filterConfigs)
    .values({ categoryId: cat.id, config, computedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { config, computedAt: new Date() } });
  return config;
}

/** No policy entry: registry order is the rail, price then brand after it — the pre-policy behaviour plus the depth rule. */
function defaultPolicy(unit: string | null, registryKeys: string[]): CategoryPolicy {
  return { canonical_unit: unit ?? 'piece', lead: '', primary: [...registryKeys, 'price', 'brand'], toolbar: ['stock'] };
}

/**
 * Policy × data rule → the ordered facet list with visibility.
 *   primary   the policy's rail order (price/brand tokens place the universal facets, which are
 *             always primary); the first `limit` spec facets that exist are primary, the rest
 *             overflow into the fold
 *   conditional  a child with its parent present takes the parent's visibility + depends_on and
 *             never counts toward a budget; an orphan (parent dropped) queues for the fold
 *   more      overflow → policy.more → orphans → attributes the policy never mentions (registry
 *             order), capped at MORE_CAP; beyond that: dropped "over budget"
 *   omit      policy exclusions win over the data rule
 *   toolbar   In stock only
 */
function applyPolicy(p: CategoryPolicy, facets: Facet[], dropped: Dropped[], registryOrder: string[], limit: number): Facet[] {
  const byKey = new Map(facets.map((f) => [f.key, f]));
  for (const o of p.omit ?? []) {
    if (!byKey.has(o.key)) continue;
    byKey.delete(o.key);
    dropped.push({ attr: o.key, reason: `policy: ${o.reason}` });
  }

  const primaryKeys = [...p.primary];
  if (!primaryKeys.includes('price') && !p.price_key) primaryKeys.push('price');
  if (!primaryKeys.includes('brand')) {
    if (p.brand_first) primaryKeys.splice(1, 0, 'brand');
    else primaryKeys.push('brand');
  }
  const conditional = p.conditional ?? {};
  const toolbarKeys = Array.from(new Set([...(p.toolbar ?? []), 'stock']));
  const mentioned = new Set([...primaryKeys, ...(p.more ?? []), ...Object.keys(conditional), ...toolbarKeys, ...(p.omit ?? []).map((o) => o.key)]);

  const visibility = new Map<string, FacetVisibility>();
  const overflow: string[] = [];
  /* The commercial layer (price on the canonical unit, brand) sits in the same place on every
     category page — universal-filters.md's whole argument — so it never competes with spec
     facets for the depth-rule budget; `limit` counts spec facets only. */
  const universal = new Set(['price', 'brand', ...(p.price_key ? [p.price_key] : [])]);
  let taken = 0;
  for (const k of primaryKeys) {
    if (!byKey.has(k)) continue;
    if (universal.has(k)) {
      visibility.set(k, 'primary');
      continue;
    }
    if (taken < limit) {
      visibility.set(k, 'primary');
      taken++;
    } else overflow.push(k);
  }
  const childOf = (k: string) => {
    const c = conditional[k];
    return c && byKey.has(c.depends_on) ? c.depends_on : null;
  };
  const orphans = Object.keys(conditional).filter((k) => byKey.has(k) && !childOf(k));
  const unlisted = registryOrder.filter((k) => byKey.has(k) && !mentioned.has(k));
  const moreQueue = Array.from(
    new Set([
      ...overflow,
      ...(p.more ?? []).filter((k) => byKey.has(k)),
      ...orphans,
      ...unlisted,
      ...(p.price_key && byKey.has('price') && !primaryKeys.includes('price') ? ['price'] : []),
    ]),
  );
  let inMore = 0;
  for (const k of moreQueue) {
    if (visibility.has(k)) continue;
    if (inMore < MORE_CAP) {
      visibility.set(k, 'more');
      inMore++;
    } else {
      byKey.delete(k);
      dropped.push({ attr: k, reason: `over budget (More filters holds ${MORE_CAP})` });
    }
  }
  for (const k of toolbarKeys) if (byKey.has(k)) visibility.set(k, 'toolbar');

  /* conditionals with a present parent inherit its visibility */
  const children = new Map<string, string[]>();
  for (const [k, c] of Object.entries(conditional)) {
    const parent = childOf(k);
    if (!parent || !byKey.has(k) || !visibility.has(parent)) continue;
    const f = byKey.get(k)!;
    f.depends_on = {
      key: parent,
      ...(c.values ? { values: c.values } : {}),
      ...(c.min !== undefined ? { min: c.min } : {}),
      ...(c.max !== undefined ? { max: c.max } : {}),
    };
    visibility.set(k, visibility.get(parent)!);
    (children.get(parent) ?? children.set(parent, []).get(parent)!).push(k);
  }
  /* anything still unassigned (a facet the engine emitted that no rule placed) — cannot happen, but never lose a facet silently */
  for (const k of byKey.keys())
    if (!visibility.has(k)) {
      byKey.delete(k);
      dropped.push({ attr: k, reason: 'not placed by the policy' });
    }

  /* display order: primaries (children after their parent) → more (queue order) → toolbar */
  const out: Facet[] = [];
  const pushWithChildren = (k: string) => {
    const f = byKey.get(k);
    if (!f || out.includes(f)) return;
    out.push(f);
    for (const c of children.get(k) ?? []) {
      const cf = byKey.get(c);
      if (cf && !out.includes(cf)) out.push(cf);
    }
  };
  for (const k of primaryKeys) if (visibility.get(k) === 'primary') pushWithChildren(k);
  for (const k of moreQueue) if (visibility.get(k) === 'more') pushWithChildren(k);
  for (const k of toolbarKeys) pushWithChildren(k);
  for (const k of byKey.keys()) pushWithChildren(k);

  /* labels, sublabels, swatches, notes, flags */
  for (const f of out) {
    f.visibility = visibility.get(f.key);
    const r = p.relabel?.[f.key];
    if (r?.label) f.label = r.label;
    if (f.key === 'price') f.label = p.price_key ? (p.pack_price_label ?? 'Price per pack') : (p.price_label ?? `Price per ${p.canonical_unit}`);
    if ((f.kind === 'checkbox' || f.kind === 'chips') && f.key !== 'brand') {
      const present = new Set(f.values.map((v) => v.value));
      const sub = Object.fromEntries(Object.entries(r?.sublabels ?? {}).filter(([v]) => present.has(v)));
      if (Object.keys(sub).length) f.sublabel = sub;
      const sw = Object.fromEntries(Object.entries(p.swatches?.[f.key] ?? {}).filter(([v]) => present.has(v)));
      if (Object.keys(sw).length) f.swatch = sw;
    }
    if (f.kind === 'toggle' && r?.true_label) f.true_label = r.true_label;
    if (p.notes?.[f.key]) f.note = p.notes[f.key];
    if (p.needs_verification?.[f.key]) f.needs_verification = p.needs_verification[f.key];
    if (p.default_off?.includes(f.key)) f.default_off = true;
  }
  out.forEach((f, i) => {
    f.order = i;
  });
  return out;
}

/** Radio bands for a range facet: quartiles of the live distribution (edges rounded to a nice step, empty bands merged) or the policy's explicit edges. Counts are always measured after rounding, so they are true. */
async function computeBands(
  q: <T>(s: SQL) => Promise<T[]>,
  source: SQL,
  expr: SQL,
  spec: 'quartiles' | BandSpec,
  unit: string | null | undefined,
): Promise<FacetBand[] | undefined> {
  let edges: number[];
  let labels: (string | undefined)[] = [];
  let swatches: (string | undefined)[] = [];
  let explicit = false;
  if (spec === 'quartiles') {
    let rows: { q: number; mn: number; mx: number; c: number }[];
    try {
      rows = (
        await q<{ q: number; mn: number; mx: number; c: number }>(sql`
        SELECT q, MIN(val) AS mn, MAX(val) AS mx, COUNT(*) AS c FROM (SELECT ${expr} AS val, NTILE(4) OVER (ORDER BY ${expr}) AS q FROM ${source}) t GROUP BY q ORDER BY q`)
      ).map((r) => ({ q: Number(r.q), mn: Number(r.mn), mx: Number(r.mx), c: Number(r.c) }));
    } catch {
      /* no window functions (MySQL < 8): quartiles in TS from the sorted values */
      const vals = (await q<{ val: number }>(sql`SELECT ${expr} AS val FROM ${source} ORDER BY val`)).map((r) => Number(r.val));
      rows = [0, 1, 2, 3]
        .map((i) => {
          const slice = vals.slice(Math.floor((i * vals.length) / 4), Math.floor(((i + 1) * vals.length) / 4));
          return { q: i + 1, mn: slice[0], mx: slice[slice.length - 1], c: slice.length };
        })
        .filter((r) => r.c > 0);
    }
    if (rows.length < 2) return undefined;
    const min = rows[0].mn,
      max = rows[rows.length - 1].mx;
    const step = niceStep(min, max, 8);
    edges = Array.from(new Set(rows.slice(1).map((r) => Math.round(r.mn / step) * step)))
      .filter((e) => e > min && e <= max)
      .sort((a, b) => a - b);
    if (!edges.length) return undefined;
  } else {
    edges = spec.edges;
    labels = spec.labels ?? [];
    swatches = spec.swatches ?? [];
    explicit = true;
  }
  const bounds: { lo: number | null; hi: number | null }[] = [
    { lo: null, hi: edges[0] },
    ...edges.map((e, i) => ({ lo: e, hi: i + 1 < edges.length ? edges[i + 1] : null })),
  ];
  const conds = bounds.map((b) =>
    b.lo === null ? sql`${expr} < ${b.hi}` : b.hi === null ? sql`${expr} >= ${b.lo}` : sql`(${expr} >= ${b.lo} AND ${expr} < ${b.hi})`,
  );
  const [row] = await q<Record<string, number | string | null>>(
    sql`SELECT ${sql.join(
      conds.map((c, i) => sql`SUM(${c}) AS ${sql.raw(`b${i}`)}`),
      sql`, `,
    )} FROM ${source}`,
  );
  let bands: FacetBand[] = bounds.map((b, i) => ({
    lo: b.lo,
    hi: b.hi,
    label: labels[i] ?? bandLabel(b.lo, b.hi, unit),
    count: Number(row?.[`b${i}`] ?? 0),
    ...(swatches[i] ? { swatch: swatches[i] } : {}),
  }));
  if (!explicit) {
    /* merge empty quartile bands into a neighbour so the bands stay contiguous, then relabel */
    const merged: FacetBand[] = [];
    for (const b of bands) {
      if (b.count === 0 && merged.length) {
        merged[merged.length - 1].hi = b.hi;
        continue;
      }
      if (b.count === 0 && !merged.length) {
        bands[bands.indexOf(b) + 1].lo = b.lo;
        continue;
      }
      merged.push(b);
    }
    bands = merged.map((b) => ({ ...b, label: bandLabel(b.lo, b.hi, unit) }));
  }
  return bands;
}

/** "All four cements here are PPC 50 kg bags" — only when the lead attribute was dropped as single-valued, and only from real single values. */
function leadNote(p: CategoryPolicy, dropped: Dropped[], n: number): string | undefined {
  if (!p.lead) return undefined;
  const single = (k: string) => dropped.find((d) => d.attr === k && d.value !== undefined)?.value;
  const leadValue = single(p.lead);
  if (leadValue === undefined) return undefined;
  const template = p.lead_note ?? `All {n} products here: {${p.lead}}`;
  let ok = true;
  const text = template.replace(/\{([a-z_0-9]+)\}/g, (_, k: string) => {
    if (k === 'n') return numberWord(n);
    const v = single(k);
    if (v === undefined) ok = false;
    return v ?? '';
  });
  return ok ? text : `All ${numberWord(n)} products here: ${leadValue}`;
}

/** Every category; updates the Meilisearch filterable attributes and returns their union. */
export async function buildAllFacets(log: (s: string) => void = () => {}): Promise<string[]> {
  const db = getDb();
  loadPolicy();
  const cats = await db.select({ slug: categories.slug }).from(categories).orderBy(asc(categories.displayOrder));
  const union = new Set<string>(['category', 'brand', 'brand_slug', 'selling_price', 'in_stock', 'stock', 'ar']);
  for (const c of cats) {
    const t0 = Date.now();
    const cfg = await buildFacetsForCategory(c.slug);
    for (const k of cfg.meili_filterable) union.add(k);
    const vis = (v: FacetVisibility) =>
      cfg.facets
        .filter((f) => f.visibility === v)
        .map((f) => f.key + (f.depends_on ? `↳${f.depends_on.key}` : '') + ('bands' in f && f.bands ? `[${f.bands.length}]` : ''));
    log(
      `  ${c.slug}: ${cfg.facets.length} facets · primary ${vis('primary').join(', ') || '—'} · more ${vis('more').join(', ') || '—'} · toolbar ${vis('toolbar').join(', ')}${cfg.lead_note ? ` · note "${cfg.lead_note}"` : ''}${cfg.dropped.length ? ` · dropped ${cfg.dropped.length}: ${cfg.dropped.map((d) => d.attr).join(', ')}` : ''} · ${cfg.in_stock_count.toLocaleString('en-IN')} in stock · limit ${cfg.depth_rule?.primary_limit} · ${Date.now() - t0} ms`,
    );
  }
  const all = [...union];
  try {
    await ensureIndex(all);
    log(`  meilisearch: ${all.length} filterable attributes in sync`);
  } catch (e) {
    log(`  ! Meilisearch settings not updated (${(e as Error).message}) — the new facets filter only after \`pnpm pipeline derive\` runs with Meilisearch up`);
  }
  return all;
}
