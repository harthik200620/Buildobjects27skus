/**
 * Flat- or smooth-shaded primitives in metres, Y up, front = +Z. Each returns one MeshData with
 * its own material. Winding is counter-clockwise seen from outside (outward normals) so single-
 * sided glTF materials render the outer surface.
 *
 * UV conventions (glTF: (0, 0) = top-left of the image):
 *  - box `uv: 'front' | 'all' | 'top'` — planar per face, image upright as seen from outside that
 *    face; the top face reads with its image top towards -Z (away from a viewer standing at +Z).
 *  - lathe / cylinder `uv: 'cylindrical'` — u runs around the axis with u = 0.5 at +Z (the front)
 *    and the seam at -Z; v runs along the profile, 1 at the bottom and 0 at the top.
 */
import type { Material, MeshData, TextureImage } from './gltf';

export type V3 = [number, number, number];
export type V2 = [number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export class Builder {
  positions: number[] = [];
  normals: number[] = [];
  indices: number[] = [];
  uvs: number[] = [];
  private hasUv = false;
  constructor(public material: Material) {}
  private push(p: V3, n: V3, uv?: V2) {
    this.positions.push(...p);
    this.normals.push(...n);
    if (uv) {
      this.hasUv = true;
      this.uvs.push(uv[0], uv[1]);
    } else this.uvs.push(0, 0);
  }
  /** Flat-shaded triangle (a, b, c counter-clockwise from outside); optional per-vertex UVs. */
  tri(a: V3, b: V3, c: V3, uv?: [V2, V2, V2]) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    const i = this.positions.length / 3;
    this.push(a, n, uv?.[0]);
    this.push(b, n, uv?.[1]);
    this.push(c, n, uv?.[2]);
    this.indices.push(i, i + 1, i + 2);
  }
  quad(a: V3, b: V3, c: V3, d: V3, uv?: [V2, V2, V2, V2]) {
    this.tri(a, b, c, uv && [uv[0], uv[1], uv[2]]);
    this.tri(a, c, d, uv && [uv[0], uv[2], uv[3]]);
  }
  /** Shared vertex with an explicit (smooth) normal. Returns its index for `face()`. */
  vertex(p: V3, n: V3, uv?: V2): number {
    this.push(p, n, uv);
    return this.positions.length / 3 - 1;
  }
  face(i: number, j: number, k: number) {
    this.indices.push(i, j, k);
  }
  mesh(): MeshData {
    const m: MeshData = { positions: this.positions, normals: this.normals, indices: this.indices, material: this.material };
    if (this.hasUv) m.uvs = this.uvs;
    return m;
  }
}

export type BoxFace = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';
export type BoxUv = 'front' | 'all' | 'top' | 'none';
export interface BoxOptions {
  uv?: BoxUv /** Subset of faces to emit (default all six). */;
  faces?: BoxFace[];
}
export const BOX_FACES: BoxFace[] = ['front', 'back', 'right', 'left', 'top', 'bottom'];
/** bottom-left, bottom-right, top-right, top-left as seen from outside the face → image upright. */
const FACE_UV: [V2, V2, V2, V2] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

