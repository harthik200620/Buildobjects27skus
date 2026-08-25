import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MIN_SOURCE_WIDTH, SOFT_SOURCE_WIDTH, studioScore } from './images';

/**
 * `studioScore` decides which of a brand's own photographs becomes the hero. It exists because
 * filename ranking gave UltraTech a city skyline and Topcon two surveyors in a field — both on
 * the right domain, neither of them the product. The images here are synthesised so the test
 * states the signal rather than depending on a fixture.
 */

/** A catalogue shot: a subject on a plain sweep, square frame. */
async function studio(bg: number, size = 600): Promise<Buffer> {
  const inset = Math.round(size * 0.25);
  const subject = await sharp({ create: { width: size - inset * 2, height: size - inset * 2, channels: 3, background: { r: 40, g: 60, b: 90 } } })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: bg, g: bg, b: bg } } })
    .composite([{ input: subject, top: inset, left: inset }])
    .png()
    .toBuffer();
}

/**
 * A scene: structure right out to the edges, wide frame. Blocks rather than noise, because the
 * score reads a 32x32 downsample and per-pixel noise averages away to something flat — which
 * is a photograph of nothing, not a photograph of a building.
 */
async function scene(width = 1600, height = 600, block = 100): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dark = (((x / block) | 0) + ((y / block) | 0)) % 2 === 0;
      const v = dark ? 28 : 214;
      const i = (y * width + x) * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe('studioScore', () => {
  it('scores a product on a white sweep far above a scene', async () => {
    const [product, photo] = await Promise.all([studio(255), scene()]);
    expect(await studioScore(product)).toBeGreaterThan(0.8);
    expect(await studioScore(photo)).toBeLessThan(0.3);
  });

  it('still scores a product on a dark sweep well above a scene', async () => {
    // Adani photograph their cement bags on a dark ground; uniformity has to outweigh lightness.
    const [darkProduct, photo] = await Promise.all([studio(20), scene()]);
    expect(await studioScore(darkProduct)).toBeGreaterThan(await studioScore(photo));
    expect(await studioScore(darkProduct)).toBeGreaterThan(0.5);
  });

  it('prefers a square frame to a wide one when both are on a plain ground', async () => {
    const square = await studio(255, 600);
    const wide = await sharp(await studio(255, 600))
      .resize(1600, 500, { fit: 'fill' })
      .png()
      .toBuffer();
    expect(await studioScore(square)).toBeGreaterThan(await studioScore(wide));
  });

  it('returns 0 for something that is not an image rather than throwing', async () => {
    expect(await studioScore(Buffer.from('this is not an image'))).toBe(0);
  });
});

describe('source width floor', () => {
  it('sits below the width the zoom pane needs, so small sources are kept and flagged soft', () => {
    expect(SOFT_SOURCE_WIDTH).toBeLessThan(MIN_SOURCE_WIDTH);
  });

  it('admits the smallest photograph a brand in this catalogue actually publishes', () => {
    // CP Plus publish their cameras at 280x200 and nothing larger; a floor above that left the
    // SKU showing a category thumbnail of a Wi-Fi router instead of its own camera.
    expect(SOFT_SOURCE_WIDTH).toBeLessThanOrEqual(280);
  });
});
