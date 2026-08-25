'use client';

import { fidelityScore, type LumaGrid, lumaGridFromRgba, type Placement, type PlacementRule, type SceneAnalysis } from '@buildobjects/ar-engine';

/** Photo-mode helpers: capture, analysis input, product cut-out, overlay composition, masks, pixels. */
export const MAX_SIDE = 1600;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src.slice(0, 80)}`));
    img.src = src;
  });
}
export async function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Draw any image/video source to a canvas no larger than MAX_SIDE on its long edge. */
export function toCanvas(src: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, maxSide = MAX_SIDE): HTMLCanvasElement {
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width,
    sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
export function canvasToB64(
  c: HTMLCanvasElement,
  type: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality = 0.9,
): { mimeType: string; base64: string; dataUrl: string } {
  const dataUrl = c.toDataURL(type, quality);
  return { mimeType: type, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), dataUrl };
}
export function lumaGridOf(c: HTMLCanvasElement): LumaGrid {
  const s = document.createElement('canvas');
  s.width = 128;
  s.height = 128;
  const ctx = s.getContext('2d')!;
  ctx.drawImage(c, 0, 0, 128, 128);
  return lumaGridFromRgba(ctx.getImageData(0, 0, 128, 128).data, 128, 128);
}

/** Make a product photo's near-white studio background transparent and crop to the product. */
export async function productCutout(src: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  const c = toCanvas(img, 1024);
  const ctx = c.getContext('2d')!;
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  // sample the border to decide whether the background is light
  let border = 0,
    n = 0;
  for (let x = 0; x < c.width; x += 4)
    for (const y of [0, c.height - 1]) {
      const i = (y * c.width + x) * 4;
      border += (d[i] + d[i + 1] + d[i + 2]) / 3;
      n++;
    }
  const light = border / Math.max(1, n) > 200;
  let minX = c.width,
    minY = c.height,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3,
        sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      if (light && l > 232 && sat < 18) {
        d[i + 3] = 0;
        continue;
      }
      if (light && l > 215 && sat < 14) d[i + 3] = Math.round(((232 - l) / 17) * 255);
      if (d[i + 3] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  ctx.putImageData(id, 0, 0);
  if (maxX <= minX || maxY <= minY) return c;
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  rot: number;
}

/** Pixel rectangle of a placement in a photo of the given size, honouring the anchor face. */
export function placementRect(p: Placement, rule: PlacementRule, W: number, H: number): PixelRect {
  const w = Math.max(4, p.w * W),
    h = Math.max(4, p.h * H);
  const cx = p.x * W;
  const cy = rule.anchor === 'bottom' ? p.y * H - h / 2 : rule.anchor === 'top' ? p.y * H + h / 2 : p.y * H;
  return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, rot: (p.rotationDeg * Math.PI) / 180 };
}

/**
 * A white-on-black mask from a canvas's alpha channel: pixels with alpha > `threshold` are
 * white, grown by `dilatePx` so the generative model may also touch the product's rim. Used by
 * the live-camera composite (the model pass's silhouette) and by photo mode when a
 * segmentation mask replaces the placement rectangle.
 */
export function alphaMask(src: HTMLCanvasElement, opts: { threshold?: number; dilatePx?: number } = {}): HTMLCanvasElement {
  const threshold = opts.threshold ?? 8,
    dilate = Math.max(0, Math.round(opts.dilatePx ?? 0));
  const W = src.width,
    H = src.height;
  const data = src.getContext('2d')!.getImageData(0, 0, W, H).data;
  const on = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < on.length; i++, p += 4) on[i] = data[p + 3] > threshold ? 1 : 0;
  let cur = on;
  for (let d = 0; d < dilate; d++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (cur[i] || (x > 0 && cur[i - 1]) || (x < W - 1 && cur[i + 1]) || (y > 0 && cur[i - W]) || (y < H - 1 && cur[i + W])) next[i] = 1;
      }
    cur = next;
  }
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let i = 0, p = 0; i < cur.length; i++, p += 4) {
    const v = cur[i] ? 255 : 0;
    img.data[p] = v;
    img.data[p + 1] = v;
    img.data[p + 2] = v;
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/**
 * Compose the placed product onto the photo: contact shadow (floor items) or a soft offset
 * shadow (wall items) matched to the scene's light direction, a brightness tint, then the product.
 * Returns the composite, the placement mask and the product region for the fidelity check.
 * `opts.mask` (a photo-sized white-on-black or alpha canvas, e.g. a segmentation mask) replaces
 * the placement rectangle as the mask.
 */
export function composeScene(
  photo: HTMLCanvasElement,
  product: HTMLCanvasElement,
  placement: Placement,
  rule: PlacementRule,
  scene: SceneAnalysis,
  opts: { mask?: HTMLCanvasElement | null } = {},
): { composite: HTMLCanvasElement; mask: HTMLCanvasElement; rect: PixelRect } {
  const W = photo.width,
    H = photo.height;
  const rect = placementRect(placement, rule, W, H);
  const composite = document.createElement('canvas');
  composite.width = W;
  composite.height = H;
  const ctx = composite.getContext('2d')!;
  ctx.drawImage(photo, 0, 0);
  const onFloor = ['floor', 'ground', 'table', 'roof'].includes(placement.surface);
  const lightX = scene.lighting.direction === 'left' ? 1 : scene.lighting.direction === 'right' ? -1 : 0;
  ctx.save();
  if (onFloor) {
    const g = ctx.createRadialGradient(rect.cx, rect.y + rect.h - rect.h * 0.02, 0, rect.cx, rect.y + rect.h - rect.h * 0.02, rect.w * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,.42)');
    g.addColorStop(0.55, 'rgba(0,0,0,.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(rect.cx + lightX * rect.w * 0.08, rect.y + rect.h - rect.h * 0.02, rect.w * 0.7, Math.max(6, rect.h * 0.09), 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.filter = `blur(${Math.max(4, rect.w * 0.06)}px)`;
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(rect.x + lightX * rect.w * 0.07 + rect.w * 0.03, rect.y + rect.h * 0.06, rect.w * 0.96, rect.h * 0.98, Math.min(rect.w, rect.h) * 0.1);
    ctx.fill();
  }
  ctx.restore();
  // Real-time photoreal lamp integration: a warm emissive halo + a light pool on the mounting
  // surface, drawn additively in <1 ms so the bulb reads as installed and lit instantly (no
  // generative wait). This is what makes placement look real-time and believable.
  const isLamp = rule.category === 'bulbs' || rule.integration === 'recessed';
  if (isLamp) {
    const R = Math.max(rect.w, rect.h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Tight, proportionate lamp glow — the light pool is a modest halo around the bulb, never a
    // floodlight. Radii are sized off the bulb's footprint and the pools are soft and low-opacity
    // so the bulb reads as a lit lamp in the room without washing out the frame.
    const pool = ctx.createRadialGradient(rect.cx, rect.cy, R * 0.6, rect.cx, rect.cy, R * 1.5);
    pool.addColorStop(0, 'rgba(255,204,132,.14)');
    pool.addColorStop(0.55, 'rgba(255,196,124,.07)');
    pool.addColorStop(1, 'rgba(255,190,118,0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(rect.cx, rect.cy, R * 1.5, 0, Math.PI * 2);
    ctx.fill();
    // soft rim halo hugging the dome edge, leaving the product centre crisp
    const halo = ctx.createRadialGradient(rect.cx, rect.cy, R * 0.55, rect.cx, rect.cy, R * 1.08);
    halo.addColorStop(0, 'rgba(255,240,205,0)');
    halo.addColorStop(0.6, 'rgba(255,236,198,.18)');
    halo.addColorStop(1, 'rgba(255,220,172,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(rect.cx, rect.cy, R * 1.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // product, rotated about its centre, tinted to the scene brightness — drawn at TRUE aspect
  // (never stretched into an egg): the placement rect's WIDTH is the physical footprint on the
  // wall plane; the height follows the render's own proportion so a wall bulb shows as a round
  // dome protruding, not a squashed box.
  const tinted = document.createElement('canvas');
  tinted.width = product.width;
  tinted.height = product.height;
  const tctx = tinted.getContext('2d')!;
  tctx.drawImage(product, 0, 0);
  const darken = Math.max(0, Math.min(0.45, (0.55 - scene.lighting.brightness) * 0.9));
  if (darken > 0.02) {
    tctx.globalCompositeOperation = 'source-atop';
    tctx.fillStyle = `rgba(${scene.lighting.warm ? '40,25,5' : '5,15,25'},${darken})`;
    tctx.fillRect(0, 0, tinted.width, tinted.height);
  }
  if (scene.lighting.warm) {
    tctx.globalCompositeOperation = 'source-atop';
    tctx.fillStyle = 'rgba(255,190,110,.08)';
    tctx.fillRect(0, 0, tinted.width, tinted.height);
  }
  const aspect = tinted.height / Math.max(1, tinted.width);
  const dw = rect.w,
    dh = rect.w * aspect;
  ctx.save();
  ctx.translate(rect.cx, rect.cy);
  ctx.rotate(rect.rot);
  // anchor: top-anchored items mount cap/base at the top edge; bottom-anchored sit on their base.
  const yOff = rule.anchor === 'top' ? 0 : rule.anchor === 'bottom' ? -dh / 2 : -dh / 2;
  ctx.drawImage(tinted, -dw / 2, yOff - dh * 0.5, dw, dh);
  ctx.restore();
  // mask: the supplied silhouette (resampled to the photo) or the placement rectangle
  const mask = document.createElement('canvas');
  mask.width = W;
  mask.height = H;
  const m = mask.getContext('2d')!;
  m.fillStyle = '#000';
  m.fillRect(0, 0, W, H);
  if (opts.mask) {
    m.drawImage(opts.mask, 0, 0, W, H);
  } else {
    m.save();
    m.translate(rect.cx, rect.cy);
    m.rotate(rect.rot);
    m.fillStyle = '#fff';
    m.fillRect(-rect.w / 2 - 2, -rect.h / 2 - 2, rect.w + 4, rect.h + 4);
    m.restore();
  }
  return { composite, mask, rect };
}

export function regionPixels(c: HTMLCanvasElement, rect: PixelRect, size = 96): Uint8ClampedArray {
  const s = document.createElement('canvas');
  s.width = size;
  s.height = size;
  const ctx = s.getContext('2d')!;
  ctx.drawImage(c, Math.max(0, rect.x), Math.max(0, rect.y), Math.max(1, rect.w), Math.max(1, rect.h), 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}
export function productPixels(product: HTMLCanvasElement, size = 96): Uint8ClampedArray {
  const s = document.createElement('canvas');
  s.width = size;
  s.height = size;
  const ctx = s.getContext('2d')!;
  ctx.drawImage(product, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

/**
 * Best-region fidelity search: when the generative composite re-framed or re-positioned the
 * product so the placement rectangle no longer covers it, score a coarse global scan over the
 * output at several window sizes and return the region with the highest fidelity. This finds
 * the product wherever it landed (Gemini understands the scene independently of the tiny rect)
 * while still requiring the region to genuinely match the SKU reference so a painted-wrong
 * product never passes.
 */
export function bestRegionScore(
  reference: Uint8ClampedArray,
  out: HTMLCanvasElement,
  rect: PixelRect,
  W: number,
  H: number,
): { score: number; rect: PixelRect } {
  const sizes = [3, 4.5, 6, 9, 14]; // rect-height multiples → small local to full-frame cap
  const steps = 6;
  let best = { score: -1, rect };
  for (const k of sizes) {
    const w0 = Math.min(W, Math.max(rect.w * 2, rect.h * k * 1.2));
    const h0 = Math.min(H, Math.max(rect.h * 2, rect.h * k));
    for (let sx = 0; sx < steps; sx++)
      for (let sy = 0; sy < steps; sy++) {
        const x0 = (sx / (steps - 1)) * (W - w0);
        const y0 = (sy / (steps - 1)) * (H - h0);
        const cand: PixelRect = { x: x0, y: y0, w: w0, h: h0, cx: x0 + w0 / 2, cy: y0 + h0 / 2, rot: 0 };
        const score = fidelityScore(reference, regionPixels(out, cand));
        if (score > best.score) best = { score, rect: cand };
      }
  }
  return best;
}

export async function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}
export function download(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
