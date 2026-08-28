import { clamp01 } from '@buildobjects/catalog';
import { z } from 'zod';
import type { Usage } from './cost';
import { generateJson, type ImageInput, imagePart, type LlmPart } from './generate';
import { resolveModel } from './models';
import { arr, bool, enumOf, int, type JsonSchema, obj, score, str } from './schema';

// ── image-quality judge (T4 pipeline images v2) ──────────────────────────────

export const IMAGE_BACKGROUNDS = ['white', 'studio', 'in_use', 'cluttered'] as const;
export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number];
export const IMAGE_VIEWS = ['front', 'angle', 'side', 'back', 'top', 'detail', 'in_context', 'pack', 'drawing', 'other'] as const;
export type ImageView = (typeof IMAGE_VIEWS)[number];
export const SUGGESTED_ROLES = ['hero', 'angle', 'detail', 'in_context', 'pack', 'reject'] as const;
/** Background weight in the deterministic score. */
export const BG_WEIGHT: Record<ImageBackground, number> = { white: 1, studio: 0.9, in_use: 0.6, cluttered: 0.2 };

export const ImageJudgementZ = z.object({
  index: z.number().int().min(1),
  is_product_photo: z.boolean(),
  shows_whole_product: z.boolean(),
  is_packaging_only: z.boolean(),
  is_logo_or_icon: z.boolean(),
  is_dimension_drawing: z.boolean(),
  has_watermark_or_text_overlay: z.boolean(),
  brand_visible: z.boolean(),
  background: z.enum(IMAGE_BACKGROUNDS),
  view: z.enum(IMAGE_VIEWS),
  sharpness: z.number().min(0).max(1),
  match_to_product_name: z.number().min(0).max(1),
  suggested_role: z.enum(SUGGESTED_ROLES),
  reason: z.string().max(600),
});
export type ImageJudgement = z.infer<typeof ImageJudgementZ>;
export const ImageJudgeBatchZ = z.object({ items: z.array(ImageJudgementZ) });
export const IMAGE_JUDGE_ITEM_SCHEMA: JsonSchema = obj({
  index: int('1-based position of the image among the numbered image parts'),
  is_product_photo: bool('a photograph (or photoreal render) of the physical product itself'),
  shows_whole_product: bool('the complete product is in frame, not cropped'),
  is_packaging_only: bool('only the box / bag / carton is visible, not the product'),
  is_logo_or_icon: bool('a logo, icon, badge, banner, chart or text graphic rather than a product image'),
  is_dimension_drawing: bool('a line drawing, dimension diagram or CAD view'),
  has_watermark_or_text_overlay: bool('watermark, stamp, price tag, promotional text or UI chrome over the image'),
  brand_visible: bool('the brand name or mark is legible on the product'),
  background: enumOf(
    IMAGE_BACKGROUNDS,
    'white = pure white or transparent cut-out; studio = plain seamless backdrop; in_use = installed, in a room or on site; cluttered = busy or distracting background',
  ),
  view: enumOf(IMAGE_VIEWS),
  sharpness: score('focus and resolution as seen: 1 = crisp, 0 = blurry or pixelated'),
  match_to_product_name: score('certainty that this image shows exactly the named product (brand, model, variant), not a sibling'),
  suggested_role: enumOf(
    SUGGESTED_ROLES,
    'hero = best whole-product shot; angle = secondary whole-product view; detail = close-up; in_context = installed or in use; pack = packaging or dimension drawing; reject = unusable',
  ),
  reason: str('one sentence'),
});

/** Batch schema: `{ items: ImageJudgement[] }` — one entry per numbered image part. */
export const imageJudgeBatchSchema = (): JsonSchema => obj({ items: arr(IMAGE_JUDGE_ITEM_SCHEMA) });

/**
 * Deterministic quality score from a judgement:
 * 0.45·match + 0.25·sharpness + 0.15·whole + 0.15·bg(white 1, studio .9, in_use .6, cluttered .2)
 * − 1.0·logo − 0.5·watermark − 0.2·packaging_only, clamped to 0–1.
 */
export function scoreImageJudgement(
  j: Pick<
    ImageJudgement,
    'match_to_product_name' | 'sharpness' | 'shows_whole_product' | 'background' | 'is_logo_or_icon' | 'has_watermark_or_text_overlay' | 'is_packaging_only'
  >,
): number {
  const raw =
    0.45 * clamp01(j.match_to_product_name) +
    0.25 * clamp01(j.sharpness) +
    0.15 * (j.shows_whole_product ? 1 : 0) +
    0.15 * (BG_WEIGHT[j.background] ?? 0) -
    (j.is_logo_or_icon ? 1 : 0) -
    0.5 * (j.has_watermark_or_text_overlay ? 1 : 0) -
    0.2 * (j.is_packaging_only ? 1 : 0);
  return Math.round(clamp01(raw) * 1000) / 1000;
}

