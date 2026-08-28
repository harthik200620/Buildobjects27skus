import { z } from 'zod';

/**
 * Where a value came from. `derived` is arithmetic on values already stated on the same
 * SKU — luminous intensity from flux and beam angle, fill factor from Vmp/Imp/Voc/Isc —
 * and carries the formula in `note`. It is neither read off a source nor guessed, so it is
 * neither `fetched` nor `ai_filled`.
 */
export const PROVENANCE = ['fetched', 'verified', 'ai_filled', 'derived'] as const;
export type Provenance = (typeof PROVENANCE)[number];
export const PRICE_PROVENANCE = ['fetched', 'verified', 'estimated'] as const;
export const IMAGE_ROLES = ['hero', 'angle', 'in_context', 'detail', 'pack_or_dimensions'] as const;
export type ImageRole = (typeof IMAGE_ROLES)[number];
/**
 * Where a stored image came from (images v2). `curated` = a URL a human recorded in the curated
 * file on an official host; `official_page` = discovered on the captured official product page;
 * `official_pdf` = extracted from an official datasheet; `distributor` = a marketplace / dealer
 * listing recorded by a human (used only when nothing official is hero-eligible, shown as such);
 * `unknown` = a curated URL on a host we could not classify. Never generated, never AI-upscaled.
 */
export const IMAGE_SOURCE_KINDS = ['curated', 'official_page', 'official_pdf', 'distributor', 'unknown'] as const;
/** The judge's view classification (mirrors @buildobjects/llm IMAGE_VIEWS — kept identical on purpose). */
export const IMAGE_VIEWS = ['front', 'angle', 'side', 'back', 'top', 'detail', 'in_context', 'pack', 'drawing', 'other'] as const;
export type ImageView = (typeof IMAGE_VIEWS)[number];
export const IMAGE_BACKGROUNDS = ['white', 'studio', 'in_use', 'cluttered'] as const;
export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number];

/**
 * What `sku_images.judge_json` holds: the verdict a stored image passed, who judged it, and the
 * deterministic score it got (0.45·match + 0.25·sharpness + 0.15·whole + 0.15·bg − logo − 0.5·watermark − 0.2·packaging).
 * `provider: 'heuristic'` = no Gemini key — size / aspect / edge-whiteness / Laplacian proxies, labelled so.
 */
export interface ImageJudgement {
  provider: 'gemini' | 'heuristic';
  model: string | null;
  score: number;
  is_product_photo: boolean;
  shows_whole_product: boolean;
  is_packaging_only: boolean;
  is_logo_or_icon: boolean;
  is_dimension_drawing: boolean;
  has_watermark_or_text_overlay: boolean;
  brand_visible: boolean;
  background: ImageBackground;
  view: ImageView;
  sharpness: number;
  match_to_product_name: number;
  suggested_role: 'hero' | 'angle' | 'detail' | 'in_context' | 'pack' | 'reject';
  reason: string;
  judged_at: string;
  /** Cut-out provenance when one was written: which mask won and why. */
  cutout?: { provider: 'gemini' | 'knockout'; iou: number | null; area: number; note: string };
}
export const DOC_TYPES = ['brochure', 'datasheet', 'manual', 'warranty_card', 'certificate'] as const;
export const STOCK = ['in_stock', 'low', 'out_of_stock', 'preorder'] as const;
const url = z.string().url().nullable().optional();

export const IntelLeafSchema = z.object({
  value: z.unknown(),
  provenance: z.enum([...PROVENANCE, 'estimated']),
  source_url: url,
});
export const BrandIntelSchema = z.record(z.string(), IntelLeafSchema);

export const AttributeValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  unit: z.string().nullable().optional(),
  provenance: z.enum(PROVENANCE),
  source_url: url,
  source_urls: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  /** Why the stored value differs from what the source said (canonicalisation, coercion, the AI-fill basis). ≤ 512 chars. */
  note: z.string().max(512).optional(),
});
export type AttributeValue = z.infer<typeof AttributeValueSchema>;

export const CuratedImageSchema = z.object({
  role: z.enum(IMAGE_ROLES),
  source_url: url,
  alt: z.string().optional().default(''),
  content_type: z.string().optional(),
  bytes: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  checked: z.boolean().optional().default(false),
});
export const CuratedDocumentSchema = z.object({
  type: z.enum(DOC_TYPES),
  title: z.string(),
  source_url: z.string().url(),
  checked: z.boolean().optional().default(false),
});

/** The pipeline's unit of truth: one SKU as extracted (live) or curated (fixture). */
export const CuratedSkuSchema = z.object({
  sku_code: z.string().regex(/^[A-Z]{3}-[A-Z]{3}-[A-Z0-9-]{1,16}$/),
  category: z.string(),
  brand: z.object({
    slug: z.string(),
    name: z.string(),
    official_domains: z.array(z.string()).default([]),
    logo_url: url,
    intel: BrandIntelSchema.default({}),
  }),
  product: z.object({
    name: z.string(),
    slug: z.string(),
    model_no: z.string().nullable().optional(),
    status: z.enum(['active', 'draft', 'retired']).default('active'),
  }),
  variant_label: z.string().default(''),
  unit: z.string(),
  pack_qty: z.number().positive().default(1),
  price: z.object({
    mrp: z.number().nonnegative().nullable(),
    selling_price: z.number().nonnegative().nullable(),
    currency: z.string().default('INR'),
    provenance: z.enum(PRICE_PROVENANCE),
    source_url: url,
    fetched_at: z.string().optional(),
    note: z.string().optional(),
  }),
  gst_rate: z.number(),
  gst_needs_verification: z.boolean().optional().default(false),
  sources: z.object({
    official_product_url: z.string().url(),
    datasheet_urls: z.array(z.string()).default([]),
    secondary_urls: z.array(z.string()).default([]),
  }),
  attributes: z.record(z.string(), AttributeValueSchema),
  images: z.array(CuratedImageSchema).default([]),
  documents: z.array(CuratedDocumentSchema).default([]),
  key_specs: z.array(z.string()).default([]),
  short_description: z.string().max(200).default(''),
  long_description: z.string().default(''),
  seo: z
    .object({
      title: z.string().optional(),
      meta_description: z.string().optional(),
      keywords: z.array(z.string()).default([]),
      keywords_te: z.array(z.string()).default([]),
      keywords_hi: z.array(z.string()).default([]),
    })
    .default({ keywords: [], keywords_te: [], keywords_hi: [] }),
});
export type CuratedSku = z.infer<typeof CuratedSkuSchema>;

/** One row of the PDP read-model (skus.spec_json). Regenerated on every write. */
export interface SpecRow {
  key: string;
  label: string;
  value: string | number | boolean;
  unit: string | null;
  data_type: string;
  provenance: Provenance;
  confidence: number | null;
  source_url: string | null;
  compare: boolean /** Canonicalisation / coercion / AI-fill basis note (images v2 pipeline); absent when the value is verbatim. */;
  note?: string | null;
}
export interface SpecGroup {
  key: string;
  label: string;
  importance: number;
  rows: SpecRow[];
}
export interface SpecJson {
  groups: SpecGroup[];
  filled: number;
  total: number;
  by_provenance: Record<Provenance, number>;
}
export interface KeySpec {
  key: string;
  label: string;
  value: string;
  unit: string | null;
}
