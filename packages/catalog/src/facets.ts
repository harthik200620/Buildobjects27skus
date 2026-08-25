/**
 * The computed facet tree (filter_configs.config). Built by the facet engine from the
 * registry + live data + the per-category filter policy (registry/filter-policy.json);
 * rendered by the PLP with zero category-specific code.
 *
 * Every field added for the policy merge is OPTIONAL and additive — a config written by the
 * pre-policy engine is still a valid FacetConfig, and a consumer that ignores the new fields
 * keeps working. The semantics the listing UI codes against:
 *
 *   visibility     'primary' → in the rail · 'more' → inside the collapsed "More filters" fold ·
 *                  'toolbar' → a toggle above the results (In stock only). Facets without it: 'primary'.
 *   depends_on     shown only after the parent facet has the listed value(s) selected (checkbox parent)
 *                  or a selection within [min, max] (range parent). Conditionals do not count toward
 *                  the primary budget.
 *   bands          range facets: radio bands [lo, hi) on the real distribution — filter `attr >= lo`
 *                  and `attr < hi` (null = open end). `count` is the in-stock SKU count in the band.
 *   sublabel       checkbox/chips: value → quieter text beside it ("hot & cold", "wet areas").
 *   swatch         checkbox/chips: value → CSS colour for a swatch control.
 *   values[].label display label when the stored value is not display-ready (price_basis: fetched → Fetched).
 *   true_label     toggle: the text of the single checkbox ("In stock only", "Checked in the last 7 days").
 *   since_days     toggle over a timestamp attribute (epoch seconds): filter `attr >= now − since_days·86400`.
 *   default_off    certification-style facets: label, never hide — render unchecked, never pre-apply.
 *   note           free text under the facet heading; needs_verification an amber flag (regulatory wording).
 *   lead / lead_note  the policy's lead attribute, and the page note when it was dropped single-valued
 *                  ("All four cements here are PPC 50 kg bags").
 *   depth_rule     how many primary facets the rail may show for this catalogue depth (< 20 SKUs → 4, else 8).
 */
export type FacetKind = 'checkbox' | 'range' | 'toggle' | 'chips';
export type FacetVisibility = 'primary' | 'more' | 'toolbar';

export interface FacetValue {
  value: string;
  count: number;
  label?: string;
}
export interface FacetBand {
  lo: number | null;
  hi: number | null;
  label: string;
  count: number;
  swatch?: string;
}
export interface FacetDependsOn {
  key: string;
  values?: string[];
  min?: number;
  max?: number;
}

export interface FacetBase {
  key: string;
  attr: string;
  label: string;
  kind: FacetKind;
  order: number;
  unit?: string | null;
  importance?: number;
  visibility?: FacetVisibility;
  depends_on?: FacetDependsOn;
  sublabel?: Record<string, string>;
  swatch?: Record<string, string>;
  note?: string;
  needs_verification?: string;
  default_off?: boolean;
}
export interface CheckboxFacet extends FacetBase {
  kind: 'checkbox' | 'chips';
  values: FacetValue[];
}
export interface RangeFacet extends FacetBase {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  histogram?: number[];
  bands?: FacetBand[];
}
export interface ToggleFacet extends FacetBase {
  kind: 'toggle';
  true_count: number;
  true_label?: string;
  since_days?: number;
}
export type Facet = CheckboxFacet | RangeFacet | ToggleFacet;

export interface FacetConfig {
  category: string;
  computed_at: string;
  sku_count: number;
  in_stock_count: number;
  /** Display order: primary facets (conditionals right after their parent), then 'more', then 'toolbar'. */
  facets: Facet[];
  /** Attributes that were registered filterable but failed the data rule (or the policy omitted them), with the reason. `value`/`count` describe the single value when that was the reason. */
  dropped: { attr: string; reason: string; value?: string; count?: number }[];
  /** Meilisearch filterable attribute names written in the same pass (`attr_{key}`, plus engine attributes such as price_provenance). */
  meili_filterable: string[];
  /** The selling unit the price facet is on ("bag (50 kg)", "sq ft"). */
  canonical_unit?: string;
  /** The policy's lead attribute key. */
  lead?: string;
  /** Page note generated when the lead attribute was dropped as single-valued. */
  lead_note?: string;
  /** Copy line replacing a mandatory-certification filter (cement/BIS). `needs_verification` flags unconfirmed regulatory wording. */
  certification_note?: { text: string; needs_verification: boolean; detail?: string };
  /** `primary_limit` = how many primary facets the rail shows at this catalogue depth. */
  depth_rule?: { sku_count: number; primary_limit: number };
  policy_version?: number;
}

/** URL state → Meilisearch filter. Shared by the PLP and /search so both stay identical. */
export interface FilterState {
  brand?: string[];
  price?: [number | null, number | null];
  stock?: boolean;
  attrs: Record<string, string[] | [number | null, number | null] | boolean>;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'newest';
}

/** Round a range to a "nice" step (5 W steps for wattage, ₹50 for price, …). */
export function niceStep(min: number, max: number, targetBuckets = 20): number {
  const span = Math.max(max - min, 1e-9);
  const raw = span / targetBuckets;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}