function boxInto(b: Builder, w: number, h: number, d: number, c: V3, opts: BoxOptions) {
  const [cx, cy, cz] = c,
    x0 = cx - w / 2,
    x1 = cx + w / 2,
    y0 = cy - h / 2,
    y1 = cy + h / 2,
    z0 = cz - d / 2,
    z1 = cz + d / 2;
  const quads: Record<BoxFace, [V3, V3, V3, V3]> = {
    front: [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ], // +z
    back: [
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
    ],
    right: [
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
    ],
    left: [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ],
    top: [
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [x0, y1, z0],
    ],
    bottom: [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
  };
  const uv = opts.uv ?? 'none';
  for (const f of opts.faces ?? BOX_FACES) {
    const mapped = uv === 'all' || (uv === 'front' && f === 'front') || (uv === 'top' && f === 'top');
    b.quad(...quads[f], mapped ? FACE_UV : undefined);
  }
}

/** Axis-aligned box, centred at (cx, cy, cz). */
export function box(w: number, h: number, d: number, c: V3, mat: Material, opts: BoxOptions = {}): MeshData {
  const b = new Builder(mat);
  boxInto(b, w, h, d, c, opts);
  return b.mesh();
}

/**
 * A box whose faces carry different materials (photo front/back, mean-colour sides, …).
 * Faces sharing a material object are merged into one mesh; `uv` applies to every mapped face.
 */
export function boxFaces(w: number, h: number, d: number, c: V3, mats: Partial<Record<BoxFace, Material>> & { rest: Material }, uv: BoxUv = 'all'): MeshData[] {
  const groups = new Map<Material, BoxFace[]>();
  for (const f of BOX_FACES) {
    const m = mats[f] ?? mats.rest;
    const g = groups.get(m);
    if (g) g.push(f);
    else groups.set(m, [f]);
  }
  return [...groups].map(([m, faces]) => box(w, h, d, c, m, { uv, faces }));
}

export interface LatheOptions {
  uv?: 'cylindrical' | 'none';
  /** Average vertex normals along the profile so bulbs / tins are not faceted. */
  smooth?: boolean;
  /** Partial turn, as fractions of a full circle in u-space (u = 0.5 faces +Z; [0.25, 0.75] is the front half). */
  arc?: [number, number];
  /** u range the texture spans (default: the arc), so one image wraps exactly one arc. */
  uvSpan?: [number, number];
  /** End caps (cylinder only; lathe takes `caps` as a positional argument). */
  caps?: boolean;
}
const FULL_TURN: [number, number] = [0.25, 1.25];

/** Surface of revolution around the Y axis at (cx, cz): profile = [radius, y] pairs from bottom to top. */
export function lathe(profile: [number, number][], seg: number, c: V3, mat: Material, caps = true, opts: LatheOptions = {}): MeshData {
  const b = new Builder(mat);
  const [cx, cy, cz] = c;
  // u-space: k / seg + 0.25, so u = 0.5 at +Z. A full turn maps the image once around with the seam at -Z;
  // an explicit arc maps the image across that arc only.
  const arc = opts.arc ?? FULL_TURN,
    span = opts.uvSpan ?? (opts.arc ? opts.arc : [0, 1]);
  const k0 = Math.round((arc[0] - 0.25) * seg),
    k1 = Math.round((arc[1] - 0.25) * seg);
  const uvOn = opts.uv === 'cylindrical';
  const ang = (k: number) => (k / seg) * Math.PI * 2; // k = 0 at +X, k = seg / 4 at +Z
  const uAt = (k: number) => (k / seg + 0.25 - span[0]) / (span[1] - span[0]);
  const p = (r: number, y: number, k: number): V3 => {
    const a = ang(k);
    return [cx + r * Math.cos(a), cy + y, cz + r * Math.sin(a)];
  };
  const last = profile.length - 1;
  const cum = [0];
  for (let i = 0; i < last; i++) cum.push(cum[i] + Math.hypot(profile[i + 1][0] - profile[i][0], profile[i + 1][1] - profile[i][1]));
  const total = cum[last] || 1;
  const vAt = (i: number) => 1 - cum[i] / total;

  if (opts.smooth) {
    // 2-D profile normals (outward), averaged at the joints, swept around the axis
    const nrm: V2[] = profile.map((_, i) => {
      const prev = profile[Math.max(i - 1, 0)],
        next = profile[Math.min(i + 1, last)];
      const t: V2 = [next[0] - prev[0], next[1] - prev[1]];
      const l = Math.hypot(t[0], t[1]) || 1;
      return [t[1] / l, -t[0] / l];
    });
    const cols = k1 - k0 + 1;
    const idx = (i: number, k: number) => i * cols + (k - k0);
    for (let i = 0; i <= last; i++)
      for (let k = k0; k <= k1; k++) {
        const a = ang(k),
          [r, y] = profile[i];
        b.vertex(p(r, y, k), [nrm[i][0] * Math.cos(a), nrm[i][1], nrm[i][0] * Math.sin(a)], uvOn ? [uAt(k), vAt(i)] : undefined);
      }
    for (let i = 0; i < last; i++) {
      const r0 = profile[i][0],
        r1 = profile[i + 1][0];
      if (r0 === 0 && r1 === 0) continue;
      for (let k = k0; k < k1; k++) {
        const a = idx(i, k),
          bq = idx(i, k + 1),
          cq = idx(i + 1, k + 1),
          d = idx(i + 1, k);
        if (r0 === 0) b.face(a, d, cq);
        else if (r1 === 0) b.face(bq, a, cq);
        else {
          b.face(bq, a, d);
          b.face(bq, d, cq);
        }
      }
    }
  } else {
    for (let i = 0; i < last; i++) {
      const [r0, y0] = profile[i],
        [r1, y1] = profile[i + 1];
      if (r0 === 0 && r1 === 0) continue;
      for (let k = k0; k < k1; k++) {
        const a = p(r0, y0, k),
          bq = p(r0, y0, k + 1),
          cq = p(r1, y1, k + 1),
          d = p(r1, y1, k);
        const ua: V2 = [uAt(k), vAt(i)],
          ub: V2 = [uAt(k + 1), vAt(i)],
          uc: V2 = [uAt(k + 1), vAt(i + 1)],
          ud: V2 = [uAt(k), vAt(i + 1)];
        if (r0 === 0) b.tri(a, d, cq, uvOn ? [ua, ud, uc] : undefined);
        else if (r1 === 0) b.tri(bq, a, cq, uvOn ? [ub, ua, uc] : undefined);
        else b.quad(bq, a, d, cq, uvOn ? [ub, ua, ud, uc] : undefined);
      }
    }
  }
  if (caps) {
    const [rb, yb] = profile[0],
      [rt, yt] = profile[last];
    if (rb > 0) for (let k = k0; k < k1; k++) b.tri([cx, cy + yb, cz], p(rb, yb, k), p(rb, yb, k + 1));
    if (rt > 0) for (let k = k0; k < k1; k++) b.tri([cx, cy + yt, cz], p(rt, yt, k + 1), p(rt, yt, k));
  }
  return b.mesh();
}

/** Cylinder / frustum standing on y = cy, radius rBottom → rTop. */
export function cylinder(rBottom: number, rTop: number, h: number, seg: number, c: V3, mat: Material, opts: LatheOptions = {}): MeshData {
  return lathe(
    [
      [rBottom, 0],
      [rTop, h],
    ],
    seg,
    c,
    mat,
    opts.caps ?? true,
    opts,
  );
}

/** A sphere / dome: hemisphere when `fraction` = 0.5. */
export function dome(r: number, seg: number, c: V3, mat: Material, fraction = 0.5, rings = 10, opts: LatheOptions = {}): MeshData {
  const prof: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI * fraction;
    prof.push([r * Math.sin(Math.PI / 2 - t), r * Math.cos(Math.PI / 2 - t)]);
  }
  // prof runs from the equator (bottom) to the pole (top)
  return lathe(
    prof.map(([rr, y]) => [rr, y]),
    seg,
    c,
    mat,
    true,
    opts,
  );
}

