/**
 * The per-category filter policy — registry/filter-policy.json — is DATA that describes the
 * full filter tree each catalogue grows into (the category-filters skill applied). The facet
 * engine (build.ts) merges it with the data rule: the policy decides order, visibility,
 * conditionals, bands, labels and omissions; live data decides what exists at all.
 *
 * Every attribute key the policy names must exist in the category's registry file, every
 * conditional value must be a registry enum value — loadPolicy() throws otherwise, so a typo
 * can never silently drop a facet. Reserved keys the engine computes itself: price, brand, stock.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REGISTRY_DIR } from '../config';
import { loadRegistry } from '../registry/seed';

export const RESERVED_KEYS = ['price', 'brand', 'stock'] as const;

export interface BandSpec {
  edges: number[];
  labels?: string[];
  swatches?: string[];
}
export interface ConditionalSpec {
  depends_on: string;
  values?: string[];
  min?: number;
  max?: number;
}

export interface CategoryPolicy {
  /** The selling unit the price facet is on — "bag (50 kg)", "sq ft". */
  canonical_unit: string;
  /** Label of the engine's selling_price facet ("Price per bag"). */
  price_label?: string;
  /** A registry number attribute that IS the canonical-unit price (tiles: price_per_sqft); the selling_price facet is then the pack price. */
  price_key?: string;
  /** Label of the selling_price facet when price_key is set ("Price per box"). */
  pack_price_label?: string;
  /** The defining attribute. Dropped single-valued → a page note instead of a facet. */
  lead: string;
  /** Template for that note: {n} = in-stock count in words, {key} = the single value (+ unit). Only rendered when every referenced key is single-valued. */
  lead_note?: string;
  /** Cement / TMT: brand climbs above price. Informational when 'brand' is already placed in `primary`. */
  brand_first?: boolean;
  /** Rail order. May contain the reserved tokens 'price' and 'brand' to place them; otherwise they are appended. */
  primary: string[];
  /** The collapsed "More filters" fold, in order. Capped at 6 by the engine. */
  more?: string[];
  /** Toggles above the results — always ['stock'] today. */
  toolbar?: string[];
  /** Sub-filters: shown only after the parent value (checkbox parent) or a selection ≥ min / ≤ max (range parent). */
  conditional?: Record<string, ConditionalSpec>;
  /** Range facets that render as radio bands: 'quartiles' from the live distribution, or explicit edges. 'price' = the selling_price facet. */
  bands?: Record<string, 'quartiles' | BandSpec>;
  /** Buyer-language labels and per-value sublabels ("R11" → "wet areas"). */
  relabel?: Record<string, { label?: string; sublabels?: Record<string, string>; true_label?: string }>;
  /** value → CSS colour for swatch controls. */
  swatches?: Record<string, Record<string, string>>;
  /** Free text under a facet heading. */
  notes?: Record<string, string>;
  /** Regulatory / certification wording that is not confirmed against a primary source. */
  needs_verification?: Record<string, string>;
  /** Certification-style facets: label, never hide, never pre-applied. */
  default_off?: string[];
  /** Copy line replacing a mandatory-certification filter. */
  certification_note?: { text: string; needs_verification: boolean; detail?: string };
  /** Considered and rejected, with the reason — the engine drops these even when the data rule passes. */
  omit?: { key: string; reason: string }[];
  /** The universal layer computed by the engine. */
  universal?: { price_basis?: boolean; price_freshness?: boolean };
}

export interface FilterPolicy {
  version: number;
  categories: Record<string, CategoryPolicy>;
}

const POLICY_FILE = path.join(REGISTRY_DIR, 'filter-policy.json');

let cache: FilterPolicy | null = null;

