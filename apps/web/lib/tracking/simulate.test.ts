import { describe, expect, it } from 'vitest';
import { shortestTurn, smoothHeading } from '@/components/order/heading';
import { CITIES } from './cities';
import { plan, promiseMinutes, simMinutes, snapshot, trafficFactor, trapezoid } from './simulate';
import type { Order } from './types';

/* Fixed UTC instants; the functions read the clock in IST, so the hour they see is +5:30. */
const NOON = Date.UTC(2026, 8, 12, 6, 30); // 12:00 IST, a Saturday
const EVENING = Date.UTC(2026, 8, 12, 13, 0); // 18:30 IST, the peak
const NIGHT = Date.UTC(2026, 8, 12, 20, 0); // 01:30 IST

/* OSRM snaps a point to the nearest road, so "at the yard" means within a couple of blocks. */
const near = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  expect(Math.abs(a.lat - b.lat)).toBeLessThan(0.003);
  expect(Math.abs(a.lng - b.lng)).toBeLessThan(0.003);
};

describe('trapezoid', () => {
  it('starts at rest and ends at the destination', () => {
    expect(trapezoid(0)).toBe(0);
    expect(trapezoid(1)).toBeCloseTo(1);
  });
  it('never moves backwards', () => {
    let last = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const d = trapezoid(t);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });
  it('cruises at one speed through the middle', () => {
    expect(trapezoid(0.5) - trapezoid(0.4)).toBeCloseTo(trapezoid(0.6) - trapezoid(0.5));
  });
});

describe('trafficFactor', () => {
  it('reads the hour in IST', () => {
    const hyd = CITIES.hyd;
    expect(trafficFactor(hyd, EVENING)).toBe(hyd.traffic.peak);
    expect(trafficFactor(hyd, NOON)).toBe(hyd.traffic.day);
    expect(trafficFactor(hyd, NIGHT)).toBe(hyd.traffic.night);
  });
});

describe('plan', () => {
  it('keeps every city inside the twenty minutes the cart promises, even at peak', () => {
    for (const id of Object.keys(CITIES)) expect(promiseMinutes(id, EVENING), id).toBeLessThanOrEqual(20);
  });
  it('takes longer in the evening than at night', () => {
    expect(plan({ regionId: 'hyd', placedAt: EVENING }).marks.delivered).toBeGreaterThan(plan({ regionId: 'hyd', placedAt: NIGHT }).marks.delivered);
  });
  it('falls back to Hyderabad for a region it has no yard in', () => {
    expect(plan({ regionId: 'nowhere', placedAt: NOON }).city.id).toBe('hyd');
  });
});

describe('snapshot', () => {
  const p = plan({ regionId: 'hyd', placedAt: NOON });
  const { marks } = p;

  it('walks the phases in order, and the ETA only ever falls', () => {
    const seen: string[] = [];
    let eta = Number.POSITIVE_INFINITY;
    for (let m = 0; m <= marks.delivered + 1; m += 0.05) {
      const s = snapshot(p, m);
      if (seen.at(-1) !== s.phase) seen.push(s.phase);
      expect(s.etaMin).toBeLessThanOrEqual(eta);
      eta = s.etaMin;
    }
    expect(seen).toEqual(['confirmed', 'assigned', 'at_yard', 'on_the_way', 'arriving', 'delivered']);
  });

  it('promises the whole trip at the start and nothing at the door', () => {
    expect(snapshot(p, 0).etaMin).toBe(Math.ceil(marks.delivered));
    expect(snapshot(p, marks.delivered).etaMin).toBe(0);
  });

  it('shows no truck until a partner is assigned', () => {
    expect(snapshot(p, 0).at).toBeNull();
    expect(snapshot(p, marks.assigned).at).not.toBeNull();
  });

  it('starts the partner where the dispatcher put him and ends at the door', () => {
    near(snapshot(p, marks.assigned).at as { lat: number; lng: number }, CITIES.hyd.partnerAt);
    near(snapshot(p, marks.delivered).at as { lat: number; lng: number }, CITIES.hyd.drop);
  });

  it('waits at the yard while loading', () => {
    const a = snapshot(p, marks.atYard + 0.1).at as { lat: number; lng: number };
    const b = snapshot(p, marks.loaded - 0.1).at as { lat: number; lng: number };
    expect(a).toEqual(b);
    near(a, CITIES.hyd.yard);
  });

  it('eats the road ahead as it goes', () => {
    const early = snapshot(p, marks.loaded + 0.5).remaining.length;
    const late = snapshot(p, marks.delivered - 0.5).remaining.length;
    expect(late).toBeLessThan(early);
    expect(snapshot(p, marks.delivered).remaining).toHaveLength(0);
  });

  it('turns smoothly: no two frames a heartbeat apart differ by a hairpin', () => {
    let prev = snapshot(p, marks.loaded + 0.2).heading;
    for (let m = marks.loaded + 0.2; m < marks.delivered - 0.2; m += 1 / 60) {
      const h = snapshot(p, m).heading;
      const turn = Math.abs(((h - prev + 540) % 360) - 180);
      expect(turn).toBeLessThan(60);
      prev = h;
    }
  });
});

