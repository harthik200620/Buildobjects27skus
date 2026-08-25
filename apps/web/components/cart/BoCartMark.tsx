'use client';

import React from 'react';

/**
 * The BO cart: the Build Objects mark, on wheels.
 *
 * The header used to carry a 🛒 emoji — the same glyph as every other shop on the internet, drawn
 * by whatever font the operating system picked, in whatever colour that font decided. It was the
 * one piece of chrome that belonged to nobody.
 *
 * The first replacement drew the whole scene in SVG: the mark's three diagonal strokes and bowl
 * redrawn as a basket, a deck, two spoked wheels and a figure pushing it. At 140 units it was
 * legible. At the 26 px the header actually renders it, the thin strokes of the mark collided
 * with the thin strokes of the trolley and the whole thing became one grey-and-teal smear —
 * metal and logo welded together, readable as neither.
 *
 * So the load is the real logo asset. `/logo-mark-128.png` is the mark as the brand actually draws
 * it, already built to survive being small, and using it means the recognisable part of the icon
 * is the part nobody redrew. The chassis is what got cut back: one flat deck bar and two solid
 * wheels, with real clearance between the mark and the metal so they read as separate objects.
 *
 * The figure is off by default. It was the busiest element and it is illegible below about 40 px;
 * `driver` brings it back where there is room.
 *
 * The entrance is the Blinkit idea: it does not fade in, it arrives. The rig drops from above the
 * header, compresses on landing, the wheels spin up and settle. `arriveKey` replays it — the
 * header passes the cart's item count, so adding something has a physical consequence in the
 * chrome. All of it is off under prefers-reduced-motion.
 */

export interface BoCartMarkProps {
  /** Height of the whole rig in CSS pixels. */
  size?: number;
  /** Bump this to replay the landing — the header passes the cart's item count. */
  arriveKey?: number | string;
  /** Show the figure pushing it. Off by default: it is illegible below ~40 px. */
  driver?: boolean;
  className?: string;
}

export default function BoCartMark({ size = 26, arriveKey, driver = false, className }: BoCartMarkProps) {
  /*
   * A CSS animation only replays if the element is re-created, so the key changes with
   * `arriveKey` and React swaps the node. Derived during render rather than in an effect: the
   * trolley should land on the frame the count changes, not one paint later.
   */
  const [seq, setSeq] = React.useState(0);
  const lastArrival = React.useRef(arriveKey);
  if (lastArrival.current !== arriveKey) {
    lastArrival.current = arriveKey;
    setSeq((n) => n + 1);
  }

  /*
   * Sized in pixels, not percentages.
   *
   * The first layout gave the load 62% and the chassis 30% of the rig. Percentage heights need a
   * definite parent height to resolve against, and through an inline-flex wrapper and an SVG with
   * its own intrinsic aspect ratio they did not: at a 24 px box the parts measured 19 px and
   * 13 px — 32 px of content in a 24 px frame, which is exactly the overlap that welded the logo
   * to the metal. Three integers computed here cannot drift.
   */
  const loadH = Math.round(size * 0.58);
  const deckH = Math.round(size * 0.3);
  const gapH = Math.max(1, size - loadH - deckH);

  return (
    <span
      key={seq}
      className={`bocart${driver ? ' bocart--driver' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: Math.round(size * 1.16), height: size }}
      aria-hidden="true"
    >
      {driver && (
        <svg className="bocart-person" viewBox="0 0 44 100" fill="none" aria-hidden="true">
          <circle cx="20" cy="15" r="9" fill="currentColor" />
          <path d="M20 26 v25 M20 33 L40 41 M20 51 L10 80 M20 51 L31 80" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span className="bocart-rig">
        {/* The load: the real mark, not a redrawing of it. */}
        <img className="bocart-load" src="/logo-mark-128.png" alt="" draggable={false} style={{ height: loadH, marginBottom: gapH }} />
        {/* The chassis: one deck and two wheels, and nothing else. */}
        <svg className="bocart-chassis" viewBox="0 0 100 34" fill="none" preserveAspectRatio="xMidYMax meet" aria-hidden="true" style={{ height: deckH }}>
          <rect x="3" y="0" width="94" height="7" rx="3.5" fill="currentColor" />
          <circle className="bocart-wheel bocart-wheel--a" cx="27" cy="22" r="10" fill="currentColor" />
          <circle className="bocart-wheel bocart-wheel--b" cx="73" cy="22" r="10" fill="currentColor" />
        </svg>
      </span>
    </span>
  );
}
