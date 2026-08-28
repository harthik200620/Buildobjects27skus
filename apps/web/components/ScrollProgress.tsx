'use client';

import { usePathname } from 'next/navigation';
import React from 'react';

/**
 * Four jobs, one bar, one passive listener coalesced into a single rAF. No React state, so no
 * render happens on scroll at all.
 *
 *   1. `data-scrolled` on <html> once the page has moved off the top; the header reads it and
 *      firms up. CSS alone cannot do this without a scroll-driven timeline, which Safari lacks.
 *   2. `data-nav="away"` while the reader is going DOWN, which slides the bar off the top edge.
 *      Any upward movement brings it back.
 *   3. A 2px rule showing how far down the document you are — the spec sheets run to a couple of
 *      hundred rows, and a reader who cannot see the end cannot judge whether to keep going.
 *   4. The same rule fills while a NAVIGATION is in flight. Every page behind the front door is
 *      server-rendered on demand, and for that second a click produced no evidence it had landed.
 *      The App Router publishes no navigation events, so the click is the start and the pathname
 *      changing is the end. It gives up after eight seconds: a bar still filling when the page is
 *      not is worse than no bar.
 */

/**
 * The bar never leaves inside the first screenful. Near the top of a page the reader is still
 * arriving, and chrome that flinches at the first flick of the wheel reads as broken rather than
 * as considerate.
 */
const FLOOR = 240;

/**
 * How far the reader has to actually travel before the bar changes its mind, in each direction.
 *
 * Without a deadband this is the single jitteriest thing on a page. A trackpad emits scroll
 * deltas of a pixel or less in BOTH directions during one flick, momentum overshoots and rubber
 * -bands back at the end of every gesture, and a keyboard's own scroll-into-view can nudge
 * upward while the reader is going down. Any of those flips a naive direction check, so the bar
 * flutters. Six pixels of accumulated movement is below what anyone reads as a deliberate scroll
 * and far above what any of that noise produces.
 *
 * Coming back is cheaper than leaving on purpose: reaching for the bar should feel immediate,
 * and losing it should take a deliberate push.
 */
const AWAY_AFTER = 8;
const BACK_AFTER = 4;

export default function ScrollProgress() {
  const bar = React.useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  /*
   * The pending navigation, watched from the one place that already owns this element.
   *
   * `pathname` is the finish line — when it changes, whatever was in flight has landed. It is a
   * separate effect from the scroll listener below so that a navigation does not tear down and
   * rebuild the scroll machinery.
   */
  React.useEffect(() => {
    const root = document.documentElement;
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      timer = 0;
      delete root.dataset.navPending;
    };
    /* A click that will actually navigate: same origin, a real path, not a new tab, not a hash on
       the page you are already on, and not something the page has already handled itself. */
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname + url.search === location.pathname + location.search) return;
      root.dataset.navPending = '1';
      window.clearTimeout(timer);
      /* The failsafe. A bar still filling after the page has given up says the wrong thing. */
      timer = window.setTimeout(done, 8000);
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => {
      document.removeEventListener('click', onClick, { capture: true });
      done();
    };
  }, []);

  /* The finish line: this runs on every completed navigation. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is the event, not a value read in the body — the effect exists to fire when it changes.
  React.useEffect(() => {
    delete document.documentElement.dataset.navPending;
  }, [pathname]);

  React.useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let lastY = window.scrollY;
    /* Movement in the current direction, reset the moment the direction changes. */
    let run = 0;
    let away = false;

    const show = () => {
      run = 0;
      away = false;
      delete root.dataset.nav;
    };

    const measure = () => {
      frame = 0;
      const max = root.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;

      if (y > 8) root.dataset.scrolled = '1';
      else delete root.dataset.scrolled;

      /* A document that does not scroll has no progress to report — 0/0 would be NaN, and a
         full bar on a short page is a lie either way. */
      const pct = max > 40 ? Math.min(1, Math.max(0, y / max)) : 0;
      bar.current?.style.setProperty('--progress', String(pct));

      /* A gesture that reverses starts its own run rather than continuing the old one. A frame
         that did not move — a resize, the first measure — is not a direction and resets nothing. */
      if (dy !== 0) run = dy > 0 === run > 0 ? run + dy : dy;

      /*
       * Two things pin the bar in place regardless of direction. Near the top there is nothing
       * to gain by hiding it. And a page whose scroll has been locked — the ⌘K palette, a
       * filter sheet, the deliver-to sheet on a phone — still fires scroll events as the lock
       * is applied and released, and a bar that disappeared because a modal opened would be
       * missing when the modal closed. The lock pins <body> rather than hiding its overflow,
       * so that is what this looks for; see useScrollLock for why.
       */
      if (y <= FLOOR || document.body.style.position === 'fixed') {
        if (away) show();
        return;
      }
      if (!away && run > AWAY_AFTER) {
        away = true;
        run = 0;
        root.dataset.nav = 'away';
      } else if (away && run < -BACK_AFTER) {
        show();
      }
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    /*
     * Tabbing into the bar brings it back. Without this a keyboard reader who has scrolled down
     * and pressed Shift+Tab lands focus on a control that is off the top of the screen — the
     * focus ring is drawn somewhere they cannot see, which is the accessibility equivalent of
     * losing it entirely.
     */
    const onFocusIn = (e: FocusEvent) => {
      if (away && (e.target as HTMLElement | null)?.closest?.('.header')) show();
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('focusin', onFocusIn);
      delete root.dataset.nav;
    };
  }, []);

  return <div ref={bar} className="scroll-progress" aria-hidden />;
}
