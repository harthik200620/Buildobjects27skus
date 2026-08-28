import type { ProductDims } from '../types';
import type { Mat3 } from './pose';

/**
 * Fit a generated mesh to the product it is supposed to be.
 *
 * The meshes are at true scale — `measure` confirms all twenty-one, once node transforms are
 * applied — but they are not consistently ORIENTED, and several disagree with their own stated
 * proportions. Resizing by height alone (`scale = h_mm / meshY`) reads one arbitrary axis as the
 * product's height. What shipped:
 *
 *   CCT-CPP-USC-TA24L2C-L   stated  70 x  70 x 163   drawn 154 x  70 x  70   on its side
 *   FIR-SAF-ABC-SP-6KG      stated 160 x 505 x 205   drawn 194 x 505 x 123   facing sideways off
 *                                                                            the wall
 *   EPX-FOS-CONBEXTRAEP10   stated 175 x 160 x 110   drawn 729 x 160 x  83   four times too wide
 *
 * The stated dimensions are the truth about the product; the mesh is a picture of it. So line the
 * axes up by RANK — longest to longest — and scale uniformly so the longest extent matches. A mesh
 * that already agrees comes through at scale 1.000, which seventeen of twenty-one do.
 *
 * Rank order rather than a fitted transform, because the only rotations allowed are the six that
 * map axes onto axes; anything else shears, and a sheared cement bag is worse than a badly
 * proportioned one. Uniform rather than per-axis for the same reason: per-axis would match all
 * three numbers and stretch any mesh whose proportions disagree, and seven of them do. Where a
 * secondary axis still differs by more than a fifth, `note` says so — that is the mesh disagreeing
 * with the catalogue, which is a content problem rather than a maths one.
 */

export interface MeshExtent {
  x: number;
  y: number;
  z: number;
}

export interface ModelFit {
  /**
   * Mesh-local to product-local rotation, row-major. Always a signed permutation with determinant
   * +1 — one of the six axis-aligned rotations, never a shear and never a mirror.
   */
  rotation: Mat3;
  /** Uniform scale applied after the rotation. */
  scale: number;
  /** Bounding size in metres after both, in product axes (x = width, y = height, z = depth). */
  size: MeshExtent;
  /** How far each product axis ends up from its stated dimension, as a ratio. 1 is exact. */
  ratio: MeshExtent;
  /** Set when the mesh's proportions cannot carry the stated dimensions. */
  note: string | null;
}

/** Past this disagreement on a secondary axis, the mesh is not really a picture of this product. */
const PROPORTION_TOLERANCE = 0.2;

const AXES = ['x', 'y', 'z'] as const;
type AxisKey = (typeof AXES)[number];

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function fitModelToDims(extent: MeshExtent, dims: ProductDims): ModelFit {
  const want: Record<AxisKey, number> = { x: dims.w_mm / 1000, y: dims.h_mm / 1000, z: dims.d_mm / 1000 };
  const have: Record<AxisKey, number> = { x: extent.x, y: extent.y, z: extent.z };

  const degenerate = AXES.some((a) => !(have[a] > 1e-9)) || AXES.every((a) => !(want[a] > 0));
  if (degenerate) {
    return { rotation: IDENTITY, scale: 1, size: { ...have }, ratio: { x: 1, y: 1, z: 1 }, note: 'Mesh has no measurable extent — left as it is' };
  }

  /*
   * Rank both by size. Ties keep x, y, z order on both sides, so a mesh that already agrees with
   * its product — a cube, or the one bulb that is true to size — comes out of this untouched.
   */
  const meshRank = [...AXES].sort((a, b) => have[b] - have[a] || AXES.indexOf(a) - AXES.indexOf(b));
  const wantRank = [...AXES].sort((a, b) => want[b] - want[a] || AXES.indexOf(a) - AXES.indexOf(b));

  /* Row i of the rotation is the product axis; the 1 sits in the mesh axis that feeds it. */
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const from = AXES.indexOf(meshRank[i]);
    const to = AXES.indexOf(wantRank[i]);
    m[to * 3 + from] = 1;
  }
  /* An odd permutation is a mirror image: it would turn the lettering on a cement bag backwards.
     Negating one column makes it a rotation again while keeping every axis on its assigned axis. */
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (det < 0) for (let r = 0; r < 3; r++) m[r * 3] = -m[r * 3];
  const rotation = m as unknown as Mat3;

  const rotated: Record<AxisKey, number> = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 3; i++) rotated[wantRank[i]] = have[meshRank[i]];

  /* Uniform, pinned to the largest stated dimension: the size a person judges is the overall one. */
  const scale = want[wantRank[0]] / rotated[wantRank[0]];
  const size: MeshExtent = { x: rotated.x * scale, y: rotated.y * scale, z: rotated.z * scale };
  const ratio: MeshExtent = {
    x: want.x > 0 ? size.x / want.x : 1,
    y: want.y > 0 ? size.y / want.y : 1,
    z: want.z > 0 ? size.z / want.z : 1,
  };

  const off = AXES.filter((a) => want[a] > 0 && Math.abs(ratio[a] - 1) > PROPORTION_TOLERANCE);
  const note = off.length
    ? `Mesh proportions differ from the stated size on ${off.join('/')} (${off.map((a) => `${a}: ${Math.round(ratio[a] * 100)}%`).join(', ')}) — scaled uniformly to the ${wantRank[0]} extent`
    : null;

  return { rotation, scale, size, ratio, note };
}
