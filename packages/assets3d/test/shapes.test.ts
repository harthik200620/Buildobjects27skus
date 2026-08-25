import { describe, expect, it } from 'vitest';
import type { MeshData } from '../src/gltf';
import { box, boxFaces, cylinder, lathe, rotate, translate } from '../src/shapes';
import { FLAT } from './helpers';

const triNormal = (m: MeshData, t: number) => [m.normals[m.indices[t * 3] * 3], m.normals[m.indices[t * 3] * 3 + 1], m.normals[m.indices[t * 3] * 3 + 2]];
const triCentroid = (m: MeshData, t: number) => {
  const c = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const v = m.indices[t * 3 + k];
    c[0] += m.positions[v * 3] / 3;
    c[1] += m.positions[v * 3 + 1] / 3;
    c[2] += m.positions[v * 3 + 2] / 3;
  }
  return c;
};
/** Geometric normal from the winding (counter-clockwise = outward). */
const windingNormal = (m: MeshData, t: number) => {
  const p = (k: number) => {
    const v = m.indices[t * 3 + k];
    return [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]];
  };
  const a = p(0),
    b = p(1),
    c = p(2);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('shapes', () => {
  it('box: outward normals and consistent winding; no UVs unless asked', () => {
    const m = box(0.2, 0.1, 0.05, [0, 0.05, 0], FLAT);
    expect(m.uvs).toBeUndefined();
    for (let t = 0; t < m.indices.length / 3; t++) {
      const c = triCentroid(m, t),
        n = triNormal(m, t),
        w = windingNormal(m, t);
      expect(dot(n, [c[0], c[1] - 0.05, c[2]])).toBeGreaterThan(0); // points away from the centre
      expect(dot(n, w)).toBeGreaterThan(0); // winding agrees with the stored normal
    }
  });

  it('box uv: "front" maps only the +z face upright; "all" maps every face; "top" maps the top', () => {
    const front = box(1, 1, 1, [0, 0.5, 0], FLAT, { uv: 'front' });
    expect(front.uvs).toHaveLength((front.positions.length / 3) * 2);
    // first 6 vertices (2 tris) are the front face: bottom-left (0,1), bottom-right (1,1), top-right (1,0) …
    expect(front.uvs!.slice(0, 6)).toEqual([0, 1, 1, 1, 1, 0]);
    expect(front.uvs!.slice(12).every((v) => v === 0)).toBe(true);
    const all = box(1, 1, 1, [0, 0.5, 0], FLAT, { uv: 'all' });
    expect(all.uvs!.some((v, i) => i >= 12 && v === 1)).toBe(true);
    const top = box(1, 1, 1, [0, 0.5, 0], FLAT, { uv: 'top' });
    // faces are 6 vertices (12 uv numbers) each: front, back, right, left, top, bottom
    expect(top.uvs!.slice(0, 48).every((v) => v === 0)).toBe(true);
    expect(top.uvs!.slice(48, 54)).toEqual([0, 1, 1, 1, 1, 0]);
    expect(top.uvs!.slice(60).every((v) => v === 0)).toBe(true);
  });

  it('boxFaces groups faces by material', () => {
    const photo = { ...FLAT, name: 'photo' },
      side = { ...FLAT, name: 'side' };
    const meshes = boxFaces(1, 1, 1, [0, 0.5, 0], { top: photo, bottom: photo, rest: side }, 'all');
    expect(meshes).toHaveLength(2);
    const byName = Object.fromEntries(meshes.map((m) => [m.material.name, m.indices.length / 3]));
    expect(byName).toEqual({ photo: 4, side: 8 });
  });

  it('lathe / cylinder: outward normals (flat and smooth), unit length', () => {
    for (const smooth of [false, true]) {
      const m = cylinder(0.1, 0.1, 0.3, 24, [0, 0, 0], FLAT, { smooth });
      for (let t = 0; t < m.indices.length / 3; t++) {
        const c = triCentroid(m, t),
          n = triNormal(m, t),
          w = windingNormal(m, t);
        expect(dot(n, w)).toBeGreaterThan(0);
        const radial = [c[0], 0, c[2]];
        const isSide = Math.abs(n[1]) < 0.5;
        if (isSide) expect(dot(n, radial)).toBeGreaterThan(0);
        else expect(Math.sign(n[1])).toBe(c[1] > 0.15 ? 1 : -1);
      }
      for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2])).toBeCloseTo(1, 5);
    }
    // smooth shares vertices: far fewer than 6 per quad
    expect(cylinder(0.1, 0.1, 0.3, 24, [0, 0, 0], FLAT, { smooth: true, caps: false }).positions.length).toBeLessThan(
      cylinder(0.1, 0.1, 0.3, 24, [0, 0, 0], FLAT, { caps: false }).positions.length,
    );
  });

  it('cylindrical uv: u = 0.5 at +Z, v from 1 (bottom) to 0 (top); arcs remap u across the arc', () => {
    const m = cylinder(0.1, 0.1, 0.3, 36, [0, 0, 0], FLAT, { uv: 'cylindrical', smooth: true, caps: false });
    let found = false;
    for (let i = 0; i < m.positions.length / 3; i++) {
      const x = m.positions[i * 3],
        y = m.positions[i * 3 + 1],
        z = m.positions[i * 3 + 2];
      if (Math.abs(x) < 1e-6 && z > 0.099) {
        found = true;
        expect(m.uvs![i * 2]).toBeCloseTo(0.5, 6);
        expect(m.uvs![i * 2 + 1]).toBeCloseTo(y < 0.15 ? 1 : 0, 6);
      }
    }
    expect(found).toBe(true);
    const arc = cylinder(0.1, 0.1, 0.3, 36, [0, 0, 0], FLAT, { uv: 'cylindrical', arc: [0.25, 0.75], caps: false });
    const us = Array.from({ length: arc.uvs!.length / 2 }, (_, i) => arc.uvs![i * 2]);
    expect(Math.min(...us)).toBeCloseTo(0, 6);
    expect(Math.max(...us)).toBeCloseTo(1, 6);
    expect(arc.positions.filter((_, i) => i % 3 === 2).every((z) => z > -1e-6)).toBe(true); // front half only
    expect(arc.indices.length).toBe(cylinder(0.1, 0.1, 0.3, 36, [0, 0, 0], FLAT, { caps: false }).indices.length / 2);
  });

  it('rotate / translate carry UVs through', () => {
    const m = box(1, 1, 1, [0, 0.5, 0], FLAT, { uv: 'all' });
    expect(rotate(m, 'y', Math.PI / 2).uvs).toEqual(m.uvs);
    expect(translate(m, [1, 2, 3]).uvs).toEqual(m.uvs);
    const flat = lathe(
      [
        [0.1, 0],
        [0.1, 0.2],
      ],
      12,
      [0, 0, 0],
      FLAT,
    );
    expect(rotate(flat, 'x', 1).uvs).toBeUndefined();
  });
});
