import fs from 'node:fs';
import path from 'node:path';
import { shard } from '@buildobjects/catalog';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BUILDERS } from '../src/builders';
import { buildGlb } from '../src/gltf';
import { bandCrop, flattenOnto, heroCutoutFor, knockoutWhite, meanColour, prepareTextures, usesPhotos } from '../src/textures';
import { maskPng, studioPhoto, tmpDir } from './helpers';

const alphaAt = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3];
};

describe('textures', () => {
  it('knockoutWhite makes the border-connected white transparent and keeps the product', async () => {
    const photo = await studioPhoto(200, 200, { left: 50, top: 40, width: 100, height: 120 });
    const cut = await knockoutWhite(photo);
    expect(await alphaAt(cut, 2, 2)).toBe(0);
    expect(await alphaAt(cut, 100, 100)).toBe(255);
    expect(await alphaAt(cut, 52, 42)).toBe(255);
  });

  it('meanColour is alpha-weighted and sRGB 0–1', async () => {
    const cut = await knockoutWhite(await studioPhoto(200, 200, { left: 50, top: 40, width: 100, height: 120 }, [200, 30, 30]));
    const [r, g, b, a] = await meanColour(cut);
    expect(r).toBeCloseTo(200 / 255, 1);
    expect(g).toBeCloseTo(30 / 255, 1);
    expect(b).toBeCloseTo(30 / 255, 1);
    expect(a).toBeCloseTo((100 * 120) / (200 * 200), 1);
  });

  it('bandCrop takes rows of the product bbox, not the frame', async () => {
    const mask = await maskPng(200, 200, [{ left: 50, top: 40, width: 100, height: 120 }]);
    const band = await bandCrop(mask, 0.3, 0.7);
    const meta = await sharp(band).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(48);
    await expect(bandCrop(mask, 0.7, 0.3)).rejects.toThrow(/bad range/);
  });

  it('flattenOnto composites the cut-out over the mean colour as a JPEG ≤ 1024 px', async () => {
    const mask = await maskPng(3000, 1500, [{ left: 100, top: 100, width: 2000, height: 1000 }]);
    const tex = await flattenOnto(mask, [0.2, 0.4, 0.6, 1]);
    expect(tex.mime).toBe('image/jpeg');
    expect(Math.max(tex.width, tex.height)).toBe(1024);
    expect(tex.image.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('heroCutoutFor prefers {n}-cutout.png, falls back to the orig only when allowed', async () => {
    const root = tmpDir('media');
    const sku = 'TST-HERO-1';
    const dir = path.join(root, 'skus', shard(sku), sku, 'img');
    fs.mkdirSync(dir, { recursive: true });
    expect(await heroCutoutFor(sku, root)).toBeNull();
    fs.writeFileSync(path.join(dir, '1-orig.png'), await studioPhoto());
    expect(await heroCutoutFor(sku, root, { allowOrig: false })).toBeNull();
    const fromOrig = await heroCutoutFor(sku, root);
    expect(fromOrig?.source).toBe('orig');
    expect(fromOrig?.key).toBe(`skus/${shard(sku)}/${sku}/img/1-orig.png`);
    expect(await alphaAt(fromOrig!.buffer, 1, 1)).toBe(0);
    fs.writeFileSync(path.join(dir, '1-cutout.png'), await maskPng(120, 120, [{ left: 10, top: 10, width: 100, height: 100 }]));
    const fromCut = await heroCutoutFor(sku, root, { allowOrig: false });
    expect(fromCut?.source).toBe('cutout');
    expect(fromCut?.key).toBe(`skus/${shard(sku)}/${sku}/img/1-cutout.png`);
    expect(fromCut?.width).toBe(120);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('prepareTextures maps photos per category and the builders wear them', async () => {
    const hero = { buffer: await knockoutWhite(await studioPhoto()), key: 'hero' };
    const angle = { buffer: await knockoutWhite(await studioPhoto(200, 200, { left: 20, top: 20, width: 160, height: 160 }, [20, 20, 200])), key: 'angle' };
    const cement = await prepareTextures('cement', { hero, angle });
    expect(cement?.hero?.mime).toBe('image/jpeg');
    expect(cement?.angle).toBeDefined();
    expect(cement?.sources).toEqual(['hero', 'angle']);
    const ext = await prepareTextures('fire-extinguishers', { hero });
    expect(ext?.band).toBeDefined();
    expect(ext?.hero).toBeUndefined();
    const glass = await prepareTextures('glass', { hero });
    expect(glass?.mean?.[0]).toBeGreaterThan(0.6);
    expect(glass?.hero).toBeUndefined();
    expect(await prepareTextures('bulbs', { hero })).toBeNull();
    expect(usesPhotos('bulbs')).toBe(false);
    expect(usesPhotos('tiles')).toBe(true);

    const dims = { w: 0.52, h: 0.76, d: 0.12 };
    const plain = BUILDERS.cement(dims, {});
    const textured = BUILDERS.cement(dims, { textures: cement });
    expect(plain.textured).toBe(false);
    expect(textured.textured).toBe(true);
    const glb = buildGlb(textured.meshes, 'cement');
    expect(glb.textures).toBe(2);
    for (const [cat, tex] of [
      ['tiles', await prepareTextures('tiles', { hero })],
      ['epoxy', await prepareTextures('epoxy', { hero })],
      ['solar-panels', await prepareTextures('solar-panels', { hero })],
      ['fire-extinguishers', ext],
      ['glass', glass],
      ['cctv', await prepareTextures('cctv', { hero })],
    ] as const) {
      const r = BUILDERS[cat]({ w: 0.3, h: 0.3, d: 0.3 }, { textures: tex });
      expect(r.textured, cat).toBe(true);
      expect(() => buildGlb(r.meshes, cat)).not.toThrow();
    }
    expect(buildGlb(BUILDERS.glass({ w: 1, h: 1, d: 0.006 }, { textures: glass }).meshes, 'glass').textures).toBe(0);
  });
});
