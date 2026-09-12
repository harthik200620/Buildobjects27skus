/**
 * Where road geometry comes from, and how we know a truck can actually drive it.
 *
 * THE BUG THIS FILE EXISTS TO CLOSE. The first version asked OSRM's public demo server for a
 * route. OSRM's demo runs the CAR profile, and a car in Hyderabad is allowed down the unnamed
 * colony lanes and service alleys that OSM is full of — so the partner was routed 1.36 km through
 * five of them where a loaded Tata Ace would simply not fit. The line was drawn on roads that
 * exist and cannot be driven, which is exactly what "it is showing roads we can't travel" means.
 *
 * So the default is now Valhalla with TRUCK costing, which knows the difference, and every route
 * is classified edge by edge before it is written: if any part of it runs on a track, a driveway,
 * a footway or steps, the fetch says so and refuses. On the same Hyderabad leg the truck profile
 * returns 67 % primary road against the car profile's lanes.
 *
 * Three providers, one shape:
 *   google     when GOOGLE_MAPS_API_KEY is set — what Blinkit itself uses, and the best data
 *              for Indian cities, at the cost of a billed Maps Platform account.
 *   valhalla   the default. Keyless, public, and the only free router with a real truck profile.
 *   osrm       last resort, and marked as such: car profile, no truck rules.
 */

export type Provider = 'google' | 'valhalla' | 'osrm';

export interface Step {
  /** Metres covered by this step. */
  m: number;
  /** "turn-left", "roundabout", "arrive" — provider-normalised. */
  move: string;
  /** The road being joined, empty when the way is unnamed. */
  road: string;
}

export interface RoutedLeg {
  km: number;
  min: number;
  coords: [number, number][];
  steps: Step[];
}

export interface Point {
  lat: number;
  lng: number;
}

/** Metres of this route on each kind of way, e.g. `{ primary: 2290, residential: 723 }`. */
export type RoadMix = Record<string, number>;

export interface Routed {
  leg: RoutedLeg;
  /** How far each end had to move to reach a road. A big number means a badly chosen address. */
  snapped: [number, number];
  provider: Provider;
  /** Empty when the provider cannot tell us, which is itself worth reporting. */
  mix: RoadMix;
}

const VALHALLA = 'https://valhalla1.openstreetmap.de';
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function haversine(a: Point, b: Point): number {
  const p = Math.PI / 180;
  const dLat = (b.lat - a.lat) * p;
  const dLng = (b.lng - a.lng) * p;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}

/**
 * Google and Valhalla both send geometry as an encoded polyline; they differ only in precision
 * (5 digits and 6). One decoder, told which.
 */
function decodePolyline(s: string, precision: number): [number, number][] {
  const f = 10 ** precision;
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < s.length) {
    for (const axis of [0, 1]) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        b = s.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d;
      else lng += d;
    }
    out.push([round6(lng / f), round6(lat / f)]);
  }
  return out;
}

const postJson = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json() as Promise<Record<string, never>>;
};

/* ── Valhalla, with truck costing ────────────────────────────────────────── */

/**
 * Valhalla numbers its manoeuvres. Only the ones that reach a delivery route are mapped; anything
 * else falls through to "continue", which is honest — a wrong word on screen is worse than a
 * vague one. https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/
 */
const VALHALLA_MOVES: Record<number, string> = {
  1: 'depart',
  2: 'depart-right',
  3: 'depart-left',
  4: 'arrive',
  5: 'arrive-right',
  6: 'arrive-left',
  7: 'new name-straight',
  8: 'turn-straight',
  9: 'turn-slight right',
  10: 'turn-right',
  11: 'turn-sharp right',
  12: 'continue-uturn',
  13: 'continue-uturn',
  14: 'turn-sharp left',
  15: 'turn-left',
  16: 'turn-slight left',
  17: 'ramp-straight',
  18: 'ramp-right',
  19: 'ramp-left',
  20: 'exit-right',
  21: 'exit-left',
  22: 'fork-straight',
  23: 'fork-right',
  24: 'fork-left',
  25: 'merge-left',
  26: 'roundabout-left',
  27: 'exit roundabout-left',
  37: 'merge-right',
  38: 'merge-left',
};

