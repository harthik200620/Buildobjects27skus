import { md5Hex } from './md5';

/** Derived image sizes (the srcset ladder). `orig` is the untouched source. */
export const IMAGE_SIZES = { thumb: 240, card: 480, gallery: 1080, zoom: 2048 } as const;
/**
 * Cut-out renditions (images v2): `cutout` = `{pos}-cutout.png`, 1024 px alpha PNG (AR reference image,
 * 3D handoff); `cutoutcard` = `{pos}-cutout-card.webp`, 480 px alpha webp (category tiles, cards).
 * Kept out of IMAGE_SIZES so the srcset ladder is unchanged.
 */
export const CUTOUT_SIZES = { cutout: 1024, cutoutcard: 480 } as const;
export type ImageSize = keyof typeof IMAGE_SIZES | keyof typeof CUTOUT_SIZES | 'orig';
export const AVIF_SIZES: ImageSize[] = ['thumb', 'card'];

/** The size segment used in the key for each size (`cutoutcard` → `cutout-card`). */
const SIZE_SEGMENT: Record<ImageSize, string> = {
  thumb: 'thumb',
  card: 'card',
  gallery: 'gallery',
  zoom: 'zoom',
  orig: 'orig',
  cutout: 'cutout',
  cutoutcard: 'cutout-card',
};
const SEGMENT_SIZE: Record<string, ImageSize> = Object.fromEntries(Object.entries(SIZE_SEGMENT).map(([k, v]) => [v, k as ImageSize]));

/** First two hex chars of md5(sku_code) — directory sharding so 400k × 25 files never melts a listing. */
export function shard(skuCode: string): string {
  return md5Hex(skuCode).slice(0, 2);
}

/** `skus/{xx}/{sku_code}/img/{position}-{size}.webp` (cut-outs: `{position}-cutout.png`, `{position}-cutout-card.webp`). */
export function imageKey(
  skuCode: string,
  position: number,
  size: ImageSize,
  ext: 'webp' | 'avif' | 'jpg' | 'png' = size === 'cutout' ? 'png' : 'webp',
): string {
  return `skus/${shard(skuCode)}/${skuCode}/img/${position}-${SIZE_SEGMENT[size]}.${ext}`;
}
/** `skus/{xx}/{sku_code}/docs/{slug}.pdf` */
export function docKey(skuCode: string, slug: string): string {
  return `skus/${shard(skuCode)}/${skuCode}/docs/${slug}.pdf`;
}
export function brandLogoKey(brandSlug: string, ext: string): string {
  return `brands/${brandSlug}/logo.${ext}`;
}
/**
 * `categories/{slug}/hero-card-{version}.webp`
 *
 * The version is a short hash of the image's own bytes, and it exists because /media is served
 * `immutable, max-age=31536000`. That header is correct for content-derived keys and was a bug
 * here: the key used to be a stable path, so regenerating the artwork left every browser that had
 * seen the old file pinned to it for a year — the storefront kept showing drawn placeholder tiles
 * while the real photographs sat on disk behind the same URL.
 *
 * Omitting `version` yields the old unversioned path, which is what any row written before this
 * change still points at.
 */
export function categoryHeroKey(categorySlug: string, size: ImageSize, version?: string | null): string {
  const v = version ? `-${version}` : '';
  return `categories/${categorySlug}/hero-${SIZE_SEGMENT[size]}${v}.webp`;
}
/** The only URL rule the frontend knows. */
export function mediaUrl(base: string, key: string): string {
  return `${base.replace(/\/$/, '')}/${key}`;
}
/** Swap the size segment of an image key: `…/1-card.webp` → `…/1-zoom.webp`, `…/1-cutout.png` → `…/1-cutout-card.webp`. */
export function withSize(key: string, size: ImageSize, ext?: 'webp' | 'avif' | 'png'): string {
  return key.replace(
    /-(thumb|card|gallery|zoom|orig|cutout-card|cutout)\.(webp|avif|jpg|png)$/,
    (_m, _s, e) => `-${SIZE_SEGMENT[size]}.${ext ?? (size === 'cutout' ? 'png' : size === 'cutoutcard' ? 'webp' : e)}`,
  );
}
/** Parse the size segment of an image key (`…/3-cutout-card.webp` → `cutoutcard`); null when the key is not an image key. */
export function sizeOfKey(key: string): ImageSize | null {
  const m = /-(thumb|card|gallery|zoom|orig|cutout-card|cutout)\.(webp|avif|jpg|png)$/.exec(key);
  return m ? (SEGMENT_SIZE[m[1]] ?? null) : null;
}
