import { formatRupees } from '@buildobjects/catalog';

/** The only URL rule the frontend knows: base + key. On AWS the base becomes CloudFront. */
const BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL || '/media').replace(/\/$/, '');

export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return `${BASE}/${key}`;
}

export function withSize(key: string, size: 'thumb' | 'card' | 'gallery' | 'zoom' | 'orig'): string {
  return key.replace(/-(thumb|card|gallery|zoom|orig)\.(webp|avif|jpg|png)$/, (_m, _s, e) => `-${size}.${e}`);
}

/** `₹1,23,456`. The rule lives in @buildobjects/catalog so prices read the same everywhere. */
export const inr = formatRupees;

export function pctOff(mrp: number | null | undefined, price: number | null | undefined): number | null {
  if (!mrp || !price || price >= mrp) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}
