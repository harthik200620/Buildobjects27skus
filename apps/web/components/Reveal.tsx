'use client';

import { usePathname } from 'next/navigation';
import React from 'react';

declare global {
  interface Window {
    /** Set by the pre-paint bootstrap; cleared once the observer has actually delivered. */
    __boRevealFailsafe?: number;
    /** Latched by the failsafe. Once true, this session never hides anything again. */
    __boRevealOff?: boolean;
  }
}

/**
 * Scroll choreography for the whole store, from one mounted component. A server component marks
 * anything it wants to arrive with `data-reveal` — a plain attribute, no import, no boundary, no
 * bundle — and this observer flips it to `data-shown`. The transition is CSS.
 *
 * THE FAILSAFE IS CANCELLED FROM INSIDE THE OBSERVER'S FIRST CALLBACK, not at mount. Mounting
 * proves React is alive, not that IntersectionObserver will deliver: a page that is never
 * composited — a discarded background tab, an undisplayed embed, a headless renderer — mounts
 * effects and constructs observers happily and never fires a callback, because intersection is a
 * property of a RENDERED page. Cancelling at mount meant the one situation the timer existed for
 * was the situation that disarmed it. Observed, not theorised: a whole page below the hero at
 * opacity 0 indefinitely. If the timer fires first it latches `__boRevealOff` and this component
 * stops hiding anything for the session — content is never behind an observer that is not running.
 *
 * A MutationObserver picks up nodes React adds later; the pathname dependency re-scans on client
 * navigation, where the DOM is replaced wholesale. The same scan marks lazily-loaded images
 * `data-ready` once decoded, which is what the fade in theme.css transitions on — here rather than
 * in its own component, since this is already the one place watching for new nodes. Only
 * `loading="lazy"` images: an eager one is usually the page's largest contentful paint, and
 * starting it at opacity 0 would push the LCP out by the length of the fade.
 */
export default function Reveal() {
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a re-run trigger, not a value. A client navigation replaces the whole subtree, so the observer has to be rebuilt and the new DOM rescanned — and there is nothing in the new path to read, which is exactly why the rule cannot see the dependency is load-bearing.
  React.useEffect(() => {
    const root = document.documentElement;

    /* The failsafe already fired once this session, or the reader wants no motion, or the
       browser has no observer: show everything and never hide again. */
    if (window.__boRevealOff || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.__boRevealOff = true;
      root.classList.remove('js-reveal');
      return;
    }
    root.classList.add('js-reveal');

    const disarm = () => {
      if (window.__boRevealFailsafe) {
        clearTimeout(window.__boRevealFailsafe);
        window.__boRevealFailsafe = undefined;
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        /* Reaching this line at all is the proof the timer was waiting for. */
        disarm();
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.shown = '';
          io.unobserve(entry.target);
        }
      },
      /* Fire a little before the element is fully on screen, so the movement finishes as it
         settles rather than starting once it is already sitting still in the middle. */
      { rootMargin: '0px 0px -6% 0px', threshold: 0.01 },
    );

    const seen = new WeakSet<Element>();

    /*
     * `complete` is checked first and it is the whole reason this is not just a `load` listener:
     * an image served from cache — every image on a second visit, and every image React re-mounts
     * on a client navigation — has already finished by the time this runs and will never fire
     * `load` again. Without the check those images stay at opacity 0 for good.
     *
     * `error` marks it ready too. A source that fails to load is still a box the page has laid
     * out, and leaving it at opacity 0 hides the alt text along with it — a broken image should
     * read as broken, not as nothing.
     */
    const ready = (img: HTMLImageElement) => {
      img.dataset.ready = '';
    };
    const watchImage = (img: HTMLImageElement) => {
      if (img.complete) return ready(img);
      img.addEventListener('load', () => ready(img), { once: true });
      img.addEventListener('error', () => ready(img), { once: true });
    };

    const scan = () => {
      for (const el of document.querySelectorAll('[data-reveal]:not([data-shown])')) {
        if (seen.has(el)) continue;
        seen.add(el);
        io.observe(el);
      }
      for (const el of document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]:not([data-ready])')) {
        if (seen.has(el)) continue;
        seen.add(el);
        watchImage(el);
      }
    };
    scan();

    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, [pathname]);

  return null;
}
