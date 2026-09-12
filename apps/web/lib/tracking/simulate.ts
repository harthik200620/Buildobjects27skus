import along from '@turf/along';
import bearing from '@turf/bearing';
import { lineString } from '@turf/helpers';
import length from '@turf/length';
import lineSliceAlong from '@turf/line-slice-along';
import { type City, cityFor } from './cities';
import routes from './routes.json';
import type { Directions, Leg, Order, Snapshot, Step } from './types';

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

/**
 * The slope of that curve — speed as a multiple of the leg's average.
 *
 * It is the derivative rather than a difference between two positions, because a speed read off
 * successive frames is noise divided by noise: at sixty frames a second the truck moves a few
 * centimetres and the answer swings wildly. The curve is known, so its gradient is known.
 */
export function trapezoidSpeed(t: number, ramp = 0.08): number {
  const x = Math.min(1, Math.max(0, t));
  const v = 1 / (1 - ramp);
  if (x < ramp) return (v * x) / ramp;
  if (x > 1 - ramp) return (v * (1 - x)) / ramp;
  return v;
}

export const simMinutes = (o: Order, now = Date.now()): number => (o.clock.simMs + (now - o.clock.wallMs) * o.clock.speed) / 60_000;

const latLng = ([lng, lat]: number[]) => ({ lat, lng });

/** Where the truck is on one road, which way it points, how fast, and what is left ahead. */
function drive(r: Road, t: number, legMinutes: number) {
  const d = trapezoid(t) * r.km;
  const here = along(r.line, d);
  const left = r.km - d;
  /* At the very end there is nothing ahead to look at, so look back instead. */
  const [a, b] = left > LOOK_AHEAD_KM ? [here, along(r.line, d + LOOK_AHEAD_KM)] : [along(r.line, Math.max(0, r.km - LOOK_AHEAD_KM)), along(r.line, r.km)];
  const remaining = left > 0.001 ? (lineSliceAlong(r.line, d, r.km).geometry.coordinates as [number, number][]) : [];
  const kmh = legMinutes > 0 ? (r.km / (legMinutes / 60)) * trapezoidSpeed(t) : 0;
  return { at: latLng(here.geometry.coordinates), heading: (bearing(a, b) + 360) % 360, left, remaining, km: d, kmh: Math.round(kmh) };
}

/** "HITEC City–Kondapur Main Road" and "Hitec City - Kondapur Main Road" are the same road. */
const sameRoad = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Does this step ask the driver to do anything, or is it the road carrying on under another name? */
const isManoeuvre = (step: Step, from: string) => /left|right|uturn|roundabout|ramp|merge|fork|arrive/.test(step.move) || !sameRoad(step.road, from);

/**
 * Which manoeuvre the driver is in the middle of, `km` into the leg, and the next one that asks
 * anything of them.
 *
 * The router's steps run end to end along the leg, so walking their lengths finds the current one
 * and what is left of it. An unnamed way stays unnamed rather than being handed a road name it
 * does not have — "carry straight on" is honest where "carry straight on onto Main Road" is not.
 *
 * NON-MANOEUVRES ARE SKIPPED AND THEIR DISTANCE ROLLED FORWARD. OSRM emits a step every time the
 * carriageway changes name, and OSM spells this corridor both "HITEC City–Kondapur Main Road" and
 * "Hitec City - Kondapur Main Road", so the banner read "carry straight on onto HITEC City–
 * Kondapur Main Road in 70 m" while sitting on Hitec City - Kondapur Main Road. A driver wants
 * the next thing they have to DO, with the true distance to it — which means adding up the
 * stretches in between rather than announcing each one.
 */
function directionsAt(leg: Leg, km: number): Directions {
  let run = 0;
  for (let i = 0; i < leg.steps.length; i++) {
    const end = run + leg.steps[i].m / 1000;
    if (km >= end && i < leg.steps.length - 1) {
      run = end;
      continue;
    }

    const road = leg.steps[i].road;
    let to = (end - km) * 1000;
    for (let j = i + 1; j < leg.steps.length; j++) {
      if (isManoeuvre(leg.steps[j], road)) {
        const next = { move: leg.steps[j].move, road: sameRoad(leg.steps[j].road, road) ? '' : leg.steps[j].road, inM: Math.max(0, Math.round(to)) };
        return { road, next, stepIndex: i };
      }
      to += leg.steps[j].m;
    }
    return { road, next: null, stepIndex: i };
  }
  return { road: '', next: null, stepIndex: 0 };
}

export function snapshot(p: Plan, min: number): Snapshot {
  const { marks, roads, legs } = p;
  const base = { etaMin: Math.max(0, Math.ceil(marks.delivered - min)), done: Math.min(1, Math.max(0, min / marks.delivered)) };
  /* Everything still to drive, both legs — what the reader means by "how far away is it". */
  const toDoor = (leftOnThisLeg: number, legIndex: 0 | 1) => Math.round((leftOnThisLeg + (legIndex === 0 ? roads[1].km : 0)) * 1000);

  if (min < marks.assigned) {
    const metresLeft = Math.round((roads[0].km + roads[1].km) * 1000);
    return { ...base, phase: 'confirmed', legIndex: 0, at: null, heading: 0, remaining: legs[0].coords, directions: null, metresLeft, kmh: 0 };
  }
  if (min < marks.atYard) {
    const { km, left, ...d } = drive(roads[0], (min - marks.assigned) / (marks.atYard - marks.assigned), marks.atYard - marks.assigned);
    return { ...base, phase: 'assigned', legIndex: 0, ...d, directions: directionsAt(legs[0], km), metresLeft: toDoor(left, 0) };
  }
  if (min < marks.loaded) {
    const { at, heading } = drive(roads[1], 0, 0);
    const rest = { remaining: legs[1].coords, directions: directionsAt(legs[1], 0), metresLeft: toDoor(roads[1].km, 1), kmh: 0 };
    return { ...base, phase: 'at_yard', legIndex: 1, at, heading, ...rest };
  }
  if (min < marks.delivered) {
    const { km, left, ...d } = drive(roads[1], (min - marks.loaded) / (marks.delivered - marks.loaded), marks.delivered - marks.loaded);
    const phase = left < ARRIVING_KM ? 'arriving' : 'on_the_way';
    return { ...base, phase, legIndex: 1, ...d, directions: directionsAt(legs[1], km), metresLeft: toDoor(left, 1) };
  }
  const { at, heading } = drive(roads[1], 1, 0);
  return { phase: 'delivered', legIndex: 1, at, heading, etaMin: 0, done: 1, remaining: [], directions: null, metresLeft: 0, kmh: 0 };
}