describe('directions', () => {
  const p = plan({ regionId: 'hyd', placedAt: NOON });

  it('has none before a partner is assigned, and none once delivered', () => {
    expect(snapshot(p, 0).directions).toBeNull();
    expect(snapshot(p, p.marks.delivered).directions).toBeNull();
  });

  it('counts down to the next manoeuvre, then moves on to the one after', () => {
    let seen = 0;
    let last = Number.POSITIVE_INFINITY;
    for (let m = p.marks.loaded; m < p.marks.delivered; m += 0.02) {
      const d = snapshot(p, m).directions;
      if (!d?.next) continue;
      /* Within one manoeuvre the distance falls; when it jumps up we have reached it and are
         counting down to the next one. */
      if (d.next.inM > last) seen++;
      last = d.next.inM;
      expect(d.next.inM).toBeGreaterThanOrEqual(0);
    }
    expect(seen).toBeGreaterThan(2);
  });

  it('never announces a turn onto the road already under the truck', () => {
    /* OSM spells this corridor two ways, so the raw steps produced "carry straight on onto HITEC
       City–Kondapur Main Road" while driving Hitec City - Kondapur Main Road. */
    const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let m = p.marks.loaded; m < p.marks.delivered; m += 0.02) {
      const d = snapshot(p, m).directions;
      if (d?.next?.road) expect(flat(d.next.road), `${m.toFixed(2)} min`).not.toBe(flat(d.road));
    }
  });

  it('announces something the driver has to do, not the road renaming itself', () => {
    for (let m = p.marks.loaded; m < p.marks.delivered; m += 0.05) {
      const d = snapshot(p, m).directions;
      if (!d?.next) continue;
      const asksSomething = /left|right|uturn|roundabout|ramp|merge|fork|arrive/.test(d.next.move) || d.next.road !== '';
      expect(asksSomething, `${d.next.move} onto "${d.next.road}"`).toBe(true);
    }
  });

  it('names roads the router named, and invents none', () => {
    const roads = new Set<string>();
    for (let m = p.marks.loaded; m < p.marks.delivered; m += 0.05) {
      const d = snapshot(p, m).directions;
      if (d?.next?.road) roads.add(d.next.road);
    }
    const known = new Set(p.legs[1].steps.map((s) => s.road).filter(Boolean));
    for (const r of roads) expect(known.has(r), r).toBe(true);
  });
});

describe('smoothHeading', () => {
  /* Run a filter from `from` towards `to` for one second, in steps of `dt` ms. */
  const settle = (from: number, to: number, dt: number) => {
    let h = from;
    for (let t = 0; t < 1000; t += dt) h = smoothHeading(h, to, dt);
    return h;
  };

  it('takes the shortest way round, not the long way', () => {
    expect(shortestTurn(350, 10)).toBe(20);
    expect(shortestTurn(10, 350)).toBe(-20);
    /* Turning from 350° towards 10° must go up through 360, never down through 180. */
    const h = smoothHeading(350, 10, 16);
    expect(h > 350 || h < 10).toBe(true);
  });

  it('turns the same amount per second whatever the frame rate', () => {
    /* The reason the filter takes dt at all: 30 Hz and 120 Hz must look alike. */
    const slow = settle(0, 90, 1000 / 30);
    const fast = settle(0, 90, 1000 / 120);
    expect(Math.abs(slow - fast)).toBeLessThan(1);
  });

  it('starts pointing the right way instead of spinning up from zero', () => {
    expect(smoothHeading(Number.NaN, 217, 16)).toBe(217);
  });

  it('always lands inside one turn of the compass', () => {
    for (const [a, b] of [
      [350, 10],
      [10, 350],
      [0, 180],
      [179, 181],
    ]) {
      const h = smoothHeading(a, b, 16);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});

describe('simMinutes', () => {
  it('runs the clock at the demo speed from the rebase point', () => {
    const o = { clock: { simMs: 60_000, wallMs: 1000, speed: 12 } } as Order;
    expect(simMinutes(o, 1000 + 5000)).toBeCloseTo(2);
  });
});
