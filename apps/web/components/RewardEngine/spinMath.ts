import { type RewardTier, ROOM_WAYPOINTS, type RoomWaypoint } from './types';

export interface TokenTarget {
  room: RoomWaypoint;
  roomIndex: number;
  targetStep: number;
  overshootStep: number;
  durationMs: number;
}

/**
 * Smoothly interpolates the physical (x, y) coordinates of the BO Engine token along the 6-room circuit
 */
export function getTokenPosition(step: number): { x: number; y: number } {
  const normalized = ((step % 6) + 6) % 6;
  const idx = Math.floor(normalized);
  const nextIdx = (idx + 1) % 6;
  const frac = normalized - idx;

  // Smooth S-curve interpolation between waypoints
  const smoothT = (1 - Math.cos(frac * Math.PI)) / 2;

  const current = ROOM_WAYPOINTS[idx];
  const next = ROOM_WAYPOINTS[nextIdx];

  const x = current.xPct + (next.xPct - current.xPct) * smoothT;
  const y = current.yPct + (next.yPct - current.yPct) * smoothT;

  return { x, y };
}

/**
 * Calculates deterministic target room, full lap count, and overshoot for the traveling token
 */
export function calculateTokenTarget(targetTier?: RewardTier, currentStep = 0): TokenTarget {
  let roomIndex = -1;
  if (targetTier !== undefined) {
    roomIndex = ROOM_WAYPOINTS.findIndex((r) => r.value === targetTier);
  }
  if (roomIndex === -1) {
    const rand = Math.random();
    if (rand < 0.25)
      roomIndex = 1; // 20 BO Coins (Office)
    else if (rand < 0.5)
      roomIndex = 2; // 40 BO Coins (Living)
    else if (rand < 0.72)
      roomIndex = 4; // 60 BO Coins (Kitchen)
    else if (rand < 0.88)
      roomIndex = 5; // 80 BO Coins (Library)
    else if (rand < 0.96)
      roomIndex = 0; // 100 BO Coins (Master Bedroom)
    else roomIndex = 3; // 0 BO Coins (Entrance)
  }

  const room = ROOM_WAYPOINTS[roomIndex];
  const fullLaps = 4 + Math.floor(Math.random() * 2); // 4 to 5 full laps
  const totalLapsSteps = fullLaps * 6;

  const currentNormalized = ((currentStep % 6) + 6) % 6;
  let delta = roomIndex - currentNormalized;
  if (delta < 0) delta += 6;

  const targetStep = currentStep + totalLapsSteps + delta;
  const overshootStep = targetStep + 0.16; // Slight physical overshoot past room center
  const durationMs = 4500 + Math.floor(Math.random() * 500);

  return {
    room,
    roomIndex,
    targetStep,
    overshootStep,
    durationMs,
  };
}

/**
 * Heavy mass kinetic curve for physical token:
 * Starts slow with inertia -> Accelerates -> High-speed laps -> Progressive exponential deceleration
 */
export function tokenKineticEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const p = 1 - t;
  return 1 - p * p * p * p * p;
}

/**
 * Determine which room the token is currently inside or closest to
 */
export function getClosestRoomIndex(step: number): number {
  const norm = ((step % 6) + 6) % 6;
  return Math.round(norm) % 6;
}
