/** Shortest signed turn from a to b, in degrees: +170 rather than −190. */
export const shortestTurn = (a: number, b: number): number => ((b - a + 540) % 360) - 180;

/** How quickly the truck leans into a new bearing. Higher follows the road, lower glides. */
const RESPONSE = 5;
/** Degrees per second the truck can physically swing. A loaded Tata Ace is not a compass needle. */
const MAX_YAW = 110;

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));

/**
 * The truck's heading, one frame on, taken along the shortest arc.
 *
 * WHY IT IS FILTERED AT ALL. The bearing is read off the road geometry, and road geometry is a
 * string of straight segments — at a junction the true bearing changes by fifty degrees between
 * one point and the next. Turned raw, the sprite snaps round like a compass needle.
 *
 * WHY IT TAKES dt. Written as `h += turn * 0.12` the filter closes twelve per cent of the gap per
 * FRAME, so the same drive turns at a different rate on a 30 Hz display than on a 120 Hz one —
 * languid on one machine, twitchy on another. Working in seconds makes the motion a property of
 * the truck rather than of the monitor it is being watched on.
 *
 * WHY THERE IS ALSO A HARD CAP. Easing alone is proportional: the sharper the corner, the faster
 * it whips round, which is backwards — a vehicle turns SLOWEST when the turn is tightest. On a
 * 20 Hz display an exponential term alone swung the truck 36° inside one frame at a junction.
 * MAX_YAW is the yaw rate of the vehicle itself, so a hairpin takes the second or so it should.
 */
export function smoothHeading(current: number, target: number, dtMs: number): number {
  if (Number.isNaN(current)) return target;
  const dt = dtMs / 1000;
  const eased = shortestTurn(current, target) * (1 - Math.exp(-RESPONSE * dt));
  return (current + clamp(eased, MAX_YAW * dt) + 360) % 360;
}
