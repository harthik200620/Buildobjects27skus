import along from '@turf/along';
import bearing from '@turf/bearing';
import { lineString } from '@turf/helpers';
import length from '@turf/length';
import lineSliceAlong from '@turf/line-slice-along';
import { type City, cityFor } from './cities';
import routes from './routes.json';
import type { Leg, Order, Snapshot } from './types';

/**
 * The trip as a timeline, and the truck as a function of time.
 *
 * `plan` turns an order into four marks on a clock — partner found, at the yard, loaded, at the
 * door — from real road minutes scaled by the hour's traffic. `snapshot(plan, minutes)` is pure:
 * the same minute always yields the same phase, position and ETA, which is what lets a refresh,
 * a background tab or a speed change resume mid-road instead of restarting. A GPS feed replaces
 * this file; nothing that reads a Snapshot changes.
 */

const FIND_PARTNER_MIN = 0.5;
const LOADING_MIN = 2;
/** Inside this distance the headline changes to "almost at your gate". */
const ARRIVING_KM = 0.4;
/** Heading is taken towards a point this far ahead, so it turns through a bend, not at it. */
const LOOK_AHEAD_KM = 0.02;
const IST_MS = 330 * 60_000;

/** How much slower than free flow the roads run at this hour, in IST. */
export function trafficFactor(city: City, at: number): number {
  const h = new Date(at + IST_MS).getUTCHours();
  if (h >= 22 || h < 6) return city.traffic.night;
  return (h >= 8 && h < 11) || (h >= 17 && h < 21) ? city.traffic.peak : city.traffic.day;
}

interface Road {
  line: ReturnType<typeof lineString>;
  km: number;
}

export interface Plan {
  city: City;
  legs: [Leg, Leg];
  roads: [Road, Road];
  /** Cumulative minutes at which each stretch begins, and the door. */
  marks: { assigned: number; atYard: number; loaded: number; delivered: number };
}

const road = (leg: Leg): Road => {
  const line = lineString(leg.coords);
  return { line, km: length(line) };
};

export function plan(order: Pick<Order, 'regionId' | 'placedAt'>): Plan {
  const city = cityFor(order.regionId);
  const { toYard, toDrop } = (routes as unknown as Record<string, { toYard: Leg; toDrop: Leg }>)[city.id];
  const f = trafficFactor(city, order.placedAt);
  const assigned = FIND_PARTNER_MIN;
  const atYard = assigned + toYard.min * f;
  const loaded = atYard + LOADING_MIN;
  return { city, legs: [toYard, toDrop], roads: [road(toYard), road(toDrop)], marks: { assigned, atYard, loaded, delivered: loaded + toDrop.min * f } };
}

/** What the cart promises — the same sum the tracker then counts down. */
export const promiseMinutes = (regionId: string, at = Date.now()): number => Math.ceil(plan({ regionId, placedAt: at }).marks.delivered);

/**
 * Distance fraction for time fraction t: a trapezoid velocity profile — a soft pull-away, a
 * constant cruise, a soft stop. A loaded truck neither leaps off the mark nor slams to a halt,
 * and the eye reads a marker that does as a glitch.
 */
export function trapezoid(t: number, ramp = 0.08): number {
  const x = Math.min(1, Math.max(0, t));
  const v = 1 / (1 - ramp);
  if (x < ramp) return (v * x * x) / (2 * ramp);
  if (x > 1 - ramp) return 1 - (v * (1 - x) ** 2) / (2 * ramp);
  return v * (x - ramp / 2);
}

export const simMinutes = (o: Order, now = Date.now()): number => (o.clock.simMs + (now - o.clock.wallMs) * o.clock.speed) / 60_000;

const latLng = ([lng, lat]: number[]) => ({ lat, lng });

function drive(r: Road, t: number) {
  const d = trapezoid(t) * r.km;
  const here = along(r.line, d);
  const left = r.km - d;
  /* At the very end there is nothing ahead to look at, so look back instead. */
  const [a, b] = left > LOOK_AHEAD_KM ? [here, along(r.line, d + LOOK_AHEAD_KM)] : [along(r.line, Math.max(0, r.km - LOOK_AHEAD_KM)), along(r.line, r.km)];
  const remaining = left > 0.001 ? (lineSliceAlong(r.line, d, r.km).geometry.coordinates as [number, number][]) : [];
  return { at: latLng(here.geometry.coordinates), heading: (bearing(a, b) + 360) % 360, left, remaining };
}

export function snapshot(p: Plan, min: number): Snapshot {
  const { marks, roads, legs } = p;
  const base = { etaMin: Math.max(0, Math.ceil(marks.delivered - min)), done: Math.min(1, Math.max(0, min / marks.delivered)) };

  if (min < marks.assigned) return { ...base, phase: 'confirmed', legIndex: 0, at: null, heading: 0, remaining: legs[0].coords };
  if (min < marks.atYard) {
    const { left: _, ...d } = drive(roads[0], (min - marks.assigned) / (marks.atYard - marks.assigned));
    return { ...base, phase: 'assigned', legIndex: 0, ...d };
  }
  if (min < marks.loaded) {
    const { at, heading } = drive(roads[1], 0);
    return { ...base, phase: 'at_yard', legIndex: 1, at, heading, remaining: legs[1].coords };
  }
  if (min < marks.delivered) {
    const { left, ...d } = drive(roads[1], (min - marks.loaded) / (marks.delivered - marks.loaded));
    return { ...base, phase: left < ARRIVING_KM ? 'arriving' : 'on_the_way', legIndex: 1, ...d };
  }
  const { at, heading } = drive(roads[1], 1);
  return { phase: 'delivered', legIndex: 1, at, heading, etaMin: 0, done: 1, remaining: [] };
}
