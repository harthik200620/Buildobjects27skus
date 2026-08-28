/**
 * The drive profile — what makes it feel like a lift rather than a slider.
 *
 * An easing curve moves like a UI transition, because that is what it is. A lift is a machine
 * under a torque limit with a passenger inside, and passengers are why lift control is a strict
 * problem: VELOCITY is what you see, ACCELERATION is what you feel, and JERK — the rate
 * acceleration changes — is what makes a lift feel cheap. Step the acceleration on and a passenger
 * lurches; every real controller ramps it.
 *
 * So this is specified where a lift is specified, as a VELOCITY curve jerk-limited at both ends,
 * with position as its integral rather than the other way round.
 *
 *   ramp up    smoothstep 0 -> 1 over `UP`. Smoothstep's derivative is zero at both ends, so
 *              acceleration starts and stops at zero — that IS the jerk limit.
 *   cruise     flat, at line speed.
 *   ramp down  smoothstep 1 -> 0 over `DOWN`, two and a half times `UP`. Quick away, long glide
 *              in: landing is the part a passenger watches, and the part a cheap lift gets wrong
 *              by braking as hard as it accelerated.
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
