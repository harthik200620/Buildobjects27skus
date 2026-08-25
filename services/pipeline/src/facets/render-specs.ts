#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';
/**
 * Review pages for the filter trees — the category-filters skill's renderer applied to our policy.
 *
 *   pnpm --filter @buildobjects/pipeline exec tsx src/facets/render-specs.ts [--skill <dir>] [--out <dir>]
 *
 * For every category in registry/filter-policy.json this writes a JSON spec in the skill's
 * schema (references/spec-schema.md) to storage/reports/filters/specs/{slug}.json, then runs
 * scripts/render_filters.py --check -o storage/reports/filters/{slug}.html.
 *
 * Three inputs, three kinds of truth, kept apart on purpose:
 *   registry/filter-policy.json          the tree (order, conditionals, bands, labels, omissions)
 *   filter_configs (DB)                  LIVE counts, bands and single-value notes — real today
 *   storage/reports/filters/growth-values.json   ILLUSTRATIVE values/counts for the catalogue the
 *                                        category grows into — marked `illustrative: true` on
 *                                        every value and in each filter's note
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Facet, FacetConfig } from '@buildobjects/catalog';
import { categories, closeDb, filterConfigs, getDb } from '@buildobjects/db';
import { eq } from 'drizzle-orm';
import { REPO_ROOT } from '../config';
import { loadRegistry } from '../registry/seed';
import { type CategoryPolicy, loadPolicy } from './policy';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const OUT = path.resolve(flag('out', path.join(REPO_ROOT, 'storage', 'reports', 'filters')));
const SKILL = flag('skill', process.env.CATEGORY_FILTERS_SKILL ?? '');
const DEFAULT_SKILL = path.join(
  process.env.APPDATA ?? '',
  'Claude',
  'local-agent-mode-sessions',
  'skills-plugin',
  '45c829b9-5ff1-40c5-8159-bd98de5a4bba',
  '8ae16384-18d3-4a28-81fa-3da581f3d629',
  'skills',
  'category-filters',
);

interface GrowthValue {
  value: string;
  label?: string;
  sublabel?: string;
  count?: number;
  match?: string;
}
interface Growth {
  category_path?: string;
  result_count: number;
  lead_reason: string;
  why?: Record<string, string>;
  canonicalise?: string[];
  values?: Record<string, GrowthValue[]>;
  bands?: Record<string, { label: string; count: number }[] | Record<string, number>>;
  toggles?: Record<string, { off_label: string; off_count: number; on_count?: number }>;
  omitted_extra?: { filter: string; reason: string }[];
}
interface SpecValue {
  label: string;
  sublabel?: string;
  count: number;
  reveals?: string[];
  swatch?: string;
  disabled?: boolean;
  illustrative?: boolean;
}
interface SpecFilter {
  id: string;
  label: string;
  cluster: 'spec' | 'commercial' | 'trust' | 'logistics';
  control: 'checkbox' | 'radio' | 'toggle' | 'slider' | 'swatch' | 'range';
  source?: string;
  why?: string;
  depends_on?: { filter: string; value: string };
  visibility?: 'primary' | 'more' | 'conditional';
  default_state?: 'off';
  note?: string;
  needs_verification?: string;
  values: SpecValue[];
}

const TRUST = new Set(['isi_marked', 'almm_listed', 'bis_isi_marked', 'price_basis', 'price_freshness']);
const UNIVERSAL_LABEL: Record<string, string> = { price_basis: 'Price basis', price_freshness: 'Price freshness', stock: 'Availability' };
const fmtLive = (pairs: [string, number][]) => pairs.map(([v, c]) => `${v} (${c})`).join(', ');

function buildSpec(slug: string, name: string, p: CategoryPolicy, cfg: FacetConfig | null, g: Growth) {
  const reg = loadRegistry(slug)!;
  const attr = (k: string) => reg.attributes.find((a) => a.key === k);
  const live = new Map<string, Facet>((cfg?.facets ?? []).map((f) => [f.key, f]));
  const droppedBy = new Map((cfg?.dropped ?? []).map((d) => [d.attr, d]));
  const n = cfg?.in_stock_count ?? 0;
  const notes: string[] = [];

  const labelOf = (k: string) =>
    p.relabel?.[k]?.label ??
    UNIVERSAL_LABEL[k] ??
    (k === 'price' ? (p.price_key ? (p.pack_price_label ?? 'Price per pack') : (p.price_label ?? 'Price')) : k === 'brand' ? 'Brand' : (attr(k)?.label ?? k));
  const clusterOf = (k: string): SpecFilter['cluster'] =>
    k === 'stock' ? 'logistics' : TRUST.has(k) ? 'trust' : k === 'price' || k === 'brand' || k === p.price_key ? 'commercial' : 'spec';
  const sourceOf = (k: string) =>
    k === 'price'
      ? 'skus.selling_price'
      : k === 'brand'
        ? 'brands.name'
        : k === 'stock'
          ? 'skus.stock_status'
          : k === 'price_basis'
            ? 'skus.price_provenance'
            : k === 'price_freshness'
              ? 'skus.price_fetched_at'
              : `sku.attrs.${k}`;
  const liveNote = (k: string): string | null => {
    const f = live.get(k);
    if (f) {
      if (f.kind === 'checkbox' || f.kind === 'chips') return `Live today: ${fmtLive(f.values.map((v) => [v.label ?? v.value, v.count]))}`;
      if (f.kind === 'toggle') return `Live today: ${f.true_label ?? 'Yes'} (${f.true_count})`;
      if (f.kind === 'range' && f.bands) return `Live bands today: ${fmtLive(f.bands.map((b) => [b.label, b.count]))}`;
      if (f.kind === 'range') return `Live today: ${f.min}–${f.max}${f.unit ? ` ${f.unit}` : ''} on ${n} SKUs`;
      return 'Live today: present';
    }
    const d = droppedBy.get(k);
    if (d?.value !== undefined) return `Live today: all ${d.count ?? n} SKUs are ${d.value} — single value, so the engine drops the facet`;
    if (d) return `Live today: none (${d.reason})`;
    return 'No live data yet';
  };

  const filters: SpecFilter[] = [];
  const values: Record<string, GrowthValue[]> = g.values ?? {};
  const canonicalise = new Set(g.canonicalise ?? []);

  const enumValues = (k: string): SpecValue[] => {
    const sub = p.relabel?.[k]?.sublabels ?? {};
    const sw = p.swatches?.[k] ?? {};
    const f = live.get(k);
    const liveCounts = new Map<string, number>();
    if (f && (f.kind === 'checkbox' || f.kind === 'chips')) for (const v of f.values) liveCounts.set(v.value, v.count);
    const d = droppedBy.get(k);
    if (!f && d?.value !== undefined && !canonicalise.has(k)) liveCounts.set(d.value, d.count ?? n);
    const out: SpecValue[] = [];
    const seen = new Set<string>();
    for (const gv of values[k] ?? []) {
      const key = gv.match ?? gv.value;
      const lc = canonicalise.has(k) ? undefined : liveCounts.get(key);
      seen.add(key);
      const count = lc ?? gv.count;
      if (count === undefined) throw new Error(`${slug}.${k}: "${gv.value}" has no live count and no growth count`);
      out.push({
        label: gv.label ?? gv.value,
        ...((gv.sublabel ?? sub[gv.value]) ? { sublabel: gv.sublabel ?? sub[gv.value] } : {}),
        count,
        ...(sw[gv.value] ? { swatch: sw[gv.value] } : {}),
        ...(lc === undefined ? { illustrative: true } : {}),
        ...(count === 0 ? { disabled: true } : {}),
      });
    }
    if (!canonicalise.has(k))
      for (const [v, c] of liveCounts)
        if (!seen.has(v)) out.push({ label: v, ...(sub[v] ? { sublabel: sub[v] } : {}), count: c, ...(sw[v] ? { swatch: sw[v] } : {}) });
    return out;
  };
  const bandValues = (k: string): SpecValue[] => {
    const spec = k === 'price' ? (p.bands?.price ?? 'quartiles') : p.bands?.[k];
    const f = live.get(k);
    const gb = g.bands?.[k];
    if (spec && spec !== 'quartiles') {
      const fill = (gb && !Array.isArray(gb) ? gb : {}) as Record<string, number>;
      const liveBands = new Map((f && f.kind === 'range' && f.bands ? f.bands : []).map((b) => [b.label, b.count]));
      /* a single-valued number the engine dropped ("6500 K" on every bulb) still lives in exactly one band */
      const d = droppedBy.get(k);
      const single = d?.value !== undefined ? Number(String(d.value).replace(/[^\d.-]/g, '')) : NaN;
      if (!f && Number.isFinite(single)) {
        const i = spec.edges.findIndex((e) => single < e);
        liveBands.set(spec.labels![i < 0 ? spec.edges.length : i], d!.count ?? n);
      }
      return spec.labels!.map((label, i) => {
        const lc = liveBands.get(label);
        const count = lc && lc > 0 ? lc : (fill[label] ?? 0);
        return {
          label,
          count,
          ...(spec.swatches?.[i] ? { swatch: spec.swatches[i] } : {}),
          ...(lc && lc > 0 ? {} : { illustrative: true }),
          ...(count === 0 ? { disabled: true } : {}),
        };
      });
    }
    if (!gb || !Array.isArray(gb)) throw new Error(`${slug}.${k}: a quartile/range facet needs illustrative bands in growth-values.json`);
    return gb.map((b) => ({ label: b.label, count: b.count, illustrative: true, ...(b.count === 0 ? { disabled: true } : {}) }));
  };
  const toggleValues = (k: string): SpecValue[] => {
    const f = live.get(k);
    const t = g.toggles?.[k];
    const onLabel = (f && f.kind === 'toggle' && f.true_label) || p.relabel?.[k]?.true_label || (k === 'stock' ? 'In stock only' : 'Yes');
    const on = f && f.kind === 'toggle' ? f.true_count : (t?.on_count ?? 0);
    const off = t?.off_count ?? Math.max(n - on, 0);
    return [
      { label: onLabel, count: on, ...(f ? {} : { illustrative: true }), ...(on === 0 ? { disabled: true } : {}) },
      { label: t?.off_label ?? 'No', count: off, illustrative: true, ...(off === 0 ? { disabled: true } : {}) },
    ];
  };

  const make = (k: string, visibility: SpecFilter['visibility']): SpecFilter => {
    const a = attr(k);
    /* a number attribute the registry renders as a checkbox (pack sizes) lists its values in growth-values instead of bands */
    const isRange = k === 'price' || (a?.data_type === 'number' && !values[k]);
    const isBool = a?.data_type === 'boolean' || k === 'stock' || k === 'price_freshness';
    const hasSwatch = !!p.swatches?.[k] || (p.bands?.[k] && p.bands[k] !== 'quartiles' && !!(p.bands[k] as { swatches?: string[] }).swatches);
    const vals = isBool ? toggleValues(k) : isRange ? bandValues(k) : enumValues(k);
    const control: SpecFilter['control'] = isBool ? 'toggle' : hasSwatch ? 'swatch' : isRange ? 'radio' : 'checkbox';
    const noteParts = [p.notes?.[k], liveNote(k), vals.some((v) => v.illustrative) ? 'Values without live stock carry illustrative counts.' : null].filter(
      Boolean,
    ) as string[];
    if (canonicalise.has(k)) {
      const f = live.get(k);
      const d = droppedBy.get(k);
      noteParts.push(
        `Live values are uncanonicalised text today (${f && 'values' in f ? f.values.length : (d?.count ?? 0)} declared string${(f && 'values' in f ? f.values.length : 1) === 1 ? '' : 's'}) — shown as declared until the pipeline canonicalises them.`,
      );
    }
    const f: SpecFilter = {
      id: k,
      label: labelOf(k),
      cluster: clusterOf(k),
      control,
      source: sourceOf(k),
      why: g.why?.[k],
      ...(visibility && visibility !== 'primary' ? { visibility } : {}),
      ...(p.default_off?.includes(k) ? { default_state: 'off' as const } : {}),
      note: noteParts.join(' · '),
      ...(p.needs_verification?.[k] ? { needs_verification: p.needs_verification[k] } : {}),
      values: vals,
    };
    return f;
  };

  /* rail order: policy primary (with price/brand tokens), conditionals after their parent, stock, then the fold */
  const primaryKeys = [...p.primary];
  if (!primaryKeys.includes('price') && !p.price_key) primaryKeys.push('price');
  if (!primaryKeys.includes('brand')) primaryKeys.push('brand');
  const conditional = p.conditional ?? {};
  const childrenOf = (parent: string) =>
    Object.entries(conditional)
      .filter(([, c]) => c.depends_on === parent)
      .map(([k]) => k);
  const addWithChildren = (k: string, vis: SpecFilter['visibility']) => {
    filters.push(make(k, vis));
    for (const c of childrenOf(k)) {
      const spec = conditional[c];
      const parent = filters.find((f) => f.id === k)!;
      const child = make(c, 'conditional');
      let parentValues: string[] = [];
      if (spec.values) parentValues = spec.values;
      else if (spec.min !== undefined)
        parentValues = parent.values
          .filter((v) => {
            const m = v.label.match(/([\d.]+)/);
            return !!m && (v.label.includes('above') || Number(m[1]) >= spec.min!);
          })
          .map((v) => v.label);
      const present = parentValues.filter((v) => parent.values.some((pv) => pv.label === v));
      if (!present.length) {
        notes.push(`${slug}: conditional ${c} — none of its parent values are in the rendered ${k} list; shown without a dependency`);
        filters.push({ ...child, visibility: 'more' });
        continue;
      }
      child.depends_on = { filter: k, value: present[0] };
      for (const pv of parent.values) if (present.includes(pv.label)) (pv.reveals ??= []).push(c);
      filters.push(child);
    }
  };
  for (const k of primaryKeys) addWithChildren(k, 'primary');
  filters.push(make('stock', 'primary'));
  for (const k of p.more ?? []) addWithChildren(k, 'more');
  if (p.price_key && !primaryKeys.includes('price')) filters.push(make('price', 'more'));
  const universal = p.universal ?? { price_basis: true, price_freshness: true };
  if (universal.price_basis !== false) filters.push(make('price_basis', 'more'));
  if (universal.price_freshness !== false) filters.push(make('price_freshness', 'more'));

  const omitted = [
    ...(p.omit ?? []).map((o) => ({
      filter: attr(o.key)?.label ?? o.key,
      reason:
        o.key === 'isi_marked' && p.certification_note
          ? `${p.certification_note.text} ${o.reason}${p.certification_note.needs_verification ? ' — needs verification' : ''}`
          : o.reason,
    })),
    ...(g.omitted_extra ?? []),
  ];
  const spec = {
    category: name,
    category_path: g.category_path,
    canonical_unit: p.canonical_unit,
    result_count: g.result_count,
    counts_are_illustrative: true,
    lead_filter: p.lead,
    lead_reason: g.lead_reason,
    ...(cfg?.lead_note ? { lead_note_today: cfg.lead_note } : {}),
    ...(p.certification_note ? { certification_note: p.certification_note } : {}),
    depth_rule_today: cfg?.depth_rule,
    filters,
    omitted,
  };
  return { spec, notes };
}

