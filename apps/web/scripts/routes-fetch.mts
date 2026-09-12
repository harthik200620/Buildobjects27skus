/**
 * Road geometry for the demo legs, from OSRM into lib/tracking/routes.json.
 *
 * Fetched once here rather than in the browser: the public OSRM server is a demo instance with
 * no uptime promise, and a tracking page that hangs on a routing call is a tracking page that
 * hangs. Real road shape, zero runtime dependency. Re-run after editing lib/tracking/cities.ts.
 *
 *   pnpm --filter @buildobjects/web routes:fetch
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../lib/tracking/cities';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/tracking/routes.json');
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

type Pt = { lat: number; lng: number };

async function leg(from: Pt, to: Pt) {
  const res = await fetch(`${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const { routes } = (await res.json()) as { routes: Array<{ distance: number; duration: number; geometry: { coordinates: number[][] } }> };
  const r = routes[0];
  return {
    km: +(r.distance / 1000).toFixed(2),
    min: +(r.duration / 60).toFixed(1),
    /* Five decimals is a metre; six is noise that doubles the file. */
    coords: r.geometry.coordinates.map(([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)]),
  };
}

const out: Record<string, unknown> = {};
for (const c of Object.values(CITIES)) {
  const [toYard, toDrop] = await Promise.all([leg(c.partnerAt, c.yard), leg(c.yard, c.drop)]);
  out[c.id] = { toYard, toDrop };
  console.log(`${c.name.padEnd(14)} to yard ${toYard.km} km ${toYard.min} min · to door ${toDrop.km} km ${toDrop.min} min`);
}
fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