/** Rotate a mesh about an axis through `about`. Normals rotate too; UVs are carried unchanged. */
export function rotate(m: MeshData, axis: 'x' | 'y' | 'z', rad: number, about: V3 = [0, 0, 0]): MeshData {
  const cs = Math.cos(rad),
    sn = Math.sin(rad);
  const rot = (v: V3): V3 => {
    const [x, y, z] = v;
    if (axis === 'x') return [x, y * cs - z * sn, y * sn + z * cs];
    if (axis === 'y') return [x * cs + z * sn, y, -x * sn + z * cs];
    return [x * cs - y * sn, x * sn + y * cs, z];
  };
  const positions: number[] = [],
    normals: number[] = [];
  for (let i = 0; i < m.positions.length; i += 3) {
    const r = rot([m.positions[i] - about[0], m.positions[i + 1] - about[1], m.positions[i + 2] - about[2]]);
    positions.push(r[0] + about[0], r[1] + about[1], r[2] + about[2]);
  }
  for (let i = 0; i < m.normals.length; i += 3) normals.push(...rot([m.normals[i], m.normals[i + 1], m.normals[i + 2]]));
  return { ...m, positions, normals, ...(m.uvs ? { uvs: m.uvs } : {}) };
}

export function translate(m: MeshData, d: V3): MeshData {
  const positions: number[] = [];
  for (let i = 0; i < m.positions.length; i += 3) positions.push(m.positions[i] + d[0], m.positions[i + 1] + d[1], m.positions[i + 2] + d[2]);
  return { ...m, positions, ...(m.uvs ? { uvs: m.uvs } : {}) };
}

