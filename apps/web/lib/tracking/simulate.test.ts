import { describe, expect, it } from 'vitest';
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

describe('simMinutes', () => {
  it('runs the clock at the demo speed from the rebase point', () => {
    const o = { clock: { simMs: 60_000, wallMs: 1000, speed: 12 } } as Order;
    expect(simMinutes(o, 1000 + 5000)).toBeCloseTo(2);
  });
});
