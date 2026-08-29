/**
 * Photo-derived textures for the parametric builders and the photoreal pipeline.
 *
 * Reads from MEDIA_ROOT (`skus/{xx}/{CODE}/img/`): the `{n}-cutout.png` the image stage writes
 * (RGBA, T4) when present, else the original `{n}-orig.*` with a deterministic near-white
 * knockout as its alpha — good enough for a silhouette and a mean colour, and labelled as such.
 * Everything is capped at MAX_TEXTURE_PX so a GLB never carries more than the phone needs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { shard } from '@buildobjects/catalog';
import sharp from 'sharp';
import type { TextureImage } from './gltf';

export type Rgba = [number, number, number, number];
export interface Tex extends TextureImage {
  width: number;
  height: number /** sRGB 0–1 mean of the opaque pixels of the source image. */;
  mean: Rgba;
}
export interface BuilderTextures {
  hero?: Tex;
  angle?: Tex;
  band?: Tex;
  /** sRGB 0–1 mean colour of the hero cut-out (alpha = opaque fraction). */
  mean?: Rgba;
  /** Media keys the textures came from. */
  sources: string[];
}
export interface HeroCutout {
  buffer: Buffer;
  source: 'cutout' | 'orig';
  key: string;
  file: string;
  width: number;
  height: number;
}

export const MAX_TEXTURE_PX = 1024;

