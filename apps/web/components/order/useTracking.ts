'use client';

import React from 'react';
import { plan, simMinutes, snapshot } from '@/lib/tracking/simulate';
import type { Order, Snapshot } from '@/lib/tracking/types';
import { smoothHeading } from './heading';

type Listener = (frame: Snapshot) => void;

/**
 * The clock behind the page.
 *
 * One requestAnimationFrame loop computes the truck and hands it to whoever subscribed — the map.
 * React state changes only when the phase or the whole minute does, so the cards around the map
 * re-render a handful of times per trip instead of a few thousand: the map is animation and the
 * cards are text, and they should not share a render budget.
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
    let last = performance.now();
    let shown = '';

    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;

      const next = snapshot(p, simMinutes(order));
      heading = smoothHeading(heading, next.heading, dt);
      for (const listener of listeners.current) listener({ ...next, heading });

      const key = `${next.phase}/${next.etaMin}`;
      if (key !== shown) {
        shown = key;
        setSnap(next);
      }
      if (next.phase !== 'delivered') raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p, order]);

  return { plan: p, snap, subscribe };
}
