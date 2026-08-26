'use client';
import type { ImageLoaderProps } from 'next/image';

/**
 * Pre-derived renditions only. Nothing is re-encoded on the way to the screen: for a requested
 * width the loader swaps the size segment in the key for the smallest rendition that covers it.
 *
 * Two key shapes carry renditions, and they name their sizes differently:
 *
 *   products    skus/xx/CODE/img/1-card.webp          → 1-thumb / 1-card / 1-gallery / 1-zoom
 *   categories  categories/cement/hero-card-a1b2.webp → hero-thumb- / hero-card- / hero-gallery-
 *   backplates  /art/home-hero-2560.webp              → -640 / -1280 / -2560
 *
 * The category hash is the content version of the original and is shared by every rendition of
 * it, so the segment is the only part that moves. Anything matching neither shape — logo PNGs,
 * the estimator's house renders — passes through untouched.
 *
 * The requested width rides along as `?w=`. The media route ignores it, but next/image's dev
 * check insists the URL the loader returns reflects the width it was asked for.
 */
const SKU_LADDER: [number, string][] = [
  [240, 'thumb'],
  [480, 'card'],
  [1080, 'gallery'],
  [2048, 'zoom'],
];

/** Categories are 16:9 and only ever three sizes wide: 400, 800, 1600. */
const CATEGORY_LADDER: [number, string][] = [
  [400, 'thumb'],
  [800, 'card'],
  [1600, 'gallery'],
];

/**
 * Backplates name their renditions by width, because unlike the catalogue they have no role
 * vocabulary — a plate is one photograph at three sizes, not a hero and an angle and a detail.
 * Derived at stage time by scripts/stage-media.mts; the widths here must match the ones there.
 */
const PLATE_LADDER = [640, 1280, 2560];

const pick = (ladder: [number, string][], width: number) => (ladder.find(([w]) => w >= width) ?? ladder[ladder.length - 1])[1];

export default function imageLoader({ src, width }: ImageLoaderProps): string {
  const sku = src.match(/^(.*\/img\/\d+)-(thumb|card|gallery|zoom|orig)\.(webp|avif)(\?.*)?$/);
  if (sku) {
    const query = sku[4] ? `${sku[4]}&w=${width}` : `?w=${width}`;
    return `${sku[1]}-${pick(SKU_LADDER, width)}.${sku[3]}${query}`;
  }

  const category = src.match(/^(.*\/hero)-(thumb|card|gallery)-([0-9a-f]+)\.(webp|avif)(\?.*)?$/);
  if (category) {
    const query = category[5] ? `${category[5]}&w=${width}` : `?w=${width}`;
    return `${category[1]}-${pick(CATEGORY_LADDER, width)}-${category[3]}.${category[4]}${query}`;
  }

  const plate = src.match(/^(.*\/art\/[a-z0-9-]+?)-(?:640|1280|2560)\.webp(\?.*)?$/);
  if (plate) {
    const chosen = PLATE_LADDER.find((w) => w >= width) ?? PLATE_LADDER[PLATE_LADDER.length - 1];
    const query = plate[2] ? `${plate[2]}&w=${width}` : `?w=${width}`;
    return `${plate[1]}-${chosen}.webp${query}`;
  }

  return src;
}