async function main() {
  const skillDir = SKILL || DEFAULT_SKILL;
  const renderer = path.join(skillDir, 'scripts', 'render_filters.py');
  if (!fs.existsSync(renderer)) throw new Error(`renderer not found at ${renderer} — pass --skill <category-filters dir>`);
  const growth = JSON.parse(fs.readFileSync(path.join(OUT, 'growth-values.json'), 'utf8')) as Record<string, Growth>;
  const policy = loadPolicy();
  const db = getDb();
  fs.mkdirSync(path.join(OUT, 'specs'), { recursive: true });
  const summary: string[] = [];
  for (const [slug, p] of Object.entries(policy.categories)) {
    const [row] = await db
      .select({ name: categories.name, config: filterConfigs.config })
      .from(categories)
      .leftJoin(filterConfigs, eq(filterConfigs.categoryId, categories.id))
      .where(eq(categories.slug, slug));
    const cfg = (row?.config as FacetConfig | null) ?? null;
    const g = growth[slug];
    if (!g) {
      console.log(`  ${slug}: no growth-values entry — skipped`);
      continue;
    }
    const { spec, notes } = buildSpec(slug, row?.name ?? slug, p, cfg, g);
    const specFile = path.join(OUT, 'specs', `${slug}.json`);
    fs.writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
    const html = path.join(OUT, `${slug}.html`);
    /* the renderer prints "✓" — force UTF-8 so a cp1252 Windows console does not kill it before the HTML is written */
    const r = spawnSync('python', [renderer, specFile, '--check', '-o', html], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const out = `${r.stdout}${r.stderr}`
      .trim()
      .split(/\r?\n/)
      .map((l) => `      ${l}`)
      .join('\n');
    console.log(
      `  ${slug}: ${spec.filters.length} filters (${spec.filters.filter((f) => f.depends_on).length} conditional, ${spec.filters.filter((f) => f.visibility === 'more').length} in More) → ${path.relative(REPO_ROOT, html)}\n${out}`,
    );
    for (const note of notes) console.log(`      note: ${note}`);
    summary.push(`${slug}: exit ${r.status}`);
  }
  console.log(summary.join(' · '));
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
