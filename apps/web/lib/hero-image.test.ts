import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLANK_FRAMES } from './blank-frames';
import type { SkuImageView } from './catalog';
import { correctHeroKey, leadWithRealPhoto } from './hero-image';

/**
 * Which photograph is a product's face.
 *
 * Everything here is defending one property: THE FIRST IMAGE A SHOPPER SEES OF A PRODUCT IS A
 * PICTURE OF THE PRODUCT. It has been broken twice, both times silently, and the two breakages
 * had nothing in common except that no error was raised.
 *
 *   · A frame the pipeline flagged `placeholder` — a drawn card reading "Official image pending" —
 *     sat at position 1 on a Dahua camera, so the store led with it while four real photographs
 *     of the camera waited behind it.
 *   · Somany's Duragres tile shipped four frames that decode to one flat colour. Valid WebP, 282
 *     bytes, no flag, no error, and `next/image` renders them without complaint. The store showed
 *     an empty box as that tile's face on the flooring page, in search, and on its own page.
 *
 * The second is the one worth keeping in mind while reading these: a file that decodes to nothing
 * is invisible to every check except a measurement of its pixels.
 */
const frame = (position: number, role: string, placeholder = false): SkuImageView => ({
  position,
  role,
  alt: '',
  placeholder,
  width: 800,
  height: 800,
  blurhash: null,
  thumb: `skus/aa/SKU/img/${position}-thumb.webp`,
  card: `skus/aa/SKU/img/${position}-card.webp`,
  gallery: `skus/aa/SKU/img/${position}-gallery.webp`,
  zoom: `skus/aa/SKU/img/${position}-zoom.webp`,
});

/** The product whose first four frames are blank; the fifth is the only photograph. */
const SOMANY = 'TIL-SOM-T31F119001859102';
/** Blank frames, but at 3 and 4 — the hero is fine and the gallery is short. */
const JOHNSON = 'TIL-JOH-YK1FLCR000000PJ';

describe('the gallery leads with a real photograph', () => {
  it('leaves a gallery alone when frame 1 is real', () => {
    const images = [frame(1, 'hero'), frame(2, 'angle')];
    expect(leadWithRealPhoto('ANY-SKU', images)).toBe(images);
  });

  it('moves a flagged placeholder off the front', () => {
    const [lead] = leadWithRealPhoto('ANY-SKU', [frame(1, 'hero', true), frame(2, 'angle'), frame(3, 'detail')]);
    expect(lead.position).toBe(2);
  });

  /* The measured case. Nothing about these frames is flagged; only the pixels say so. */
  it('moves a BLANK frame off the front, though nothing flagged it', () => {
    const images = [frame(1, 'hero'), frame(2, 'angle'), frame(3, 'detail'), frame(4, 'in_context'), frame(5, 'pack_or_dimensions')];
    const [lead] = leadWithRealPhoto(SOMANY, images);
    expect(lead.position).toBe(5);
  });

  it('keeps every frame, including the blanks — a five-frame set does not silently become a one-frame set', () => {
    const images = [frame(1, 'hero'), frame(2, 'angle'), frame(3, 'detail'), frame(4, 'in_context'), frame(5, 'pack_or_dimensions')];
    const out = leadWithRealPhoto(SOMANY, images);
    expect(out).toHaveLength(5);
    expect(new Set(out.map((i) => i.position))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('does not disturb a product whose blanks are further down the gallery', () => {
    const images = [frame(1, 'hero'), frame(2, 'angle'), frame(3, 'detail'), frame(4, 'in_context')];
    expect(leadWithRealPhoto(JOHNSON, images)).toBe(images);
  });

  it('is case-insensitive about the SKU, because URLs are lower case and the data is not', () => {
    const images = [frame(1, 'hero'), frame(5, 'pack_or_dimensions')];
    expect(leadWithRealPhoto(SOMANY.toLowerCase(), images)[0].position).toBe(5);
  });

  /* Nothing to promote: better a blank than a crash or an empty gallery. */
  it('returns the set untouched when every frame is unusable', () => {
    const images = [frame(1, 'hero'), frame(2, 'angle')];
    expect(leadWithRealPhoto(SOMANY, images)).toBe(images);
  });
});

describe('the card key, which has no gallery to reorder', () => {
  it('leaves a good key alone', () => {
    expect(correctHeroKey('ANY-SKU', 'skus/aa/ANY/img/1-card.webp')).toBe('skus/aa/ANY/img/1-card.webp');
  });

  it('rewrites the position of a blank hero to the first real frame', () => {
    expect(correctHeroKey(SOMANY, `skus/52/${SOMANY}/img/1-card.webp`)).toBe(`skus/52/${SOMANY}/img/5-card.webp`);
  });

  it('rewrites every rendition the same way, so a card and its product page agree', () => {
    for (const size of ['thumb', 'card', 'gallery', 'zoom'])
      expect(correctHeroKey(SOMANY, `skus/52/${SOMANY}/img/1-${size}.webp`)).toBe(`skus/52/${SOMANY}/img/5-${size}.webp`);
  });

  it('leaves a key alone when the frame it names is not blank', () => {
    expect(correctHeroKey(JOHNSON, `skus/76/${JOHNSON}/img/1-card.webp`)).toBe(`skus/76/${JOHNSON}/img/1-card.webp`);
  });

  it('keeps the hand-written role override working', () => {
    expect(correctHeroKey('CCT-DAH-HDW1200TRQP', 'skus/81/CCT-DAH-HDW1200TRQP/img/1-card.webp')).toBe('skus/81/CCT-DAH-HDW1200TRQP/img/4-card.webp');
  });

  it('passes a null key through', () => {
    expect(correctHeroKey(SOMANY, null)).toBeNull();
  });
});

/**
 * The generated list is only true of the files on disk at the moment it was written, so this
 * checks it still describes them — a regenerated photograph that nobody re-audited would
 * otherwise leave the storefront hiding a frame that is now perfectly good.
 */
describe('the generated blank list matches the files on disk', () => {
  const root = path.join(__dirname, '..', 'public', 'media', 'skus');

  it('names only frames that exist, and every named file is tiny', () => {
    if (!fs.existsSync(root)) return; // media is staged before a build; a bare checkout has none
    for (const [sku, positions] of Object.entries(BLANK_FRAMES)) {
      const dir = fs
        .readdirSync(root)
        .map((shard) => path.join(root, shard, sku, 'img'))
        .find((d) => fs.existsSync(d));
      expect(dir, `${sku} is in BLANK_FRAMES but has no media on disk — re-run images:audit --write`).toBeTruthy();
      if (!dir) continue;
      for (const position of positions) {
        const file = path.join(dir, `${position}-card.webp`);
        expect(fs.existsSync(file), `${sku} frame ${position} is listed blank but not on disk`).toBe(true);
        /* A flat-colour WebP compresses to a few hundred bytes; a photograph does not get near
           this. It is a cheap proxy for "still blank" that needs no image decoder in a unit test. */
        expect(fs.statSync(file).size, `${sku} frame ${position} is listed blank but is ${fs.statSync(file).size}B — re-run images:audit --write`).toBeLessThan(
          1024,
        );
      }
    }
  });
});