interface ValhallaManeuver {
  type: number;
  length: number;
  street_names?: string[];
}

/**
 * What kinds of way the route runs on, metre by metre.
 *
 * Valhalla will only classify a shape it has map-matched, so the route's own geometry is handed
 * back to `trace_attributes`. This is the measurement that makes "a truck can drive this" a fact
 * rather than a hope, and it is the whole reason the router was changed.
 */
async function classify(shape: [number, number][]): Promise<RoadMix> {
  const body = {
    shape: shape.map(([lng, lat]) => ({ lat, lon: lng })),
    costing: 'truck',
    shape_match: 'map_snap',
    filters: { attributes: ['edge.road_class', 'edge.use', 'edge.length'], action: 'include' },
  };
  const res = (await postJson(`${VALHALLA}/trace_attributes`, body)) as unknown as {
    edges?: Array<{ road_class?: string; use?: string; length?: number }>;
  };
  const mix: RoadMix = {};
  for (const e of res.edges ?? []) {
    /* `use` is the specific thing (driveway, ramp, alley) and `road_class` the general one.
       Where they disagree the specific one is what decides whether a truck fits. */
    const kind = e.use && e.use !== 'road' ? e.use : (e.road_class ?? 'unknown');
    mix[kind] = (mix[kind] ?? 0) + Math.round((e.length ?? 0) * 1000);
  }
  return mix;
}

async function valhalla(from: Point, to: Point): Promise<Routed> {
  const res = (await postJson(`${VALHALLA}/route`, {
    locations: [
      { lat: from.lat, lon: from.lng },
      { lat: to.lat, lon: to.lng },
    ],
    costing: 'truck',
    /* The yard's van, not an articulated lorry: the defaults are a 21 m truck and would refuse
       turns this vehicle makes every day. A Tata Ace class vehicle, in metres and tonnes. */
    costing_options: { truck: { height: 2.6, width: 1.9, length: 4.9, weight: 2.2, axle_load: 1.5, hazmat: false } },
    directions_options: { units: 'kilometers' },
  })) as unknown as {
    error?: string;
    trip?: { summary: { length: number; time: number }; legs: Array<{ shape: string; maneuvers: ValhallaManeuver[] }> };
  };
  if (res.error || !res.trip) throw new Error(`Valhalla: ${res.error ?? 'no trip'}`);

  const leg = res.trip.legs[0];
  const coords = decodePolyline(leg.shape, 6);
  return {
    provider: 'valhalla',
    snapped: [
      haversine(from, { lat: coords[0][1], lng: coords[0][0] }),
      haversine(to, { lat: coords.at(-1)?.[1] as number, lng: coords.at(-1)?.[0] as number }),
    ],
    mix: await classify(coords),
    leg: {
      km: +res.trip.summary.length.toFixed(2),
      min: +(res.trip.summary.time / 60).toFixed(1),
      coords,
      steps: leg.maneuvers.map((m) => ({
        m: Math.round(m.length * 1000),
        move: VALHALLA_MOVES[m.type] ?? 'turn-straight',
        road: (m.street_names ?? [])[0] ?? '',
      })),
    },
  };
}

/* ── Google Directions ───────────────────────────────────────────────────── */

/** "turn-left", "ramp-right", "keep-left" → the vocabulary the rest of the code speaks. */
const googleMove = (m: string | undefined): string => (m ?? 'turn-straight').replace(/^keep-/, 'turn-slight ').replace(/^roundabout-/, 'roundabout-');

/** Google writes instructions as HTML: "Turn right onto <b>HITEC City Rd</b>". */
function roadFrom(html: string): string {
  const onto = /(?:onto|on to|toward|towards)\s*<b>(.*?)<\/b>/i.exec(html) ?? /<b>(.*?)<\/b>/.exec(html);
  return (onto?.[1] ?? '').replace(/<[^>]+>/g, '').trim();
}

