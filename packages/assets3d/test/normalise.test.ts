import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildGlb } from '../src/gltf';
import { chooseAxisPermutation, collectTriangles, cutoutMask, extents, gltfIO, iou, normaliseGlb, rasteriseSilhouette } from '../src/photoreal/normalise';
import { box, texturedMaterial } from '../src/shapes';
import { boxGlb, FLAT, lShapeGlb, lShapeMask, maskPng, pngSolid, studioPhoto } from './helpers';

async function readBack(glb: Buffer) {
  const io = await gltfIO();
  const doc = await io.readBinary(new Uint8Array(glb));
  const soup = collectTriangles(doc);
  return { doc, soup, ...extents(soup.positions) };
}

describe('normalise — scale / axis / front', () => {
  it('scales a 2 × 1 × 0.5 box declared as 200 × 100 × 50 mm, re-centres x/z and puts the base on y = 0', async () => {
    const res = await normaliseGlb(boxGlb(2, 1, 0.5, [5, 3, -2]), { dims: { w: 0.2, h: 0.1, d: 0.05 } });
    expect(res.rejected).toBeNull();
    expect(res.axis_map).toBe('x,y,z');
    expect(res.scale).toBeCloseTo(0.1, 6);
    expect(res.aspect_mismatch).toBeCloseTo(0, 6);
    const back = await readBack(res.glb!);
    expect(back.size[0]).toBeCloseTo(0.2, 4);
    expect(back.size[1]).toBeCloseTo(0.1, 4);
    expect(back.size[2]).toBeCloseTo(0.05, 4);
    expect(back.min[1]).toBeCloseTo(0, 4);
    expect((back.min[0] + back.max[0]) / 2).toBeCloseTo(0, 4);
    expect((back.min[2] + back.max[2]) / 2).toBeCloseTo(0, 4);
    expect(res.triangles).toBe(12);
    expect(res.warnings.some((w) => /front check skipped: no hero/.test(w))).toBe(true);
  });

  it('fixes a Z-up model (height along z) with the x,z,-y permutation', async () => {
    // extents x 0.2, y 0.05, z 0.1 — the model's "up" is +z; spec says 200 wide × 100 high × 50 deep
    const res = await normaliseGlb(boxGlb(0.2, 0.05, 0.1, [0, 0, 0]), { dims: { w: 0.2, h: 0.1, d: 0.05 } });
    expect(res.rejected).toBeNull();
    expect(res.axis_map).toBe('x,z,-y');
    const back = await readBack(res.glb!);
    expect(back.size[0]).toBeCloseTo(0.2, 4);
    expect(back.size[1]).toBeCloseTo(0.1, 4);
    expect(back.size[2]).toBeCloseTo(0.05, 4);
    expect(chooseAxisPermutation([0.2, 0.05, 0.1], [0.2, 0.1, 0.05]).name).toBe('x,z,-y');
    expect(chooseAxisPermutation([0.05, 0.2, 0.1], [0.2, 0.1, 0.05]).name).toBe('-y,z,-x'); // X-up, depth along y
    expect(chooseAxisPermutation([0.1, 0.2, 0.05], [0.2, 0.1, 0.05]).name).toBe('-y,x,z'); // X-up
    expect(chooseAxisPermutation([1.2, 1.8, 0.006], [1.2, 1.8, 0.006]).name).toBe('x,y,z'); // a pane keeps identity
  });

  it('turns a model whose photographed front faces -Z by 180° so the front faces +Z', async () => {
    const mask = await lShapeMask();
    const right = await normaliseGlb(lShapeGlb('right'), { dims: { w: 0.25, h: 0.1, d: 0.05 }, heroCutout: mask });
    expect(right.rejected).toBeNull();
    expect(right.front_yaw_deg).toBe(0);
    expect(right.silhouette_iou).toBeGreaterThan(0.9);

    const left = await normaliseGlb(lShapeGlb('left'), { dims: { w: 0.25, h: 0.1, d: 0.05 }, heroCutout: mask });
    expect(left.rejected).toBeNull();
    expect(left.front_yaw_deg).toBe(180);
    expect(left.iou_by_yaw!['180']).toBeGreaterThan(left.iou_by_yaw!['0'] + 0.1);
    const back = await readBack(left.glb!);
    // after the turn the arm (y > 0.075) reaches the +x edge while the base row (y < 0.025) stops short of it
    let topMax = -Infinity,
      bottomMax = -Infinity;
    for (let i = 0; i < back.soup.positions.length; i += 3) {
      const x = back.soup.positions[i],
        y = back.soup.positions[i + 1];
      if (y > 0.075) topMax = Math.max(topMax, x);
      if (y < 0.025) bottomMax = Math.max(bottomMax, x);
    }
    expect(topMax).toBeCloseTo(back.max[0], 4);
    expect(bottomMax).toBeLessThan(back.max[0] - 0.04);
  });

  it('rejects a model whose proportions are far from the spec and warns on moderate mismatch', async () => {
    const cube = await normaliseGlb(boxGlb(1, 1, 1), { dims: { w: 0.2, h: 0.1, d: 0.02 } });
    expect(cube.glb).toBeNull();
    expect(cube.rejected).toMatch(/aspect mismatch/);
    const mild = await normaliseGlb(boxGlb(2, 1, 0.5), { dims: { w: 0.2, h: 0.12, d: 0.05 } });
    expect(mild.rejected).toBeNull();
    expect(mild.warnings.some((w) => /aspect mismatch/.test(w))).toBe(true);
  });

  it('skips the front check for a rectangular or empty cut-out and reports it', async () => {
    const rect = await maskPng(100, 60, [{ left: 0, top: 0, width: 100, height: 60 }]);
    const res = await normaliseGlb(boxGlb(2, 1, 0.5), { dims: { w: 0.2, h: 0.1, d: 0.05 }, heroCutout: rect });
    expect(res.warnings.some((w) => /full rectangle/.test(w))).toBe(true);
    expect(res.silhouette_iou).toBeNull();
    expect(await cutoutMask(await maskPng(10, 10, []))).toBeNull();
  });

  it('compresses textures to ≤ 2048 px (JPEG when opaque) and reports size; solid textures fold into factors', async () => {
    // a real (non-uniform) texture: white with a coloured block, 3000 × 2500, no alpha
    const big = await studioPhoto(3000, 2500, { left: 500, top: 400, width: 1500, height: 1250 }, [40, 80, 120]);
    const glb = buildGlb([box(1, 1, 1, [0, 0.5, 0], texturedMaterial('big', { image: big, mime: 'image/png' }), { uv: 'all' })], 'big-tex').glb;
    const res = await normaliseGlb(glb, { dims: { w: 0.1, h: 0.1, d: 0.1 } });
    expect(res.rejected).toBeNull();
    expect(res.textures).toEqual({ count: 1, max_px: 2048 });
    const back = await readBack(res.glb!);
    const tex = back.doc.getRoot().listTextures()[0];
    expect(tex.getMimeType()).toBe('image/jpeg');
    const meta = await sharp(Buffer.from(tex.getImage()!)).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2048);
    expect(res.size_mb).toBeLessThan(1);
    // gltf-transform's prune() turns a single-colour texture into a plain baseColorFactor
    const solid = buildGlb(
      [box(1, 1, 1, [0, 0.5, 0], texturedMaterial('solid', { image: await pngSolid(64, 64, [40, 80, 120, 255]), mime: 'image/png' }), { uv: 'all' })],
      'solid-tex',
    ).glb;
    expect((await normaliseGlb(solid, { dims: { w: 0.1, h: 0.1, d: 0.1 } })).textures.count).toBe(0);
  });

  it('rejects unreadable input', async () => {
    const res = await normaliseGlb(Buffer.from('not a glb'), { dims: { w: 1, h: 1, d: 1 } });
    expect(res.glb).toBeNull();
    expect(res.rejected).toMatch(/unreadable/);
  });
});

describe('silhouette rasteriser', () => {
  it('rasterises a box to a filled rectangle and mirrors under a 180° yaw', () => {
    const soup = collectTriangles;
    void soup;
    const m = box(0.2, 0.1, 0.05, [0, 0.05, 0], FLAT);
    const tri = { positions: new Float32Array(m.positions), indices: new Uint32Array(m.indices), count: m.indices.length / 3 };
    const a = rasteriseSilhouette(tri, 0, 64);
    expect(a.reduce((s, v) => s + v, 0)).toBeGreaterThan(64 * 30);
    expect(iou(a, rasteriseSilhouette(tri, 180, 64))).toBeCloseTo(1, 2);
    const side = rasteriseSilhouette(tri, 90, 64);
    expect(iou(a, side)).toBeLessThan(0.6);
  });
});
