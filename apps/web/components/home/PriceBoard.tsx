'use client';

import Link from 'next/link';
import React from 'react';
import Img from '@/components/Img';
import { IconArrow, IconShield } from '@/components/icons';
import { inr } from '@/lib/media';

export interface BoardItem {
  sku: string;
  brand: string;
  name: string;
  price: number;
  unit: string;
  /** Already resolved to a URL on the server — this component never touches the media helpers. */
  image: string | null;
  blurhash: string | null;
  categoryName: string;
}

/** How long each item holds the board. Long enough to read a brand, a name and a price. */
const DWELL = 4200;

/**
 * The panel in the top-right of the home page: real stock, one item at a time.
 *
 * That slot used to be an empty rectangle. It was drawn as "considered negative space" — a
 * bordered 16:9 box with a teal gradient in it and no content — on the argument that a labelled
 * empty box ("Advertising space — available") was worse. Both are true and both are wrong: the
 * best thing to put in the most valuable rectangle on the front page is the shop's own stock.
 *
 * So it advertises us. It cycles the items we actually have, priced, with the brand named and the
 * unit stated, and each one is a link to the product. Nothing here is decorative — a reader who
 * watches it for fifteen seconds has seen four real prices.
 *
 * The motion rules it follows:
 *   · Pointer over it or keyboard focus inside it pauses the rotation. Content that moves out
 *     from under someone who is reading it is the single most disliked thing a carousel does.
 *   · The tab is hidden → the timer stops. A background tab should not be animating.
 *   · prefers-reduced-motion → no rotation at all. It shows the first item and the dots become
 *     the only way through, which is a working control rather than a disabled one.
 *   · The progress ring is CSS keyed to the same constant, so the ring and the swap cannot drift.
 */
export default function PriceBoard({ items }: { items: BoardItem[] }) {
  const [at, setAt] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [still, setStill] = React.useState(false);
  const box = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setStill(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  /*
   * Pause on hover and on focus, wired through the DOM rather than through JSX handlers.
   *
   * A <section> is not an interactive element, and hanging onMouseEnter on one is the pattern
   * a11y linters exist to catch: it usually means a control has been built out of a div with no
   * role, no tab stop and no keyboard path. Here it genuinely is a region — the controls inside
   * it are real buttons and links — and what the pointer does is suspend an animation, which is
   * not an interaction the element needs to expose. Listening from an effect says that plainly,
   * and costs no re-render on the way in and out.
   */
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const hold = () => setPaused(true);
    const release = () => setPaused(false);
    el.addEventListener('pointerenter', hold);
    el.addEventListener('pointerleave', release);
    el.addEventListener('focusin', hold);
    el.addEventListener('focusout', release);
    return () => {
      el.removeEventListener('pointerenter', hold);
      el.removeEventListener('pointerleave', release);
      el.removeEventListener('focusin', hold);
      el.removeEventListener('focusout', release);
    };
  }, []);

  /*
   * One interval for the whole rotation, rather than a fresh timeout keyed off the current
   * index. Both advance the board identically; the interval simply does not need `at` as a
   * dependency, so the effect is not torn down and rebuilt on every swap.
   */
  React.useEffect(() => {
    if (paused || still || items.length < 2) return;
    const tick = () => setAt((i) => (i + 1) % items.length);
    let timer = window.setInterval(tick, DWELL);
    /* A tab that is not on screen should not be running a timer; restart cleanly when it
       returns rather than firing a backlog of swaps at once. */
    const onVisible = () => {
      clearInterval(timer);
      if (!document.hidden) timer = window.setInterval(tick, DWELL);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [paused, still, items.length]);

  if (items.length === 0) return null;
  const item = items[at];
  const rotating = !paused && !still && items.length > 1;

  return (
    <section className="board" ref={box} aria-label="On the shelf today">
      <div className="board-head">
        <span className="board-kicker">
          <span className="pulse-dot" aria-hidden />
          On the shelf today
        </span>
        {rotating && <span className="board-ring" aria-hidden style={{ animationDuration: `${DWELL}ms` }} key={at} />}
      </div>

      {/* aria-live off by default: this rotates on a timer, and a region that announces itself
          every four seconds makes a screen reader unusable. The links below are the accessible
          route through the same items. */}
      <Link href={`/p/${item.sku.toLowerCase()}`} className="board-item" key={item.sku}>
        <span className="board-shot">
          {item.image && <Img src={item.image} alt="" width={160} height={160} sizes="160px" blurhash={item.blurhash} className="board-img" />}
        </span>
        <span className="board-text">
          <span className="board-cat">{item.categoryName}</span>
          <span className="board-brand">{item.brand}</span>
          <span className="board-name">{item.name}</span>
          <span className="board-price">
            <b className="fig">{inr(item.price)}</b>
            <span className="board-unit">per {item.unit}</span>
          </span>
        </span>
      </Link>

      <div className="board-foot">
        <span className="board-gst">
          <IconShield size={13} /> GST included
        </span>
        <span className="board-go">
          See the price breakdown <IconArrow size={13} />
        </span>
      </div>

      {items.length > 1 && (
        <div className="board-dots" role="tablist" aria-label="Featured stock">
          {items.map((it, i) => (
            <button
              key={it.sku}
              type="button"
              role="tab"
              aria-selected={i === at}
              aria-label={`${it.brand} — ${it.name}`}
              className={`board-dot${i === at ? ' is-on' : ''}`}
              onClick={() => setAt(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
