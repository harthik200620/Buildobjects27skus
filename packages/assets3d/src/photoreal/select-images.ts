/**
 * Which photos feed the image-to-3D provider. Mirrors build.ts's SKU query and joins the real
 * (placeholder = false) `sku_images` rows, ordered hero → angle → detail → in_context — never
 * pack_or_dimensions. Files are read from MEDIA_ROOT (repo-root relative, like
 * services/pipeline/src/config.ts): the `{n}-cutout.png` the image stage writes is preferred,
 * else the original `{n}-orig.*` (providers remove backgrounds themselves).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ImageRole, SpecJson } from '@buildobjects/catalog';
import { brands, categories, type Db, products, skuImages, skus } from '@buildobjects/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { cutoutFile, origFile } from '../textures';
import type { ViewRole } from './types';

export const VIEW_ROLE_ORDER: ImageRole[] = ['hero', 'angle', 'detail'];
export const MAX_VIEWS = 4;
export const PROVIDER_MAX_PX = 2048;

export interface RealImage {
  position: number;
  role: ImageRole;
  key: string;
  width: number | null;
  height: number | null;
}
export interface PhotorealTarget {
  code: string;
  category: string;
  name: string;
  brand: string;
  spec: SpecJson | null;
  images: RealImage[];
}

export async function loadTargets(db: Db, filter: { sku?: string; category?: string } = {}): Promise<PhotorealTarget[]> {
  const rows = await db
    .select({ code: skus.skuCode, category: categories.slug, name: products.name, brand: brands.name, spec: skus.specJson })
    .from(skus)
    .innerJoin(products, eq(skus.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .innerJoin(brands, eq(products.brandId, brands.id));
  const imgs = await db
    .select({
      code: skus.skuCode,
      position: skuImages.position,
      role: skuImages.role,
      key: skuImages.storageKeyOriginal,
      width: skuImages.width,
      height: skuImages.height,
    })
    .from(skuImages)
    .innerJoin(skus, eq(skuImages.skuId, skus.id))
    .where(eq(skuImages.placeholder, false));
  const bySku = new Map<string, RealImage[]>();
  for (const i of imgs) {
    const list = bySku.get(i.code) ?? [];
    list.push({ position: i.position, role: i.role as ImageRole, key: i.key, width: i.width, height: i.height });
    bySku.set(i.code, list);
  }
  return rows
    .filter((r) => (!filter.category || r.category === filter.category) && (!filter.sku || r.code === filter.sku))
    .map((r) => ({
      code: r.code,
      category: r.category,
      name: r.name,
      brand: r.brand,
      spec: (r.spec ?? null) as SpecJson | null,
      images: orderViews(bySku.get(r.code) ?? []),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** hero → angle → detail, by position within a role; pack_or_dimensions and in_context dropped for pure product 3D reconstruction. */
export function orderViews<T extends { role: ImageRole; position: number }>(images: T[]): T[] {
  const rank = (r: ImageRole) => {
    const i = VIEW_ROLE_ORDER.indexOf(r);
    return i < 0 ? 99 : i;
  };
  return images
    .filter((i) => i.role !== 'pack_or_dimensions' && i.role !== 'in_context')
    .sort((a, b) => rank(a.role) - rank(b.role) || a.position - b.position);
}

export interface SelectedView {
  position: number;
  role: ImageRole;
  key: string;
  viewRole: ViewRole;
  origFile: string | null;
  cutoutFile: string | null;
}

/**
 * The views to send, in order, with their files on disk. The first view must be a real hero —
 * without one there is nothing honest to model from. `extraCutoutDirs` lets the runner keep
 * assist-made cut-outs outside MEDIA_ROOT (`assets/3d/cutouts/{SKU}/{n}-cutout.png`).
 */
export function selectViews(t: PhotorealTarget, mediaRoot: string, opts: { max?: number; extraCutoutDirs?: string[] } = {}): SelectedView[] {
  const out: SelectedView[] = [];
  for (const img of orderViews(t.images)) {
    if (out.length === 0 && img.role !== 'hero') break;
    const orig = origFile(t.code, mediaRoot, img.position);
    const candidates = [
      cutoutFile(t.code, mediaRoot, img.position),
      ...(opts.extraCutoutDirs ?? []).map((d) => path.join(d, t.code, `${img.position}-cutout.png`)),
    ];
    const cut = candidates.find((f) => fs.existsSync(f)) ?? null;
    if (!orig && !cut) continue;
    out.push({ position: img.position, role: img.role, key: img.key, viewRole: out.length === 0 ? 'front' : 'extra', origFile: orig, cutoutFile: cut });
    if (out.length >= (opts.max ?? MAX_VIEWS)) break;
  }
  return out;
}

export interface ViewImage {
  buffer: Buffer;
  mime: 'image/png';
  source: 'cutout' | 'orig';
  width: number;
  height: number;
}

/** PNG ≤ 2048 px for the provider: the cut-out when present (RGBA), else the original. */
export async function readView(v: SelectedView, opts: { preferCutout?: boolean; maxPx?: number } = {}): Promise<ViewImage | null> {
  const file = (opts.preferCutout ?? true) && v.cutoutFile ? v.cutoutFile : (v.origFile ?? v.cutoutFile);
  if (!file) return null;
  const src = await fs.promises.readFile(file);
  const { data, info } = await sharp(src)
    .rotate()
    .resize(opts.maxPx ?? PROVIDER_MAX_PX, opts.maxPx ?? PROVIDER_MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, mime: 'image/png', source: file === v.cutoutFile ? 'cutout' : 'orig', width: info.width, height: info.height };
}

/** 64-bit difference hash (9 × 8 grayscale, horizontal gradients) — distinct views differ by > 12 bits. */
export async function dhash(src: Buffer): Promise<bigint> {
  const { data } = await sharp(src).flatten({ background: '#ffffff' }).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      bits <<= 1n;
      if (data[y * 9 + x] > data[y * 9 + x + 1]) bits |= 1n;
    }
  return bits;
}
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b,
    n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
export const DISTINCT_VIEW_BITS = 12;
