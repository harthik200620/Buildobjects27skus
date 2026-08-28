'use client';

import { fitModelToDims, type PlacementRule, type ProductDims } from '@buildobjects/ar-engine';
import type { Object3D, Quaternion, Vector3 } from 'three';

/**
 * Model normalisation and surface orientation shared by the WebXR tier (ArLive) and the live
 * camera tier (SceneRenderer). `THREE` is passed in so this module never imports three.js
 * statically (every tier loads it on demand).
 *
 * After `normalizeModel` the model sits in its holder such that the rule's anchor face touches
 * the holder origin: bottom items stand on y = 0, hanging items hang from y = 0 (cap up), wall
 * items have their back on z = 0 and extend toward +Z, centred on x / y. `orientForSurface`
 * then turns the holder so that +Y / +Z meet the surface normal.
 */
export type ThreeNS = typeof import('three');

export interface NormalizedModel {
  /** Bounding-box size in metres after normalisation (w = x, h = y, d = z). */
  size: { x: number; y: number; z: number };
  /** Uniform scale applied to match the SKU's stated dimensions, 1 when the GLB was already true to size. */
  scale: number;
  /** Set when the GLB's proportions disagreed with the stated dims by more than the tolerance. */
  note: string | null;
}

/**
 * Centre and rest the model on the holder origin according to the rule's anchor face, after
 * squaring the mesh up with the product's stated dimensions.
 *
 * The squaring-up is `fitModelToDims` in the engine, and it replaces a single line that rescaled
 * by HEIGHT alone: `scale = dims.h_mm / meshY`. The meshes are at true scale, so that line was
 * usually a no-op — but where the generator had left the long axis somewhere other than Y it drew a
 * CCTV camera lying on its side, an extinguisher with its width and depth swapped so it faced
 * sideways off the wall, and an epoxy tin four times too wide. See fit-model.ts for the measured
 * before-and-after, and for why the fit is a rank-ordered axis rotation plus a uniform scale.
 */
export function normalizeModel(THREE: ThreeNS, model: Object3D, rule: PlacementRule, dims?: ProductDims | null): NormalizedModel {
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);

  let scale = 1,
    note: string | null = null;
  if (dims && (dims.w_mm > 0 || dims.h_mm > 0 || dims.d_mm > 0) && size.x > 1e-6 && size.y > 1e-6 && size.z > 1e-6) {
    const fit = fitModelToDims({ x: size.x, y: size.y, z: size.z }, dims);
    scale = fit.scale;
    note = fit.note;
    const r = fit.rotation;
    /* Row-major Mat3 into a THREE basis. `setFromRotationMatrix` needs a pure rotation, which
       `fitModelToDims` guarantees: its result is always one of the six axis-aligned rotations. */
    const basis = new THREE.Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
    model.quaternion.setFromRotationMatrix(basis);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    box.getSize(size);
  }

  const cx = (box.min.x + box.max.x) / 2,
    cy = (box.min.y + box.max.y) / 2,
    cz = (box.min.z + box.max.z) / 2;
  if (rule.orientation === 'hanging') {
    /* Cap up, dome down: flip about Z, then hang the rotated top from the holder origin. Composed
       onto the fitted rotation rather than assigned over it — assigning `rotation.z` discarded the
       axis alignment above and put the mesh back on whatever axis the generator had left it on. */
    model.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(model);
    model.position.set(-(b2.min.x + b2.max.x) / 2, -b2.max.y, -(b2.min.z + b2.max.z) / 2);
  } else if (rule.anchor === 'back') {
    model.position.set(-cx, -cy, -box.min.z);
  } else if (rule.anchor === 'top') {
    model.position.set(-cx, -box.max.y, -cz);
  } else if (rule.anchor === 'center') {
    model.position.set(-cx, -cy, -cz);
  } else {
    model.position.set(-cx, -box.min.y, -cz);
  }
  model.updateMatrixWorld(true);
  const final = new THREE.Box3().setFromObject(model);
  const fs = new THREE.Vector3();
  final.getSize(fs);
  return { size: { x: fs.x, y: fs.y, z: fs.z }, scale, note };
}

/**
 * The holder quaternion for a surface with unit normal `n` (pointing toward the camera / away
 * from the surface). Horizontal surfaces keep the model upright (normal ≈ +Y). A ceiling
 * (normal −Y) keeps hanging items as normalised (they already hang from the origin) and turns
 * flush items so their back meets it. Walls map the model's +Z (out of the back) onto the
 * normal, which keeps Y up for upright wall items such as an extinguisher.
 */
export function orientForSurface(THREE: ThreeNS, n: Vector3, rule: PlacementRule): Quaternion {
  const q = new THREE.Quaternion();
  const normal = n.clone().normalize();
  // Floor, ground, table, roof, ceiling: normalizeModel has already put the model where the
  // surface wants it — a bulb hangs from its origin with the cap up — so the holder does not turn.
  if (Math.abs(normal.y) >= 0.5) return q;
  // Wall and window. A hanging item points its -Y along the normal; everything else lays the
  // model's +Z (out of its back) along it, which is what keeps an extinguisher upright.
  const hangs = rule.category === 'bulbs' || rule.orientation === 'hanging';
  return q.setFromUnitVectors(new THREE.Vector3(0, hangs ? -1 : 0, hangs ? 0 : 1), normal);
}