export const imageDir = (sku: string, mediaRoot: string): string => path.join(mediaRoot, 'skus', shard(sku), sku, 'img');
export const cutoutKey = (sku: string, position = 1): string => `skus/${shard(sku)}/${sku}/img/${position}-cutout.png`;
export const cutoutFile = (sku: string, mediaRoot: string, position = 1): string => path.join(imageDir(sku, mediaRoot), `${position}-cutout.png`);
export function origFile(sku: string, mediaRoot: string, position = 1): string | null {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const f = path.join(imageDir(sku, mediaRoot), `${position}-orig.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/**
 * The SKU's hero (position 1 by default) as an RGBA PNG ≤ 1024 px: the real cut-out when the
 * image stage has produced one, else the original with a near-white knockout (`source: 'orig'`).
 * `allowOrig: false` returns null when there is no cut-out.
 */
export async function heroCutoutFor(sku: string, mediaRoot: string, opts: { position?: number; allowOrig?: boolean } = {}): Promise<HeroCutout | null> {
  const position = opts.position ?? 1;
  const cut = cutoutFile(sku, mediaRoot, position);
  if (fs.existsSync(cut)) {
    const { data, info } = await sharp(cut)
      .ensureAlpha()
      .resize(MAX_TEXTURE_PX, MAX_TEXTURE_PX, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, source: 'cutout', key: cutoutKey(sku, position), file: cut, width: info.width, height: info.height };
  }
  if (opts.allowOrig === false) return null;
  const orig = origFile(sku, mediaRoot, position);
  if (!orig) return null;
  const buffer = await knockoutWhite(await fs.promises.readFile(orig), { maxPx: MAX_TEXTURE_PX });
  const meta = await sharp(buffer).metadata();
  return { buffer, source: 'orig', key: `skus/${shard(sku)}/${sku}/img/${path.basename(orig)}`, file: orig, width: meta.width ?? 0, height: meta.height ?? 0 };
}

/**
 * Deterministic background knockout for studio shots on white: every near-white pixel connected
 * to the image border becomes transparent (white areas inside the product stay). Output RGBA PNG.
 */
export async function knockoutWhite(src: Buffer, opts: { maxPx?: number; threshold?: number; chroma?: number } = {}): Promise<Buffer> {
  const maxPx = opts.maxPx ?? MAX_TEXTURE_PX,
    threshold = opts.threshold ?? 235,
    chroma = opts.chroma ?? 20;
  const { data, info } = await sharp(src)
    .rotate()
    .ensureAlpha()
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width,
    h = info.height;
  const isBg = (i: number) => {
    const r = data[i * 4],
      g = data[i * 4 + 1],
      b = data[i * 4 + 2];
    return Math.min(r, g, b) >= threshold && Math.max(r, g, b) - Math.min(r, g, b) <= chroma;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !isBg(i)) continue;
    seen[i] = 1;
    const x = i % w,
      y = (i - x) / w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  for (let i = 0; i < w * h; i++) if (seen[i]) data[i * 4 + 3] = 0;
  return sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
}

/** Bounding box of alpha > `min` in a raw RGBA buffer; null when fully transparent. */
export function alphaBbox(data: Uint8Array | Buffer, w: number, h: number, min = 16): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * A horizontal band of the product: rows between `fromFrac` and `toFrac` of the product's own
 * height (the alpha bounding box, not the frame) — the label band of an extinguisher is the middle third.
 */
export async function bandCrop(src: Buffer, fromFrac: number, toFrac: number): Promise<Buffer> {
  if (!(fromFrac >= 0 && toFrac <= 1 && toFrac > fromFrac)) throw new Error(`bandCrop: bad range ${fromFrac}–${toFrac}`);
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bb = alphaBbox(data, info.width, info.height) ?? { x0: 0, y0: 0, x1: info.width - 1, y1: info.height - 1 };
  const bh = bb.y1 - bb.y0 + 1;
  const top = bb.y0 + Math.floor(bh * fromFrac),
    height = Math.max(1, Math.round(bh * (toFrac - fromFrac)));
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left: bb.x0, top, width: bb.x1 - bb.x0 + 1, height: Math.min(height, info.height - top) })
    .png()
    .toBuffer();
}

/** Alpha-weighted mean colour of an image, sRGB 0–1; the alpha component is the opaque fraction. */
export async function meanColour(src: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(src)
    .ensureAlpha()
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let r = 0,
    g = 0,
    b = 0,
    wsum = 0;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    if (a <= 0) continue;
    r += data[i * 4] * a;
    g += data[i * 4 + 1] * a;
    b += data[i * 4 + 2] * a;
    wsum += a;
  }
  if (wsum === 0) return [0.5, 0.5, 0.5, 0];
  return [r / wsum / 255, g / wsum / 255, b / wsum / 255, wsum / n];
}

/** Composite an RGBA image onto a solid colour and encode it as a texture (JPEG by default). */
export async function flattenOnto(
  src: Buffer,
  srgb: Rgba | [number, number, number],
  opts: { maxPx?: number; format?: 'jpeg' | 'png'; quality?: number } = {},
): Promise<Tex> {
  const background = { r: Math.round(srgb[0] * 255), g: Math.round(srgb[1] * 255), b: Math.round(srgb[2] * 255) };
  const format = opts.format ?? 'jpeg';
  let p = sharp(src)
    .ensureAlpha()
    .resize(opts.maxPx ?? MAX_TEXTURE_PX, opts.maxPx ?? MAX_TEXTURE_PX, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background });
  p = format === 'jpeg' ? p.jpeg({ quality: opts.quality ?? 82, mozjpeg: true }) : p.png();
  const { data, info } = await p.toBuffer({ resolveWithObject: true });
  return { image: data, mime: format === 'jpeg' ? 'image/jpeg' : 'image/png', width: info.width, height: info.height, mean: await meanColour(src) };
}

export interface TextureSource {
  buffer: Buffer;
  key: string;
}

/** Categories whose parametric builder uses photos (texture or photo-derived colour). */
export const PHOTO_CATEGORIES = new Set(['cement', 'tiles', 'solar-panels', 'epoxy', 'fire-extinguishers', 'glass', 'cctv']);
export const usesPhotos = (category: string) => PHOTO_CATEGORIES.has(category);

/**
 * Category-specific texture preparation for the parametric builders:
 *  cement → front/back faces (hero / angle); tiles, solar → top face; epoxy → label wrap;
 *  fire-extinguishers → middle label band; glass, cctv → mean colour only; bulbs, total stations → none.
 * Returns null when the category does not use photos.
 */
export async function prepareTextures(category: string, imgs: { hero?: TextureSource | null; angle?: TextureSource | null }): Promise<BuilderTextures | null> {
  const hero = imgs.hero ?? null,
    angle = imgs.angle ?? null;
  if (!hero && !angle) return null;
  const sources: string[] = [];
  const out: BuilderTextures = { sources };
  out.mean = await meanColour((hero ?? angle)!.buffer);
  const face = async (src: TextureSource, buffer = src.buffer) => {
    const t = await flattenOnto(buffer, out.mean!);
    sources.push(src.key);
    return t;
  };
  switch (category) {
    case 'cement':
      if (hero) out.hero = await face(hero);
      if (angle) out.angle = await face(angle);
      return out;
    case 'tiles':
    case 'solar-panels':
    case 'epoxy':
      if (hero) out.hero = await face(hero);
      else if (angle) out.hero = await face(angle);
      return out;
    case 'fire-extinguishers':
      if (hero) out.band = await face(hero, await bandCrop(hero.buffer, 0.3, 0.7));
      return out;
    case 'glass':
    case 'cctv':
      sources.push((hero ?? angle)!.key);
      return out;
    default:
      return null;
  }
}
