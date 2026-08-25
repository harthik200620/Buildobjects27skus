'use client';
import type { ImageLoaderProps } from 'next/image';

/**
 * Pre-derived renditions only. A catalogue key looks like `skus/xx/CODE/img/1-card.webp`;
 * for a requested width we swap the size segment for the smallest rendition that covers it.
 * Anything that is not a catalogue key (logo PNGs, generated art) passes through untouched.
 * The requested width rides along as `?w=` — the media route ignores it, but next/image's dev
 * check insists the loader's URL reflects the width it was asked for.
 */
const LADDER: [number, string][] = [
  [240, 'thumb'],
  [480, 'card'],
  [1080, 'gallery'],
  [2048, 'zoom'],
];

export default function imageLoader({ src, width }: ImageLoaderProps): string {
  const m = src.match(/^(.*\/img\/\d+)-(thumb|card|gallery|zoom|orig)\.(webp|avif)(\?.*)?$/);
  if (!m) return src;
  const size = (LADDER.find(([w]) => w >= width) ?? LADDER[LADDER.length - 1])[1];
  const query = m[4] ? `${m[4]}&w=${width}` : `?w=${width}`;
  return `${m[1]}-${size}.${m[3]}${query}`;
}
