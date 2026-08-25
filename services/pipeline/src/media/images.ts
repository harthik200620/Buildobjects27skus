/**
 * Image processing: validate a source, derive the five renditions, blurhash, and — when a
 * role has no usable source — render an honest, flagged placeholder so a card never shows a
 * broken image. Zoom (2048) is the reason the ≥ 1200 px source rule exists.
 */

import { AVIF_SIZES, IMAGE_SIZES, type ImageRole, type ImageSize, imageKey } from '@buildobjects/catalog';
import { encode } from 'blurhash';
import sharp from 'sharp';
import { mediaStore } from './store';

/** Above this a source can feed the 2048 px zoom pane; below it the lens hides itself. */
export const MIN_SOURCE_WIDTH = 1200;
/**
 * How small a photograph may be and still be worth showing.
 *
 * Indian manufacturers publish surprisingly small renditions: ACC's own Suraksha Power bag
 * shot is 366×528, Wix serves Ceasefire at 500, and CP Plus publish their cameras at 280×200
 * with no larger version on the site. A real small photograph of the right product serves a
 * buyer better than a drawn box — and better than the 400 px category thumbnail of a Wi-Fi
 * router that won the slot when this floor sat above what CP Plus actually publish.
 *
 * One number, not one per role. `images:resource` and the ingest stage read it from here:
 * when they each held their own, the first kept images the second threw away.
 */
export const SOFT_SOURCE_WIDTH = 280;

export interface ProcessedImage {
  position: number;
  width: number;
  height: number;
  blurhash: string;
  originalKey: string;
  keys: Record<string, string>;
  placeholder: boolean;
  soft: boolean;
}

export async function inspect(buf: Buffer): Promise<{ width: number; height: number; format: string } | null> {
  try {
    const m = await sharp(buf).metadata();
    if (!m.width || !m.height) return null;
    return { width: m.width, height: m.height, format: m.format ?? 'unknown' };
  } catch {
    return null;
  }
}

/**
 * How much an image looks like a product shot rather than a scene, 0…1.
 *
 * A manufacturer's page carries both, and the ranking that reads filenames cannot tell them
 * apart: it gave UltraTech a city skyline, Saint-Gobain and Guardian a photograph of a glazed
 * building, Topcon two surveyors in a field and Safex its own trademark. All of them are the
 * right brand and none of them is the product, which is what a hero has to be.
 *
 * Three signals, all cheap and all measured on a 32×32 greyscale downsample:
 *   · the border ring is uniform — a studio backdrop has no detail at the edges of the frame.
 *     This carries most of the weight: it is the signal that survives whatever colour the
 *     backdrop is, and Adani photograph their cement bags on a dark sweep;
 *   · the border ring is light — most backdrops are white, so this helps, but only a little,
 *     for the reason above;
 *   · the frame is close to square — catalogue photography is 1:1 or portrait, and a facade,
 *     a skyline and a field are all wide.
 */
export async function studioScore(buf: Buffer): Promise<number> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return 0;
    const n = 32;
    const raw = await sharp(buf).removeAlpha().resize(n, n, { fit: 'fill' }).greyscale().raw().toBuffer();

    const ring: number[] = [];
    for (let i = 0; i < n; i++) {
      ring.push(raw[i], raw[(n - 1) * n + i], raw[i * n], raw[i * n + n - 1]);
    }
    const mean = ring.reduce((a, b) => a + b, 0) / ring.length;
    const sd = Math.sqrt(ring.reduce((a, b) => a + (b - mean) ** 2, 0) / ring.length);

    const uniform = Math.max(0, 1 - sd / 40); // 40 grey levels of edge detail ⇒ a scene
    const light = Math.min(1, mean / 235);
    const square = Math.max(0, 1 - Math.abs(Math.log(meta.width / meta.height)) / Math.log(2.2));
    return 0.55 * uniform + 0.15 * light + 0.3 * square;
  } catch {
    return 0;
  }
}

