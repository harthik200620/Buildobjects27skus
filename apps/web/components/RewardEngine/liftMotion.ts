/**
 * THE DRIVE PROFILE — what makes it feel like a lift rather than a slider.
 *
 * ── WHY NOT AN EASING FUNCTION ──────────────────────────────────────────────────────────────
 * The first cut used a two-part ease: square up to a third of the way, cubic-out for the rest. It
 * moved, and it moved like a UI transition, because that is what an easing curve is. A lift is a
 * MACHINE under a motor with a torque limit and a passenger inside it, and passengers are the
 * reason lift control is a solved and rather strict problem:
 *
 *   VELOCITY is what you see. Position alone tells you nothing about whether it looks right.
 *   ACCELERATION is what you feel — it is what presses you into the floor.
 *   JERK, the rate acceleration changes, is what makes a lift feel cheap. Step the acceleration
 *   on and a passenger lurches. Every real controller ramps it, and that ramp is the single
 *   difference between "expensive lift" and "fairground ride".
 *
 * So this is specified where a lift is specified: as a VELOCITY curve, jerk-limited at both ends,
 * and position is its integral rather than the other way round.
 *
 *   ramp up      smoothstep 0 → 1 over `UP` of the ride. Smoothstep's derivative is zero at both
 *                ends, so acceleration starts and stops at zero — that IS the jerk limit, and it
 *                is why this shape and not a linear ramp.
 *   cruise       flat, at line speed.
 *   ramp down    smoothstep 1 → 0 over `DOWN`, and DOWN is two and a half times UP. Quick away,
 *                long glide in. Landing is the part a passenger watches, and it is the part a
 *                cheap lift gets wrong by braking as hard as it accelerated.
 *
 * ── AND IT IS A TABLE ───────────────────────────────────────────────────────────────────────
 * The integral is evaluated once per ride into 512 samples and read back by lerp. Integrating on
 * the fly would accumulate error at exactly the moment it shows — a car that arrives a few
 * centimetres past its floor and has to be nudged back is the one artefact this cannot have.
 * A table is exact, allocation-free after setup, and costs two array reads a frame.
 */

/** Fraction of the ride spent getting up to speed. */
const UP = 0.16;
/** Fraction spent slowing down. Deliberately far longer than UP — see above. */
const DOWN = 0.42;
const SAMPLES = 512;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Line speed at `t`, normalised so cruise is 1. This is the shape; everything else follows. */
export function velocityAt(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < UP) return smoothstep(t / UP);
  if (t > 1 - DOWN) return smoothstep((1 - t) / DOWN);
  return 1;
}

export interface DriveProfile {
  /** Distance covered by time `t`, as a fraction of the whole journey. */
  at: (t: number) => number;
  /** Line speed at `t`, 0–1. Drives the motion blur and the cabin's sway. */
  speed: (t: number) => number;
}

export function buildProfile(): DriveProfile {
  const s = new Float32Array(SAMPLES + 1);
  let acc = 0;
  for (let i = 1; i <= SAMPLES; i += 1) {
    /* Trapezoid, which is exact for the linear pieces and within a rounding error on the ramps
       at this resolution. */
    const a = velocityAt((i - 1) / SAMPLES);
    const b = velocityAt(i / SAMPLES);
    acc += (a + b) / 2;
    s[i] = acc;
  }
  const total = s[SAMPLES] || 1;
  for (let i = 0; i <= SAMPLES; i += 1) s[i] /= total;

  return {
    at(t: number) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      const x = t * SAMPLES;
      const i = Math.floor(x);
      return s[i] + (s[i + 1] - s[i]) * (x - i);
    },
    speed: velocityAt,
  };
}

/**
 * How hard the car is accelerating at `t`, signed and normalised to roughly ±1.
 *
 * Taken from the velocity curve by difference rather than differentiated by hand: the curve is
 * the specification, and a hand-derived twin of it is a second thing that has to be kept in step.
 * The cabin's sway and the light's flicker both hang off this, which is what puts the FEEL of the
 * drive on screen — you see the car settle back as it comes up to speed and lean into the stop.
 */
export function accelAt(t: number): number {
  const h = 1 / 64;
  return (velocityAt(Math.min(1, t + h)) - velocityAt(Math.max(0, t - h))) / (2 * h) / (1 / UP);
}
