import { clamp } from '@buildobjects/catalog';
import sharp from 'sharp';
import { z } from 'zod';
import type { Usage } from './cost';
import { generateText, type ImageInput, imagePart, type MediaRes, parseJsonLoose } from './generate';
import { resolveModel } from './models';

/** Normalised (0–1) box, origin top-left. */
export interface SegmentBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SegmentItem {
  label: string;
  box: SegmentBox;
  /** Raw Gemini box: [y0, x0, y1, x1] on a 0–1000 grid. */
  box2d: [number, number, number, number];
  /** Box-sized greyscale PNG (probability map, white = object) without the data-URI prefix. */
  maskPngBase64: string;
}

export interface SegmentResult {
  items: SegmentItem[];
  model: string;
  usage: Usage;
  latencyMs: number;
  raw: string;
}

/** The documented Gemini segmentation prompt (Gemini 2.5+). */
export function segmentationPrompt(targets: string[]): string {
  const what =
    targets
      .map((t) => t.trim())
      .filter(Boolean)
      .join(', ') || 'every distinct object';
  return `Give the segmentation masks for ${what}. Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label". Use descriptive labels.`;
}

const RawItemZ = z.object({
  box_2d: z.array(z.number()).length(4),
  mask: z.string().min(1),
  label: z.string().optional().default(''),
});

/** Parses the model's JSON (fenced or not) into normalised items; entries without a box or mask are dropped. */
export function parseSegmentation(text: string): SegmentItem[] {
  const parsed = parseJsonLoose(text);
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { masks?: unknown }).masks)
      ? (parsed as { masks: unknown[] }).masks
      : [];
  const items: SegmentItem[] = [];
  for (const entry of list) {
    const r = RawItemZ.safeParse(entry);
    if (!r.success) continue;
    const [y0, x0, y1, x1] = r.data.box_2d.map((v) => clamp(v, 0, 1000)) as [number, number, number, number];
    const box: SegmentBox = { x0: Math.min(x0, x1) / 1000, y0: Math.min(y0, y1) / 1000, x1: Math.max(x0, x1) / 1000, y1: Math.max(y0, y1) / 1000 };
    if (box.x1 - box.x0 <= 0 || box.y1 - box.y0 <= 0) continue;
    const maskPngBase64 = r.data.mask.replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '');
    if (!maskPngBase64) continue;
    items.push({ label: r.data.label.trim(), box, box2d: [y0, x0, y1, x1], maskPngBase64 });
  }
  return items;
}

export interface SegmentOptions {
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 'high' for cut-outs (T4), 'medium' for live AR. */
  mediaResolution?: MediaRes;
  caller?: string;
  sku?: string;
}

/**
 * Segmentation masks for `targets` (e.g. ['the cement bag'] or ['floor', 'wall']). Plain-text call
 * (the documented recipe: no JSON mode, thinking off on 2.5 Flash), tolerant parse.
 */
export async function segment(image: ImageInput, targets: string[], opts: SegmentOptions = {}): Promise<SegmentResult> {
  const model = opts.model ?? (await resolveModel('segment'));
  const res = await generateText({
    caller: opts.caller ?? 'segment',
    sku: opts.sku,
    model,
    parts: [imagePart(image), segmentationPrompt(targets)],
    temperature: 0,
    thinking: 'segment',
    mediaResolution: opts.mediaResolution,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  });
  return { items: parseSegmentation(res.text), model, usage: res.usage, latencyMs: res.latencyMs, raw: res.text };
}

/**
 * Pastes a box-sized mask into a full-frame single-channel PNG (width × height, black outside the
 * box). Greyscale values are kept unless `threshold` is given (then 0/255). Returns the PNG buffer.
 */
export async function maskToFullFrame(
  frame: { width: number; height: number },
  item: Pick<SegmentItem, 'box' | 'maskPngBase64'>,
  opts: { threshold?: number } = {},
): Promise<Buffer> {
  const W = Math.max(1, Math.round(frame.width));
  const H = Math.max(1, Math.round(frame.height));
  const left = clamp(Math.round(item.box.x0 * W), 0, W - 1);
  const top = clamp(Math.round(item.box.y0 * H), 0, H - 1);
  const right = clamp(Math.round(item.box.x1 * W), left + 1, W);
  const bottom = clamp(Math.round(item.box.y1 * H), top + 1, H);
  const bw = right - left;
  const bh = bottom - top;
  const { data, info } = await sharp(Buffer.from(item.maskPngBase64, 'base64'))
    .removeAlpha()
    .greyscale()
    .resize(bw, bh, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = info.channels;
  const full = Buffer.alloc(W * H, 0);
  const threshold = opts.threshold;
  for (let y = 0; y < bh; y++) {
    const rowOut = (top + y) * W + left;
    const rowIn = y * bw * stride;
    for (let x = 0; x < bw; x++) {
      const v = data[rowIn + x * stride];
      full[rowOut + x] = threshold === undefined ? v : v >= threshold ? 255 : 0;
    }
  }
  // `toColourspace('b-w')` keeps the file single-channel — a bare `.png()` on 1-band raw input writes sRGB.
  return sharp(full, { raw: { width: W, height: H, channels: 1 } })
    .toColourspace('b-w')
    .png({ compressionLevel: 6 })
    .toBuffer();
}