/** Parse + validate the policy against the registry files. Throws with every violation listed. */
export function loadPolicy(): FilterPolicy {
  if (cache) return cache;
  if (!fs.existsSync(POLICY_FILE)) {
    cache = { version: 0, categories: {} };
    return cache;
  }
  const raw = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) as FilterPolicy;
  const errors: string[] = [];
  for (const [slug, p] of Object.entries(raw.categories ?? {})) {
    const reg = loadRegistry(slug);
    if (!reg) {
      errors.push(`${slug}: no registry file`);
      continue;
    }
    const attrs = new Map(reg.attributes.map((a) => [a.key, a]));
    const known = (k: string) => attrs.has(k) || (RESERVED_KEYS as readonly string[]).includes(k);
    const need = (k: string, where: string) => {
      if (!known(k)) errors.push(`${slug}: ${where} names "${k}", which is not in registry/${slug}.json`);
    };
    need(p.lead, 'lead');
    if (p.price_key) need(p.price_key, 'price_key');
    for (const k of p.primary ?? []) need(k, 'primary');
    for (const k of p.more ?? []) need(k, 'more');
    for (const k of p.toolbar ?? []) need(k, 'toolbar');
    for (const [k, c] of Object.entries(p.conditional ?? {})) {
      need(k, 'conditional');
      need(c.depends_on, `conditional.${k}.depends_on`);
      const parent = attrs.get(c.depends_on);
      if (parent?.data_type === 'enum' && c.values)
        for (const v of c.values)
          if (!parent.enum_values?.includes(v)) errors.push(`${slug}: conditional.${k} value "${v}" is not an enum value of ${c.depends_on}`);
      if (parent?.data_type === 'number' && c.values)
        errors.push(`${slug}: conditional.${k} uses values on the number attribute ${c.depends_on} — use min/max`);
      if (!c.values && c.min === undefined && c.max === undefined) errors.push(`${slug}: conditional.${k} needs values or min/max`);
    }
    for (const [k, b] of Object.entries(p.bands ?? {})) {
      need(k, 'bands');
      const a = attrs.get(k);
      if (a && a.data_type !== 'number') errors.push(`${slug}: bands.${k} is not a number attribute`);
      if (b !== 'quartiles') {
        if (!Array.isArray(b.edges) || b.edges.length < 1) errors.push(`${slug}: bands.${k}.edges must list at least one edge`);
        else if (b.edges.some((e, i) => i > 0 && e <= b.edges[i - 1])) errors.push(`${slug}: bands.${k}.edges must be ascending`);
        if (b.labels && b.labels.length !== b.edges.length + 1) errors.push(`${slug}: bands.${k}.labels needs ${b.edges.length + 1} entries (edges + 1)`);
        if (b.swatches && b.swatches.length !== b.edges.length + 1) errors.push(`${slug}: bands.${k}.swatches needs ${b.edges.length + 1} entries`);
      }
    }
    for (const [k, r] of Object.entries(p.relabel ?? {})) {
      need(k, 'relabel');
      const a = attrs.get(k);
      if (a?.data_type === 'enum' && r.sublabels)
        for (const v of Object.keys(r.sublabels)) if (!a.enum_values?.includes(v)) errors.push(`${slug}: relabel.${k}.sublabels "${v}" is not an enum value`);
    }
    for (const [k, s] of Object.entries(p.swatches ?? {})) {
      need(k, 'swatches');
      const a = attrs.get(k);
      if (a?.data_type === 'enum')
        for (const v of Object.keys(s)) if (!a.enum_values?.includes(v)) errors.push(`${slug}: swatches.${k} "${v}" is not an enum value`);
    }
    for (const k of Object.keys(p.notes ?? {})) need(k, 'notes');
    for (const k of Object.keys(p.needs_verification ?? {})) need(k, 'needs_verification');
    for (const k of p.default_off ?? []) need(k, 'default_off');
    for (const o of p.omit ?? []) {
      need(o.key, 'omit');
      if (!o.reason) errors.push(`${slug}: omit.${o.key} has no reason`);
    }
    for (const m of (p.lead_note ?? '').matchAll(/\{([a-z_0-9]+)\}/g)) if (m[1] !== 'n') need(m[1], 'lead_note');
    const listed = [...(p.primary ?? []), ...(p.more ?? []), ...Object.keys(p.conditional ?? {})];
    for (const k of listed) if (listed.indexOf(k) !== listed.lastIndexOf(k)) errors.push(`${slug}: "${k}" is listed twice across primary/more/conditional`);
    for (const o of p.omit ?? []) if (listed.includes(o.key)) errors.push(`${slug}: "${o.key}" is both omitted and listed`);
    for (const k of listed) {
      if ((RESERVED_KEYS as readonly string[]).includes(k)) continue;
      const a = attrs.get(k);
      if (a && !a.is_filterable) errors.push(`${slug}: "${k}" is listed but the registry marks it is_filterable: false`);
    }
  }
  if (errors.length) throw new Error(`filter-policy.json does not match the registry:\n  ${errors.join('\n  ')}`);
  cache = raw;
  return raw;
}

export function policyFor(slug: string): CategoryPolicy | null {
  return loadPolicy().categories[slug] ?? null;
}

export function policyPath(): string {
  return POLICY_FILE;
}
