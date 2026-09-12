'use client';

import React from 'react';
import { plan, simMinutes, snapshot } from '@/lib/tracking/simulate';
import type { Order, Snapshot } from '@/lib/tracking/types';

type Listener = (frame: Snapshot) => void;

/** Shortest signed arc from a to b, degrees. */
const arc = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/**
 * The clock behind the page. One requestAnimationFrame loop computes the truck sixty times a
 * second and hands it to whoever subscribed (the map); React state only changes when the phase
 * or the minute does, so the cards re-render a few times a trip rather than a few thousand.
 */
export function useTracking(order: Order) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the plan is a function of where and when the order was placed, not of its demo clock
  const p = React.useMemo(() => plan(order), [order.regionId, order.placedAt]);
  const [snap, setSnap] = React.useState(() => snapshot(p, simMinutes(order)));
  const listeners = React.useRef(new Set<Listener>());
  const subscribe = React.useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  React.useEffect(() => {
    let raf = 0;
    let heading = Number.NaN;
    let key = '';
    const tick = () => {
      const s = snapshot(p, simMinutes(order));
      /* Low-passed along the shortest arc, so dense road geometry reads as one smooth turn. */
      heading = Number.isNaN(heading) ? s.heading : heading + arc(heading, s.heading) * 0.12;
      const frame = { ...s, heading: (heading + 360) % 360 };
      for (const l of listeners.current) l(frame);
      const k = `${s.phase}/${s.etaMin}`;
      if (k !== key) {
        key = k;
        setSnap(s);
      }
      if (s.phase !== 'delivered') raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p, order]);

  return { plan: p, snap, subscribe };
}
