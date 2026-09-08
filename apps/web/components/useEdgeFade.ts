'use client';

import React from 'react';

/**
 * Tells a horizontally scrolling row where its content actually continues, so the `.edge-fade`
 * mask in theme.css can soften that side and only that side.
 *
 * WHY IT IS MEASURED RATHER THAN ALWAYS ON. A fade on both edges at all times is worse than none:
 * at the start of a row it puts a shadow on the left where there is nothing to reveal, which
 * reads as content already scrolled past and sends people swiping the wrong way. A fade means
 * "there is more this way", so it has to be true.
 *
 * The row keeps its own scrollbar behaviour; this only publishes two lengths.
 *
 *   const row = useEdgeFade<HTMLDivElement>();
 *   <div ref={row} className="chip-row edge-fade">…</div>
 */
export function useEdgeFade<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = React.useRef<T>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /* 28px of fade: wide enough to read as a soft edge at a glance, narrow enough that it never
       eats a whole chip. Written as a length rather than a percentage so a wide row and a narrow
       one fade by the same amount. */
    const FADE = 28;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      /* A row that does not overflow gets no fade at all — there is nothing to hint at. */
      if (max <= 1) {
        el.style.setProperty('--edge-l', '0px');
        el.style.setProperty('--edge-r', '0px');
        return;
      }
      /* Ramped over the last few pixels so the fade appears and disappears smoothly as the row
         reaches either end, rather than popping on at the first pixel of scroll. */
      const near = Math.min(FADE, max);
      el.style.setProperty('--edge-l', `${Math.round((Math.min(el.scrollLeft, near) / near) * FADE)}px`);
      el.style.setProperty('--edge-r', `${Math.round((Math.min(max - el.scrollLeft, near) / near) * FADE)}px`);
    };

    measure();
    el.addEventListener('scroll', measure, { passive: true });
    /* The row's own width changes with the viewport, and its CONTENT changes when a filter adds
       or removes a chip — a resize observer catches both, where a window listener catches one. */
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, []);

  return ref;
}
