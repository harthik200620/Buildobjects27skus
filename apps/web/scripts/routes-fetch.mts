/**
 * Road geometry for the demo legs, into lib/tracking/routes.json.
 *
 *   pnpm --filter @buildobjects/web routes:fetch
 *
 * Fetched here and committed rather than called from the browser. A tracking page that waits on a
 * routing API is a tracking page that hangs when the API is slow, and the demo's timings are only
 * reproducible if its roads are. Re-run after editing lib/tracking/cities.ts.
 *
 * IT REFUSES TO WRITE A ROUTE A TRUCK CANNOT DRIVE. Every leg is classified edge by edge (see
 * route-providers.mts) and a route that runs on tracks, driveways, alleys or footways fails the
 * run instead of being committed and discovered later by somebody looking at the map. That check
 * exists because the first version of this file shipped exactly that: a car-profile route down
 * five unnamed colony lanes, drawn confidently over ground no loaded vehicle could cross.
 *
 * It also PRINTS THE TURNS AND THE ROAD MIX. A polyline is unreadable; road names and percentages
 * are how a person tells at a glance whether the truck is being sent somewhere sensible.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@buildobjects/db';
import { CITIES } from '../lib/tracking/cities';
import { haversine, IMPASSABLE, type Point, type Routed, route, routingProvider } from './route-providers.mts';

loadEnv();

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/tracking/routes.json');

/** A door more than this far from the nearest road is an address in the wrong place. */
const SNAP_LIMIT_M = 40;
/** Service road is fine for the last few metres to a gate; a route mostly on one is not. */
const SERVICE_LIMIT_M = 250;

let failures = 0;
let warnings = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};
const warn = (msg: string) => {
  warnings++;
  console.warn(`  ! ${msg}`);
};

function report(label: string, r: Routed, from: Point, to: Point) {
  const straight = haversine(from, to) / 1000;
  console.log(`  ${label.padEnd(8)} ${r.leg.km.toFixed(2)} km  ${r.leg.min.toFixed(1)} min  ${r.leg.coords.length} pts  ${r.leg.steps.length} turns`);

  const total = Object.values(r.mix).reduce((s, v) => s + v, 0);
  if (total) {
    const mix = Object.entries(r.mix)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`)
      .join(' · ');
    console.log(`           on: ${mix}`);
  } else {
    warn(`${label}: the route could not be classified, so nothing here proves a truck can drive it`);
  }

  for (const s of r.leg.steps) {
    if (s.m >= 120 || s.move.startsWith('arrive')) console.log(`      ${String(s.m).padStart(5)}m  ${s.move.padEnd(18)} ${s.road || '(unnamed)'}`);
  }

  /* ── the gates ── */
  const banned = Object.entries(r.mix).filter(([k]) => IMPASSABLE.includes(k));
  for (const [kind, m] of banned) fail(`${label}: ${m} m of this route is ${kind} — a delivery truck cannot use it`);

  const service = Object.entries(r.mix)
    .filter(([k]) => k.includes('service'))
    .reduce((s, [, v]) => s + v, 0);
  if (service > SERVICE_LIMIT_M) fail(`${label}: ${service} m on service roads — more than the last turn into a gate`);

  const [a, b] = r.snapped;
  if (a > SNAP_LIMIT_M) fail(`${label}: the start is ${a.toFixed(0)} m from the nearest road — move it onto one in cities.ts`);
  if (b > SNAP_LIMIT_M) fail(`${label}: the end is ${b.toFixed(0)} m from the nearest road — move it onto one in cities.ts`);

  /* A road route is always longer than the crow flies. Much longer means it went the wrong way
     round something — usually a divided carriageway entered from the wrong side. */
  if (r.leg.km > straight * 2.4) warn(`${label}: ${r.leg.km.toFixed(2)} km of road for ${straight.toFixed(2)} km of straight line`);
  if (r.leg.steps.some((s) => s.move.includes('uturn'))) warn(`${label}: the route makes a U-turn`);
}

const provider = routingProvider();
console.log(`routing with ${provider}${provider === 'valhalla' ? ' (truck costing) — set GOOGLE_MAPS_API_KEY to use Google Directions' : ''}\n`);

const out: Record<string, { toYard: unknown; toDrop: unknown }> = {};
for (const city of Object.values(CITIES)) {
  console.log(city.name);
  /* One at a time: these are free public endpoints, and hammering them in parallel across four
     cities is how a shared service starts refusing us. */
  const toYard = await route(city.partnerAt, city.yard);
  report('to yard', toYard, city.partnerAt, city.yard);
  const toDrop = await route(city.yard, city.drop);
  report('to door', toDrop, city.yard, city.drop);
  out[city.id] = { toYard: toYard.leg, toDrop: toDrop.leg };
  console.log('');
}

if (failures) {
  console.error(`${failures} route(s) a truck cannot drive — nothing written. Fix the points in lib/tracking/cities.ts and run again.`);
  process.exit(1);
}

fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`wrote ${path.relative(process.cwd(), OUT)}${warnings ? `  with ${warnings} warning(s) above` : ''}`);
