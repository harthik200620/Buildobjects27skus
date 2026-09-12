/**
 * Road geometry for the demo legs, into lib/tracking/routes.json.
 *
 *   pnpm --filter @buildobjects/web routes:fetch
 *
 * Fetched here and committed rather than called from the browser. A tracking page that waits on a
 * routing API is a tracking page that hangs when the API is slow, and the demo's timings are only
 * reproducible if its roads are. Re-run after editing lib/tracking/cities.ts.
 *
 * Set GOOGLE_MAPS_API_KEY to route with Google Directions; without it the public OSRM server is
 * used. See scripts/route-providers.mts.
 *
 * It PRINTS THE TURNS, and that is the point of the output. A polyline is unreadable, so the only
 * way anyone can tell whether the truck is being sent down a road that exists is to read the road
 * names back. Anything suspicious — an end snapped far from a road, a route down a motorway, a
 * U-turn — is flagged rather than silently written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@buildobjects/db';
import { CITIES } from '../lib/tracking/cities';
import { haversine, type Point, type Routed, route, routingProvider } from './route-providers.mts';

loadEnv();

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/tracking/routes.json');

/** A door more than this far from the nearest road is an address in the wrong place. */
const SNAP_LIMIT_M = 40;
/** A local delivery that uses a motorway usually means a badly placed yard, not a clever route. */
const MOTORWAY = /\b(expressway|outer ring road|orr\b|nh-?\d+|national highway)\b/i;

let warnings = 0;
const warn = (msg: string) => {
  warnings++;
  console.warn(`  ! ${msg}`);
};

function report(label: string, r: Routed, from: Point, to: Point) {
  const straight = haversine(from, to) / 1000;
  console.log(`  ${label.padEnd(8)} ${r.leg.km.toFixed(2)} km  ${r.leg.min.toFixed(1)} min  ${r.leg.coords.length} pts  ${r.leg.steps.length} turns`);
  for (const s of r.leg.steps) {
    if (s.m >= 60 || s.move === 'arrive') console.log(`      ${String(s.m).padStart(5)}m  ${s.move.padEnd(16)} ${s.road || '(unnamed)'}`);
  }
  const [a, b] = r.snapped;
  if (a > SNAP_LIMIT_M) warn(`${label}: the start is ${a.toFixed(0)} m from the nearest road — move it onto one in cities.ts`);
  if (b > SNAP_LIMIT_M) warn(`${label}: the end is ${b.toFixed(0)} m from the nearest road — move it onto one in cities.ts`);
  /* A road route is always longer than the crow flies. Much longer means it went the wrong way
     round something — the usual cause is a divided carriageway entered from the wrong side. */
  if (r.leg.km > straight * 2.2) warn(`${label}: ${r.leg.km.toFixed(2)} km of road for ${straight.toFixed(2)} km of straight line`);
  const big = r.leg.steps.find((s) => MOTORWAY.test(s.road));
  if (big) warn(`${label}: routed onto ${big.road} — check a local road is not being skipped`);
  if (r.leg.steps.some((s) => s.move.includes('uturn'))) warn(`${label}: the route makes a U-turn`);
}

console.log(`routing with ${routingProvider()}${routingProvider() === 'osrm' ? '  (set GOOGLE_MAPS_API_KEY for Google Directions)' : ''}\n`);

const out: Record<string, { toYard: unknown; toDrop: unknown }> = {};
for (const city of Object.values(CITIES)) {
  console.log(city.name);
  const [toYard, toDrop] = await Promise.all([route(city.partnerAt, city.yard), route(city.yard, city.drop)]);
  report('to yard', toYard, city.partnerAt, city.yard);
  report('to door', toDrop, city.yard, city.drop);
  out[city.id] = { toYard: toYard.leg, toDrop: toDrop.leg };
  console.log('');
}

fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`wrote ${path.relative(process.cwd(), OUT)}${warnings ? `  with ${warnings} warning(s) above` : ''}`);
