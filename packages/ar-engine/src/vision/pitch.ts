import { mat3FromQuat, type Quat } from '../live/pose';

/**
 * The camera's pitch in degrees, from the device's orientation quaternion.
 *
 * Negative looks down, positive looks up, zero is level — the convention `pitchFromHorizon` in
 * live/pose.ts already uses, so the two agree and `horizonFromPitch` inverts one into the other.
 *
 * Taken from the rotation matrix rather than from Euler angles directly: the device quaternion is
 * built from alpha/beta/gamma in a YXZ order, and re-extracting Euler angles from it re-introduces
 * the gimbal case at ±90° — which is exactly where someone points a phone when they are looking at
 * a floor or a ceiling, i.e. the two cases this whole module exists to tell apart.
 *
 * The camera looks along −Z in its own frame. Rotating that into the world and reading its
 * elevation against the horizontal plane gives the pitch with no singularity anywhere in range.
 */
export function pitchFromQuat(q: Quat): number {
  const m = mat3FromQuat(q);
  // World-space direction of the camera's viewing axis (−Z in camera space).
  const fx = -m[2];
  const fy = -m[5];
  const fz = -m[8];
  const horizontal = Math.hypot(fx, fz);
  return (Math.atan2(fy, horizontal) * 180) / Math.PI;
}