/** A thin torus-like ring approximated by a lathe (used for lens rings, bulb collars). */
export function ring(rOuter: number, rInner: number, h: number, seg: number, c: V3, mat: Material): MeshData {
  return lathe(
    [
      [rInner, 0],
      [rOuter, 0],
      [rOuter, h],
      [rInner, h],
      [rInner, 0],
    ],
    seg,
    c,
    mat,
    false,
  );
}

/** sRGB (0–1) → linear, for a `baseColorFactor` taken from a photo's mean colour. */
export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** A material that shows a photo (colour factor white so the texture is not tinted). */
export function texturedMaterial(name: string, tex: TextureImage, opts: { roughness?: number; metallic?: number; doubleSided?: boolean } = {}): Material {
  return {
    name,
    color: [1, 1, 1, 1],
    metallic: opts.metallic ?? 0,
    roughness: opts.roughness ?? 0.75,
    baseColorTexture: { image: tex.image, mime: tex.mime },
    ...(opts.doubleSided ? { doubleSided: true } : {}),
  };
}
/** A flat material from an sRGB mean colour ([r, g, b, a] in 0–1). */
export function tintedMaterial(
  name: string,
  srgb: [number, number, number, number] | [number, number, number],
  opts: { roughness?: number; metallic?: number; alpha?: number; blend?: boolean; doubleSided?: boolean } = {},
): Material {
  return {
    name,
    color: [srgbToLinear(srgb[0]), srgbToLinear(srgb[1]), srgbToLinear(srgb[2]), opts.alpha ?? 1],
    metallic: opts.metallic ?? 0,
    roughness: opts.roughness ?? 0.6,
    ...(opts.blend ? { blend: true } : {}),
    ...(opts.doubleSided ? { doubleSided: true } : {}),
  };
}

