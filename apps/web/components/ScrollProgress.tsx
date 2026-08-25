'use client';

import React from 'react';

/**
 * Two things that both need the scroll position, so they share one listener.
 *
 *   1. `data-scrolled` on <html> once the page has moved off the top. The header reads it and
 *      condenses — the shadow appears and the hairline firms up — which is how a sticky bar
 *      tells you it is floating over content rather than sitting in it. Doing this in CSS alone
 *      is not possible without a scroll-driven timeline, which Safari does not have.
 *   2. A 2 px brand rule under the header showing how far down the document you are. This page
 *      is thirty-five tiles and the spec sheets run to a couple of hundred rows; a reader who
 *      cannot see the end of a list cannot judge whether to keep going.
 *
 * One passive listener, coalesced into a single rAF, writing two custom properties. No state,
 * so no React render happens on scroll at all — at 120 Hz that is the difference between a
 * smooth bar and a stuttering page.
 */
export default function ScrollProgress() {
  const bar = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const root = document.documentElement;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const max = root.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      if (y > 8) root.dataset.scrolled = '1';
      else delete root.dataset.scrolled;
      /* A document that does not scroll has no progress to report — 0/0 would be NaN, and a
         full bar on a short page is a lie either way. */
      const pct = max > 40 ? Math.min(1, Math.max(0, y / max)) : 0;
      bar.current?.style.setProperty('--progress', String(pct));
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return <div ref={bar} className="scroll-progress" aria-hidden />;
}