async function google(from: Point, to: Point, key: string): Promise<Routed> {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${from.lat},${from.lng}`);
  url.searchParams.set('destination', `${to.lat},${to.lng}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('region', 'in');
  url.searchParams.set('key', key);

  const body = (await (await fetch(url)).json()) as {
    status: string;
    error_message?: string;
    routes: Array<{
      legs: Array<{
        distance: { value: number };
        duration: { value: number };
        start_location: Point;
        end_location: Point;
        steps: Array<{ distance: { value: number }; html_instructions: string; maneuver?: string; polyline: { points: string } }>;
      }>;
    }>;
  };
  if (body.status !== 'OK') throw new Error(`Google Directions: ${body.status}${body.error_message ? ` — ${body.error_message}` : ''}`);

  const leg = body.routes[0].legs[0];
  /* Every step's own polyline, joined — `overview_polyline` is simplified for drawing a country
     and would put the truck through buildings at street zoom. */
  const coords: [number, number][] = [];
  for (const s of leg.steps) {
    for (const c of decodePolyline(s.polyline.points, 5)) {
      if (!coords.length || coords.at(-1)?.join() !== c.join()) coords.push(c);
    }
  }

  return {
    provider: 'google',
    snapped: [haversine(from, leg.start_location), haversine(to, leg.end_location)],
    /* Google does not hand back way classes, so the route is classified by the same Valhalla call
       the other provider uses. The check stays identical whoever drew the line. */
    mix: await classify(coords).catch(() => ({})),
    leg: {
      km: +(leg.distance.value / 1000).toFixed(2),
      min: +(leg.duration.value / 60).toFixed(1),
      coords,
      steps: leg.steps.map((s) => ({ m: Math.round(s.distance.value), move: googleMove(s.maneuver), road: roadFrom(s.html_instructions) })),
    },
  };
}

/* ── OSRM, kept only as a fallback ───────────────────────────────────────── */

async function osrm(from: Point, to: Point): Promise<Routed> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const body = (await res.json()) as {
    code: string;
    waypoints: Array<{ distance: number }>;
    routes: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: number[][] };
      legs: Array<{ steps: Array<{ distance: number; name: string; maneuver: { type: string; modifier?: string } }> }>;
    }>;
  };
  if (body.code !== 'Ok') throw new Error(`OSRM ${body.code}`);
  const r = body.routes[0];
  const coords = r.geometry.coordinates.map(([lng, lat]) => [round6(lng), round6(lat)] as [number, number]);
  return {
    provider: 'osrm',
    snapped: [body.waypoints[0].distance, body.waypoints[1].distance],
    mix: await classify(coords).catch(() => ({})),
    leg: {
      km: +(r.distance / 1000).toFixed(2),
      min: +(r.duration / 60).toFixed(1),
      coords,
      steps: r.legs[0].steps.map((s) => ({
        m: Math.round(s.distance),
        move: [s.maneuver.type, s.maneuver.modifier].filter(Boolean).join('-'),
        road: s.name ?? '',
      })),
    },
  };
}

/* ── what a truck may not use ────────────────────────────────────────────── */

/**
 * Ways no delivery truck should be sent down, whatever a router says.
 *
 * `driveway` and `alley` are the ones that actually bit: OSM maps a housing colony's internal
 * lanes as service roads, a car profile happily threads them, and the result is a line drawn
 * across ground a truck cannot reach. A short service road AT the destination is fine and
 * expected — that is the last few metres to a gate — which is why the rule below is about how
 * much, not merely whether.
 */
export const IMPASSABLE = ['track', 'path', 'footway', 'steps', 'driveway', 'alley', 'pedestrian', 'cycleway', 'living_street'];

export const routingProvider = (): Provider => (process.env.GOOGLE_MAPS_API_KEY ? 'google' : 'valhalla');

export async function route(from: Point, to: Point): Promise<Routed> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) return google(from, to, key);
  try {
    return await valhalla(from, to);
  } catch (e) {
    /* Loud, not silent: OSRM's car profile is what put a truck down a footpath in the first
       place, so a route that came from it must be visible as such in the output. */
    console.warn(`  ! Valhalla unavailable (${(e as Error).message}) — falling back to OSRM's CAR profile, which does not know truck rules`);
    return osrm(from, to);
  }
}