async function blurhashOf(buf: Buffer): Promise<string> {
  const { data, info } = await sharp(buf).resize(32, 32, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
}

/** Writes orig + 4 webp sizes (+ avif for thumb/card). Returns the keys. */
export async function deriveRenditions(
  skuCode: string,
  position: number,
  src: Buffer,
  opts: { placeholder?: boolean; origExt?: 'png' | 'jpg' | 'webp' } = {},
): Promise<ProcessedImage> {
  const store = mediaStore();
  const meta = await inspect(src);
  if (!meta) throw new Error('unreadable image');
  const base = sharp(src).rotate().flatten({ background: '#08222a' });
  const keys: Record<string, string> = {};
  const origExt = opts.origExt ?? (meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpg');
  const originalKey = imageKey(skuCode, position, 'orig', origExt);
  await store.put(originalKey, src, `image/${origExt === 'jpg' ? 'jpeg' : origExt}`);
  keys.orig = originalKey;
  for (const [size, px] of Object.entries(IMAGE_SIZES) as [Exclude<ImageSize, 'orig'>, number][]) {
    const pipeline = base.clone().resize(px, px, { fit: 'inside', withoutEnlargement: !(px > meta.width && !opts.placeholder), kernel: 'lanczos3' });
    const webp = await pipeline.clone().webp({ quality: 82, effort: 4 }).toBuffer();
    const k = imageKey(skuCode, position, size, 'webp');
    await store.put(k, webp, 'image/webp');
    keys[size] = k;
    if (AVIF_SIZES.includes(size)) {
      const avif = await pipeline.clone().avif({ quality: 60, effort: 4 }).toBuffer();
      await store.put(imageKey(skuCode, position, size, 'avif'), avif, 'image/avif');
    }
  }
  const bh = await blurhashOf(src);
  return {
    position,
    width: meta.width,
    height: meta.height,
    blurhash: bh,
    originalKey,
    keys,
    placeholder: !!opts.placeholder,
    soft: meta.width < MIN_SOURCE_WIDTH,
  };
}

const ROLE_LABEL: Record<ImageRole, string> = {
  hero: 'Product',
  angle: 'Second angle',
  in_context: 'In use',
  detail: 'Detail',
  pack_or_dimensions: 'Pack & dimensions',
};

/**
 * A placeholder is a statement, not a disguise: the brand and product name, the role, and
 * the words "image pending" on the Patina ground — rendered at 2048 px like everything else.
 */
export async function renderPlaceholder(opts: { skuCode: string; brand: string; name: string; role: ImageRole; categoryIcon?: string }): Promise<Buffer> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const title = esc(opts.name.slice(0, 60));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">
  <defs>
    <radialGradient id="g" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="#0d3440"/><stop offset="1" stop-color="#08222a"/></radialGradient>
    <pattern id="grid" width="128" height="128" patternUnits="userSpaceOnUse"><path d="M128 0H0V128" fill="none" stroke="#5ce1e6" stroke-opacity=".07" stroke-width="2"/></pattern>
  </defs>
  <rect width="2048" height="2048" fill="url(#g)"/>
  <rect width="2048" height="2048" fill="url(#grid)"/>
  <g transform="translate(1024 880)" fill="none" stroke="#5ce1e6" stroke-opacity=".55" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-240 -160 L0 -290 L240 -160 L240 130 L0 260 L-240 130 Z"/><path d="M0 260 V-30 L-240 -160 M0 -30 L240 -160"/>
  </g>
  <text x="1024" y="1290" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="72" fill="#e8f0f2">${title}</text>
  <text x="1024" y="1380" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="44" letter-spacing="8" fill="#9baeb3">${esc(opts.brand.toUpperCase())} · ${esc(ROLE_LABEL[opts.role].toUpperCase())}</text>
  <text x="1024" y="1560" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#5ce1e6">Official image pending · placeholder</text>
  <text x="1024" y="1960" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" letter-spacing="6" fill="#9baeb3">BUILD OBJECTS · ${esc(opts.skuCode)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
