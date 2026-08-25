/** The Meilisearch document for index `skus`. Flat on purpose: facets are top-level `attr_*` fields. */
export interface SkuSearchDoc {
  id: number;
  sku_code: string;
  slug: string;
  name: string;
  brand: string;
  brand_slug: string;
  category: string; // slug — filterable
  category_name: string; // en
  category_name_te: string;
  category_name_hi: string;
  model_no: string;
  variant_label: string;
  short_description: string;
  synonyms: string[]; // category + brand + intent words, all scripts
  spec_text: string[]; // flattened key spec values ("9 W", "B22", "Warm white 3000 K")
  selling_price: number | null;
  mrp: number | null;
  price_provenance: string;
  unit: string;
  pack_qty: number;
  stock: 'in_stock' | 'low' | 'out_of_stock' | 'preorder';
  in_stock: boolean;
  hero_image_key: string | null;
  blurhash: string | null;
  /** Images v2: the hero's alpha cut-out card (`{pos}-cutout-card.webp`) when one exists — tiles and "in your room" previews prefer it. */
  cutout_key: string | null;
  /** The brand's logo key — the honest "no official photo yet" state when `image_count` is 0. */
  brand_logo_key: string | null;
  /** Real (never placeholder) images stored for the SKU, 0–5. */
  image_count: number;
  /** Epoch seconds the price was last checked (price_freshness facet: `price_fetched_at >= now − 7 d`); null when never. */
  price_fetched_at?: number | null;
  card_specs: { label: string; value: string }[];
  ar: boolean;
  created_at: number; // epoch seconds — sortable
  [attr: `attr_${string}`]: string | number | boolean | string[] | null | undefined;
}

export const SEARCH_INDEX = 'skus';

/** Indic script detection for the query normaliser. */
export function detectScript(q: string): 'latin' | 'telugu' | 'devanagari' | 'other' {
  if (/[ఀ-౿]/.test(q)) return 'telugu';
  if (/[ऀ-ॿ]/.test(q)) return 'devanagari';
  if (/^[\x00-\x7F -ɏ\s₹]*$/.test(q)) return 'latin';
  return 'other';
}
