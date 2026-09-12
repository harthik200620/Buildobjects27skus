/**
 * Where road geometry comes from.
 *
 * Two providers behind one shape. Google Directions is used when GOOGLE_MAPS_API_KEY is set,
 * because it is the routing everybody in India measures a delivery app against — it knows which
 * side of a flyover a service road is on, and which turns a vehicle is actually allowed to make.
 * OSRM's public demo server is the keyless fallback so the repo works for anyone who clones it.
 *
 * Both are asked for TURN-BY-TURN as well as geometry. The manoeuvres are what let the page tell
 * the partner where to go instead of only drawing a line, and they are also the cheapest way for
 * a person to check a route is sane: road names you can read beat a polyline you have to trust.
 */

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

export interface Routed {
  leg: RoutedLeg;
  /** How far each end had to move to reach a road. A big number means a badly chosen address. */
  snapped: [number, number];
  provider: 'google' | 'osrm';
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/* ── Google Directions ───────────────────────────────────────────────────── */

/** Google encodes geometry as a polyline string; this is the documented decoder. */
function decodePolyline(s: string): [number, number][] {
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
    out.push([round6(lng / 1e5), round6(lat / 1e5)]);
  }
  return out;
}

/** "turn-left", "ramp-right", "roundabout-left" → the same vocabulary OSRM uses. */
const googleMove = (m: string | undefined): string => (m ?? 'straight').replace(/^keep-/, 'slight-');

async function google(from: Point, to: Point, key: string): Promise<Routed> {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${from.lat},${from.lng}`);
  url.searchParams.set('destination', `${to.lat},${to.lng}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('region', 'in');
  /* The demo is a fixed script, so a route that changes with today's jam would make the recorded
     timings meaningless. Traffic is applied afterwards, per city and per hour, in simulate.ts. */
  url.searchParams.set('departure_time', 'now');
  url.searchParams.set('key', key);

  const res = await fetch(url);
  const body = (await res.json()) as {
    status: string;
    error_message?: string;
    routes: Array<{
      overview_polyline: { points: string };
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
  /* Every step's own polyline, concatenated — the overview_polyline is simplified for drawing at
     country scale and would put the truck through buildings at street zoom. */
  const coords: [number, number][] = [];
  for (const s of leg.steps) for (const c of decodePolyline(s.polyline.points)) if (!coords.length || coords.at(-1)?.join() !== c.join()) coords.push(c);

  return {
    provider: 'google',
    snapped: [haversine(from, leg.start_location), haversine(to, leg.end_location)],
    leg: {
      km: +(leg.distance.value / 1000).toFixed(2),
      min: +(leg.duration.value / 60).toFixed(1),
      coords,
      steps: leg.steps.map((s) => ({
        m: Math.round(s.distance.value),
        move: googleMove(s.maneuver),
        road: roadFrom(s.html_instructions),
      })),
    },
  };
}

/** Google writes instructions as HTML: "Turn right onto <b>HITEC City Rd</b>". */
function roadFrom(html: string): string {
  const onto = /(?:onto|on to|toward|towards)\s*<b>(.*?)<\/b>/i.exec(html) ?? /<b>(.*?)<\/b>/.exec(html);
  return (onto?.[1] ?? '').replace(/<[^>]+>/g, '').trim();
}

/* ── OSRM ────────────────────────────────────────────────────────────────── */

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
  return {
    provider: 'osrm',
    snapped: [body.waypoints[0].distance, body.waypoints[1].distance],
    leg: {
      km: +(r.distance / 1000).toFixed(2),
      /* Six decimals is about 10 cm. Five was a metre, which is enough to place a truck but not
         enough to keep it off the kerb at the zoom this map arrives at. */
      coords: r.geometry.coordinates.map(([lng, lat]) => [round6(lng), round6(lat)] as [number, number]),
      min: +(r.duration / 60).toFixed(1),
      steps: r.legs[0].steps.map((s) => ({
        m: Math.round(s.distance),
        move: [s.maneuver.type, s.maneuver.modifier].filter(Boolean).join('-'),
        road: s.name ?? '',
      })),
    },
  };
}

/* ── the seam ────────────────────────────────────────────────────────────── */

export function haversine(a: Point, b: Point): number {
  const p = Math.PI / 180;
  const dLat = (b.lat - a.lat) * p;
  const dLng = (b.lng - a.lng) * p;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}

export const routingProvider = (): 'google' | 'osrm' => (process.env.GOOGLE_MAPS_API_KEY ? 'google' : 'osrm');

export function route(from: Point, to: Point): Promise<Routed> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return key ? google(from, to, key) : osrm(from, to);
}
