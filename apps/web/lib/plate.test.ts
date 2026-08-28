import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { groundFor, PLATE_COLORS } from './plate';

/** Mean channel value of a #rrggbb, the same measure groundFor uses to call light or dark. */
const mean = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
};

const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalogue', 'skus.json'), 'utf8')) as Record<
  string,
  { sku?: { code?: string }; images?: { blurhash?: string | null }[] }
>;

describe('the mount a photograph is painted on', () => {
  it('says nothing when there is no hash to read, so the stylesheet default stands', () => {
    expect(groundFor(null)).toBeNull();
    expect(groundFor(undefined)).toBeNull();
    expect(groundFor('')).toBeNull();
  });

  it('survives a malformed hash rather than taking the product page down with it', () => {
    expect(groundFor('not-a-blurhash')).toBeNull();
    expect(groundFor('L')).toBeNull();
  });

  /*
   * The claim this whole mechanism rests on: a hash can tell a frame shot on a sweep from one
   * shot on a dark ground. Checked against scripts/blend-skus.mts's table, which is sampled from
   * the real border pixels of each SKU's first frame — the accurate answer, for the one frame it
   * covers. Anything above 24 of 26 means the hash is a sound stand-in for the frames the table
   * does not reach, which is every frame after the first.
   */
  it('agrees with the pixel-sampled table on the frames that table covers', () => {
    let agree = 0;
    let checked = 0;
    for (const row of Object.values(catalogue)) {
      const code = row.sku?.code;
      const hash = row.images?.[0]?.blurhash;
      const sampled = code ? PLATE_COLORS[code] : undefined;
      if (!hash || !sampled) continue;
      checked++;
      if (groundFor(hash)?.light === mean(sampled) >= 165) agree++;
    }
    expect(checked).toBeGreaterThan(20);
    expect(agree).toBeGreaterThanOrEqual(checked - 1);
  });

  it('mixes toward the frame over one of the two theme mounts, never a raw colour', () => {
    for (const row of Object.values(catalogue)) {
      for (const im of row.images ?? []) {
        if (!im.blurhash) continue;
        const g = groundFor(im.blurhash);
        expect(g).not.toBeNull();
        /* Untokenised colour is what `pnpm contrast` exists to stop; the mix always lands on a
           theme variable so a palette change carries every mount with it. */
        expect(g?.plate).toMatch(/^color-mix\(in oklab, #[0-9a-f]{6} \d+%, var\(--plate-(1|dark)\)\)$/);
      }
    }
  });

  /* The catalogue this was built for: mostly NOT on a sweep, which is why the fixed silver mount
     was wrong. If a future media pass puts everything on the sweep, this failing is the signal
     to go back and ask whether the dark mount is still earning its place. */
  it('finds this catalogue is mostly not shot on a sweep', () => {
    let light = 0;
    let dark = 0;
    for (const row of Object.values(catalogue)) {
      for (const im of row.images ?? []) {
        if (!im.blurhash) continue;
        groundFor(im.blurhash)?.light ? light++ : dark++;
      }
    }
    expect(light + dark).toBeGreaterThan(50);
    expect(dark).toBeGreaterThan(light);
  });
});