export const MAT = {
  silver: { name: 'silver', color: [0.78, 0.78, 0.8, 1], metallic: 0.9, roughness: 0.35 } as Material,
  aluminium: { name: 'aluminium', color: [0.82, 0.84, 0.86, 1], metallic: 0.85, roughness: 0.4 } as Material,
  whitePlastic: { name: 'white-plastic', color: [0.95, 0.95, 0.95, 1], metallic: 0, roughness: 0.35 } as Material,
  blackPlastic: { name: 'black-plastic', color: [0.08, 0.08, 0.09, 1], metallic: 0.05, roughness: 0.55 } as Material,
  bulbGlass: { name: 'bulb-glass', color: [0.98, 0.98, 0.98, 1], metallic: 0, roughness: 0.18 } as Material,
  bulbDiffuser: { name: 'bulb-diffuser', color: [0.98, 0.98, 0.98, 1], metallic: 0, roughness: 0.18 } as Material,
  bulbHousing: { name: 'bulb-housing', color: [0.95, 0.95, 0.95, 1], metallic: 0, roughness: 0.35 } as Material,
  pinSilver: { name: 'pin-silver', color: [0.88, 0.88, 0.9, 1], metallic: 0.95, roughness: 0.2 } as Material,
  smokedDome: { name: 'smoked-dome', color: [0.1, 0.12, 0.14, 0.55], metallic: 0.1, roughness: 0.1, blend: true } as Material,
  lensGlass: { name: 'lens', color: [0.05, 0.08, 0.12, 1], metallic: 0.3, roughness: 0.08 } as Material,
  signalRed: { name: 'signal-red', color: [0.78, 0.06, 0.06, 1], metallic: 0.1, roughness: 0.4 } as Material,
  paper: { name: 'paper', color: [0.85, 0.83, 0.78, 1], metallic: 0, roughness: 0.9 } as Material,
  label: { name: 'label', color: [0.2, 0.45, 0.65, 1], metallic: 0, roughness: 0.7 } as Material,
  tileIvory: { name: 'tile-ivory', color: [0.91, 0.88, 0.82, 1], metallic: 0, roughness: 0.15 } as Material,
  tileEdge: { name: 'tile-edge', color: [0.75, 0.72, 0.66, 1], metallic: 0, roughness: 0.6 } as Material,
  glassPane: { name: 'glass-pane', color: [0.72, 0.85, 0.9, 0.32], metallic: 0, roughness: 0.05, blend: true, doubleSided: true } as Material,
  glassEdge: { name: 'glass-edge', color: [0.55, 0.75, 0.7, 0.85], metallic: 0, roughness: 0.2, blend: true } as Material,
  solarCell: { name: 'solar-cell', color: [0.05, 0.12, 0.25, 1], metallic: 0.25, roughness: 0.25 } as Material,
  solarGrid: { name: 'solar-grid', color: [0.75, 0.78, 0.82, 1], metallic: 0.6, roughness: 0.4 } as Material,
  tin: { name: 'tin', color: [0.55, 0.57, 0.6, 1], metallic: 0.7, roughness: 0.45 } as Material,
  tinLabel: { name: 'tin-label', color: [0.92, 0.9, 0.85, 1], metallic: 0, roughness: 0.7 } as Material,
  tripod: { name: 'tripod', color: [0.85, 0.65, 0.2, 1], metallic: 0.1, roughness: 0.6 } as Material,
  instrument: { name: 'instrument', color: [0.88, 0.86, 0.2, 1], metallic: 0.1, roughness: 0.5 } as Material,
  instrumentDark: { name: 'instrument-dark', color: [0.12, 0.13, 0.15, 1], metallic: 0.2, roughness: 0.5 } as Material,
  rubber: { name: 'rubber', color: [0.12, 0.12, 0.12, 1], metallic: 0, roughness: 0.9 } as Material,
  brass: { name: 'brass', color: [0.8, 0.65, 0.3, 1], metallic: 0.9, roughness: 0.3 } as Material,
  bracketSteel: { name: 'bracket-steel', color: [0.32, 0.34, 0.36, 1], metallic: 0.85, roughness: 0.35 } as Material,
  solarRackSteel: { name: 'solar-rack', color: [0.72, 0.74, 0.76, 1], metallic: 0.8, roughness: 0.4 } as Material,
  tripodLeg: { name: 'tripod-leg', color: [0.88, 0.88, 0.9, 1], metallic: 0.85, roughness: 0.3 } as Material,
  tripodShoe: { name: 'tripod-shoe', color: [0.12, 0.12, 0.14, 1], metallic: 0.6, roughness: 0.5 } as Material,
  groutJoint: { name: 'grout-joint', color: [0.75, 0.74, 0.7, 1], metallic: 0, roughness: 0.95 } as Material,
};