export interface ProductIdentity {
  brand: string;
  name: string;
  category: string;
  variant?: string;
  sku?: string;
}

const describeProduct = (p: ProductIdentity) => `${p.brand} ${p.name}${p.variant ? ` (${p.variant})` : ''} — category: ${p.category.replace(/-/g, ' ')}`;

/** The shared judge prompt; the pipeline sends ≤ 8 numbered 1024-px JPEG parts before it. */
export function imageJudgePrompt(product: ProductIdentity, count: number): string {
  return `You are judging ${count} candidate catalogue image${count === 1 ? '' : 's'} for the product "${describeProduct(product)}". The images are numbered 1..${count} in the order given. For EACH image return one item with its index. Be strict: a logo, banner, icon, chart or screenshot is not a product photo; a packaging-only shot is flagged; a cropped or partial product is not "whole"; match_to_product_name must drop when the brand, model or variant could differ from the named product. Judge only what is visible.`;
}

export interface JudgeOptions {
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  caller?: string;
  sku?: string;
}

export interface JudgeImagesResult {
  items: ImageJudgement[];
  /** Deterministic score per input image (0 when the model skipped one). */
  scores: number[];
  model: string;
  usage: Usage;
  latencyMs: number;
}

/** Judges up to 8 images in one strict-JSON call (no caching here — the pipeline caches by sha1 + model). */
export async function judgeImages(images: ImageInput[], product: ProductIdentity, opts: JudgeOptions = {}): Promise<JudgeImagesResult> {
  if (images.length === 0) throw new Error('judgeImages: no images');
  if (images.length > 8) throw new Error('judgeImages: at most 8 images per call');
  const model = opts.model ?? (await resolveModel('vision'));
  const parts: LlmPart[] = [];
  images.forEach((img, i) => {
    parts.push(`Image ${i + 1}:`, imagePart(img));
  });
  parts.push(imageJudgePrompt(product, images.length));
  const res = await generateJson({
    caller: opts.caller ?? 'images.judge',
    sku: opts.sku ?? product.sku,
    model,
    parts,
    schema: imageJudgeBatchSchema(),
    zod: ImageJudgeBatchZ,
    temperature: 0,
    thinking: 'judge',
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  });
  const scores = images.map((_, i) => {
    const item = res.data.items.find((it) => it.index === i + 1);
    return item ? scoreImageJudgement(item) : 0;
  });
  return { items: res.data.items, scores, model, usage: res.usage, latencyMs: res.latencyMs };
}

// ── 3D model ↔ hero photo judge (T7 quality gate) ────────────────────────────

export const ModelMatchZ = z.object({
  same_product: z.boolean(),
  silhouette: z.number().min(0).max(1),
  colour: z.number().min(0).max(1),
  branding: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
  defects: z.array(z.string()),
});
export type ModelMatch = z.infer<typeof ModelMatchZ>;

export const MODEL_MATCH_SCHEMA: JsonSchema = obj({
  same_product: bool('the render depicts the same product as the photo (same type, proportions and main features)'),
  silhouette: score('shape and proportions agree'),
  colour: score('colours, materials and finish agree'),
  branding: score('labels, logos and printed text are placed like the photo and are not garbled (1 when the product has no branding and the render adds none)'),
  overall: score('combined verdict on using this 3D model in the store'),
  defects: arr(str('one concrete defect'), {
    maxItems: 8,
    description: 'missing or extra parts, wrong proportions, melted or hollow geometry, garbled text, floating pieces, wrong orientation',
  }),
});

export interface ModelMatchResult extends ModelMatch {
  model: string;
  usage: Usage;
  latencyMs: number;
}

/**
 * Compares the official hero photo (cut-out) with a render of the generated 3D model.
 * The T7 gate rejects `overall < 0.6` and retries with another provider.
 */
export async function judgeModelMatch(hero: ImageInput, preview: ImageInput, product: ProductIdentity, opts: JudgeOptions = {}): Promise<ModelMatchResult> {
  const model = opts.model ?? (await resolveModel('vision'));
  const res = await generateJson({
    caller: opts.caller ?? '3d.judge',
    sku: opts.sku ?? product.sku,
    model,
    parts: [
      'FIRST image — the official product photo:',
      imagePart(hero),
      'SECOND image — a render of a generated 3D model:',
      imagePart(preview),
      `Product: "${describeProduct(product)}". Judge whether the 3D render depicts this exact product. Score silhouette (shape, proportions), colour (colours, materials, finish) and branding (labels and text placement, legibility). overall is your combined verdict. List concrete defects; an empty list means none.`,
    ],
    schema: MODEL_MATCH_SCHEMA,
    zod: ModelMatchZ,
    temperature: 0,
    thinking: 'judge',
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  });
  return { ...res.data, model, usage: res.usage, latencyMs: res.latencyMs };
}
