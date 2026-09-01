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

export interface SackOptions {
  /** Cross-section squareness. 2 = an ellipse, 6 = nearly a box; a filled sack sits around 3.2. */
  squareness?: number;
  /** Material for the printed panel across the top. Omitted = one mesh, body material throughout. */
  panel?: Material;
  /**
   * Material for the print on the UNDERSIDE. A sack is printed both sides, and the model is
   * orbited on the product page even though the AR view only ever rests it on a floor — so the
   * back photo belongs on the mesh, not thrown away because one surface happens to hide it.
   */
  underPanel?: Material;
  /** Fraction of the length and width the panel covers. */
  panelSpan?: [number, number];
  segments?: [number, number];
}

/**
 * A filled bag lying on its side — cement, sand, plaster, anything sold by the sack.
 *
 * A box is not a bag, and on the front of an AR view the difference is the whole thing: a 50 kg
 * sack of cement drawn as `box(w, d, h)` reads as a slab of polystyrene, which is exactly what it
 * looked like. What makes it a bag is that the middle is fat and the two ends are pinched into
 * flat seams, so the silhouette is never a straight line.
 *
 * The surface is a superellipse swept along the length, with two independent pinch profiles:
 * THICKNESS collapses towards the ends (a sealed seam is thin) while WIDTH barely changes (a seam
 * is as wide as the bag). One profile for both gives a torpedo, which is a different object.
 *
 * The bottom is flattened where it meets the floor, because the mass of the contents does that
 * and a sack floating on two round edges reads as inflatable.
 *
 * UVs: u along the length, v around the section, so a printed panel or a bag photo wraps the way
 * a real print does.
 */
export function sack(length: number, thickness: number, width: number, c: V3, mat: Material, opts: SackOptions = {}): MeshData[] {
  const n = opts.squareness ?? 3.2;
  const [nu, nv] = opts.segments ?? [40, 36];
  const [px, pz] = opts.panelSpan ?? [0.62, 0.66];
  const [cx, cy, cz] = c;
  const body = new Builder(mat);
  const panel = opts.panel ? new Builder(opts.panel) : null;
  const under = opts.underPanel ? new Builder(opts.underPanel) : null;

  /** Superellipse radius at angle t for unit half-axes. */
  const se = (t: number): [number, number] => {
    const ct = Math.cos(t),
      st = Math.sin(t);
    const k = 2 / n;
    return [Math.sign(ct) * Math.abs(ct) ** k, Math.sign(st) * Math.abs(st) ** k];
  };
  /* |t| -> 1 at the ends. Thickness dies away fast and stops at a seam of real thickness; width
     only tucks in a little. */
  const fy = (t: number) => Math.max(0.05, (1 - Math.abs(t) ** 8) ** 0.32);
  const fz = (t: number) => 1 - 0.16 * Math.abs(t) ** 4;

  const point = (i: number, j: number): { p: V3; uv: V2 } => {
    const t = (i / nu) * 2 - 1;
    const a = (j / nv) * Math.PI * 2;
    const [ez, ey] = se(a);
    const halfT = (thickness / 2) * fy(t);
    /* Flatten the underside: the floor takes the bottom third out of the section. */
    const yUnit = ey < 0 ? ey * 0.62 : ey;
    return {
      p: [cx + (t * length) / 2, cy + halfT + yUnit * halfT, cz + ez * (width / 2) * fz(t)],
      uv: [i / nu, j / nv],
    };
  };

  /* v = 0.25 is the top of the section (sin a = 1) and v = 0.75 the underside. */
  const near = (j: number, centre: number) => {
    const v = (j % nv) / nv;
    return Math.min(Math.abs(v - centre), 1 - Math.abs(v - centre)) <= pz * 0.25;
  };
  const inPanel = (i: number, j: number) => Math.abs((i / nu) * 2 - 1) <= px && near(j, 0.25);
  const inUnder = (i: number, j: number) => Math.abs((i / nu) * 2 - 1) <= px && near(j, 0.75);

  /* Two vertex tables, because a quad belongs wholly to one mesh or the other and a shared
     table would put panel indices into the body's buffer. */
  const key = (i: number, j: number) => `${i}:${j % nv}`;
  const idx = new Map<string, number>();
  const pIdx = new Map<string, number>();
  const uIdx = new Map<string, number>();
  const vert = (b: Builder, table: Map<string, number>, i: number, j: number): number => {
    const k = key(i, j);
    const hit = table.get(k);
    if (hit !== undefined) return hit;
    const { p, uv } = point(i, j % nv === j ? j : j % nv);
    /* Central-difference normal from the two neighbouring rings and columns. */
    const a = point(Math.min(nu, i + 1), j).p,
      bb = point(Math.max(0, i - 1), j).p;
    const cc = point(i, (j + 1) % nv).p,
      dd = point(i, (j - 1 + nv) % nv).p;
    const nrm = norm(cross(sub(a, bb), sub(cc, dd)));
    const v = b.vertex(p, nrm, uv);
    table.set(k, v);
    return v;
  };

  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const usePanel = panel && inPanel(i, j) && inPanel(i + 1, j) && inPanel(i, j + 1) && inPanel(i + 1, j + 1);
      const useUnder = !usePanel && under && inUnder(i, j) && inUnder(i + 1, j) && inUnder(i, j + 1) && inUnder(i + 1, j + 1);
      const b = usePanel ? panel : useUnder ? under : body;
      const table = usePanel ? pIdx : useUnder ? uIdx : idx;
      const a = vert(b, table, i, j),
        bb = vert(b, table, i + 1, j),
        cc = vert(b, table, i + 1, j + 1),
        dd = vert(b, table, i, j + 1);
      b.face(a, bb, cc);
      b.face(a, cc, dd);
    }

  const out = [body.mesh()];
  if (panel && pIdx.size) out.push(panel.mesh());
  if (under && uIdx.size) out.push(under.mesh());
  return out;
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
  /* Woven polypropylene, the sack every Indian cement brand ships in: near-white, faintly warm,
     and matte enough that the bulge reads as fabric under a key light rather than as plastic.
     NOTE THE VALUES ARE LINEAR. glTF baseColorFactor is linear light, and gltf.ts writes
     `m.color` straight through, so an sRGB-looking 0.9 here would render around 0.96 and blow
     out under the key light — which is what happened to the first panel colour below. 0.72
     linear is about 0.88 sRGB, a white sack that still has shading in it. */
  sackWoven: { name: 'sack-woven', color: [0.72, 0.71, 0.67, 1], metallic: 0, roughness: 0.94 } as Material,
  /* The printed panel across the top of a bag. Deliberately a neutral slate, not a brand colour:
     the catalogue has no photograph of the right bag, so the panel says "this face is printed"
     without saying whose print it is. */
  sackPanel: { name: 'sack-panel', color: [0.075, 0.085, 0.1, 1], metallic: 0, roughness: 0.85 } as Material,
  /* The ring of infra-red LEDs around a camera lens: dark, slightly violet, and glossy, which is
     how the filter glass over them reads with the illuminators off. It is the one detail that
     makes a white blob on a wall legible as a camera. */
  displayGlass: { name: 'display-glass', color: [0.05, 0.07, 0.06, 1], metallic: 0.1, roughness: 0.08 } as Material,
  irWindow: { name: 'ir-window', color: [0.028, 0.026, 0.038, 1], metallic: 0.25, roughness: 0.1 } as Material,
};
