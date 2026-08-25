'use client';

import React from 'react';

/**
 * The BO cart: the Build Objects mark, on wheels, being pushed.
 *
 * The header used to carry a 🛒 emoji — the same glyph as every other shop on the internet,
 * rendered by whatever font the operating system happened to pick, in whatever colour that font
 * decided. It was the one piece of the store's chrome that belonged to nobody.
 *
 * This is drawn instead, and it is drawn out of the brand: the trolley's basket is the mark's own
 * "b" — three parallel strokes and a bowl — set on a chassis with two wheels and a handle, with a
 * figure behind it. So the thing that carries your order is literally the thing that sells it.
 *
 * The entrance is the Blinkit idea: it does not fade in, it arrives. The trolley drops from above
 * the header, the chassis compresses on landing, the wheels spin up and settle, and the whole rig
 * rocks once as the weight transfers. Every part of that is one CSS keyframe on one element — no
 * animation library, no JS timeline — and the whole thing is off under prefers-reduced-motion,
 * where it renders as a still mark.
 *
 * `arrive` re-fires the landing. The header calls it whenever an item joins the cart, so adding
 * something to your order has a physical consequence in the chrome.
 */

export interface BoCartMarkProps {
  size?: number;
  /** Bump this to replay the landing — the header passes the cart's item count. */
  arriveKey?: number | string;
  className?: string;
}

/**
 * The mark's three strokes and bowl, drawn at its own scale and then placed on the deck.
 *
 * The first attempt left the b hovering a third of the frame above the trolley with the handle
 * running up to nothing, which read as a logo next to a cart rather than a logo *on* one. The
 * numbers below are worked so the bowl's baseline lands exactly on the deck: the paths span
 * y 8…78, scaled by 0.6 that is 4.8…46.8, so a translate of (104 − 46.8) sets it down flush.
 */
const B_STROKES = 'M30 8 L10 78 M48 8 L28 78 M66 8 L46 78';
const B_BOWL = 'M62 26 H92 A26 26 0 0 1 92 78 H44';
const B_SCALE = 0.6;
const DECK_Y = 100;
const B_PLACE = `translate(44 ${DECK_Y - 78 * B_SCALE}) scale(${B_SCALE})`;

export default function BoCartMark({ size = 26, arriveKey, className }: BoCartMarkProps) {
  /*
   * A CSS animation only replays if the element is re-created or the animation is restarted, so
   * the key changes with `arriveKey` and React swaps the node. Cheaper and more reliable than
   * toggling a class and forcing a reflow.
   */
  const [seq, setSeq] = React.useState(0);
  const lastArrival = React.useRef(arriveKey);
  if (lastArrival.current !== arriveKey) {
    /* Derived during render rather than in an effect: the trolley should land on the frame the
       count changes, not one paint later, and this is the "adjusting state on prop change"
       pattern React documents for exactly this case. */
    lastArrival.current = arriveKey;
    setSeq((n) => n + 1);
  }

  return (
    <span key={seq} className={`bocart${className ? ` ${className}` : ''}`} style={{ width: size * 1.35, height: size * 1.35 }} aria-hidden="true">
      <svg viewBox="0 0 140 140" width="100%" height="100%" fill="none">
        <title>BO Cart</title>

        {/* the person: head, body, one arm reaching the grip, two legs mid-stride */}
        <g className="bocart-driver" stroke="var(--color-header-ink-2)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="42" r="9" fill="var(--color-header-ink-2)" stroke="none" />
          <path d="M18 53 v22" />
          <path d="M18 60 L36 66" />
          <path className="bocart-leg bocart-leg--a" d="M18 75 L9 100" />
          <path className="bocart-leg bocart-leg--b" d="M18 75 L29 100" />
        </g>

        {/* the trolley: grip, post, deck, wheels — and the mark riding on the deck */}
        <g className="bocart-rig">
          <path d="M36 66 H50 V100" stroke="var(--color-header-ink-2)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          <g className="bocart-basket" transform={B_PLACE}>
            <path d={B_STROKES} stroke="var(--color-brand)" strokeWidth="14" strokeLinecap="round" />
            <path d={B_BOWL} stroke="var(--color-brand)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <rect x="46" y={DECK_Y} width="80" height="8" rx="4" fill="var(--color-header-ink)" />
          <g className="bocart-wheel bocart-wheel--a">
            <circle cx="64" cy="120" r="10" fill="var(--color-header-ink)" />
            <circle cx="64" cy="120" r="3.4" fill="var(--color-header)" />
          </g>
          <g className="bocart-wheel bocart-wheel--b">
            <circle cx="108" cy="120" r="10" fill="var(--color-header-ink)" />
            <circle cx="108" cy="120" r="3.4" fill="var(--color-header)" />
          </g>
        </g>
      </svg>
    </span>
  );
}
