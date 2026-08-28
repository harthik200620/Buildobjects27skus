import { decode } from 'blurhash';

/**
 * The mount a frame is painted on, taken from the frame itself.
 *
 * `--plate-1` is a pale silver chosen so a frame shot on a light sweep and its mount are one
 * surface. Of the twenty-eight SKUs with photography, THREE have galleries consistently on that
 * sweep; nine are entirely dark and sixteen carry both inside one gallery. On the product page
 * that showed as a dark studio render inside a white rectangle inside a dark page.
 *
 * The ground comes from the frame's own blurhash — decode to 8x8, average the four corners. No new
 * data file and nothing to keep in step, because the hash is made of the picture.
 *
 * The corner colour is not the mount: half these frames corner on olive, and a mount in that
 * colour is mud rather than a decision. It picks WHICH mount — the silver sweep or a dark one from
 * the store's own surfaces — then leans it toward the frame so the two meet without an edge.
 *
 * This does not replace lib/plate-colors.ts. That table is sampled from real border pixels of each
 * SKU's FIRST frame and is what the card paints; checked against it, this agrees on 25 of 26
 * (glass reads darker, fair for a translucent product). The table is exact and per-SKU, this is
 * approximate and per-frame, and a gallery needs per-frame. The gallery uses the table for frame
 * one, so arriving from a card is seamless, and this for the rest.
 */

/** Above this, the frame was shot on a sweep and the silver mount is the one it wants. */
const LIGHT_GROUND = 165;

/** How far the mount leans toward the frame's own corner colour. Enough to lose the seam. */
const TINT = '22%';

export interface Ground {
  /** A CSS colour for `--plate` / `--plate-stage`. */
  plate: string;
  /** True when the frame is on the light sweep the default mount was designed for. */
  light: boolean;
}

/**
 * The mount for one frame, or null when there is no hash to read — in which case the stylesheet's
 * own default applies and nothing changes.
 */
export function groundFor(blurhash: string | null | undefined): Ground | null {
  if (!blurhash) return null;
  let px: Uint8ClampedArray;
  try {
    px = decode(blurhash, 8, 8);
  } catch {
    /* A malformed hash is not worth a 500 on a product page. */
    return null;
  }
  const at = (x: number, y: number) => {
    const i = (y * 8 + x) * 4;
    return [px[i], px[i + 1], px[i + 2]] as const;
  };
  const pts = [at(0, 0), at(7, 0), at(0, 7), at(7, 7)];
  const rgb = [0, 1, 2].map((c) => Math.round(pts.reduce((sum, p) => sum + p[c], 0) / pts.length));
  const hex = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  /* Plain mean, not relative luminance: this is asking "is the paper light or dark", which is a
     question about the ink on the page rather than about how the eye weights green. */
  const light = (rgb[0] + rgb[1] + rgb[2]) / 3 >= LIGHT_GROUND;
  return { plate: `color-mix(in oklab, ${hex} ${TINT}, var(${light ? '--plate-1' : '--plate-dark'}))`, light };
}

/*
 * The generated table, re-exported so callers import the CONCEPT from one place.
 *
 * scripts/blend-skus.mts samples each SKU's first frame from its real border pixels and writes
 * lib/plate-colors.ts; that file stays exactly what it is, a generated artefact nobody edits. What
 * changes is that nothing outside this module has to know it exists — Gallery and ProductCard were
 * importing `plateFor` from one file and `groundFor` from another to answer the same question, and
 * a reader arriving at either had no way to learn there was a second.
 *
 * Which to use is a real decision and it is documented above: the table is exact and per-SKU, this
 * module's `groundFor` is approximate and per-frame.
 */
export { PLATE_COLORS, plateFor } from './plate-colors';
