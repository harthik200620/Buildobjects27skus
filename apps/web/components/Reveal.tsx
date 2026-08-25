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
 * Scroll choreography for the whole store, from one mounted component.
 *
 * Every other approach to "animate things in as you reach them" ships a client component per
 * animated element. This ships one. A server component marks anything it wants to arrive with
 * `data-reveal` — a plain attribute, no import, no boundary, no bundle — and this observer,
 * mounted once in the app layout, finds them all and flips them to `data-shown`. The transition
 * itself is CSS (see the MOTION block in packages/ui/src/theme.css); nothing here touches style.
 *
 * ── The failsafe, and why it is armed the way it is ──────────────────────────
 *
 * Hiding content until a script un-hides it is a bet, and the bet has to be written so that
 * losing it is survivable. The bootstrap in lib/reveal-bootstrap.ts arms a 2.5 s timer that
 * un-hides everything, and the obvious place to cancel it is here, on mount.
 *
 * That is wrong, and it was wrong in a way worth recording: mounting proves React is alive, not
 * that IntersectionObserver is going to deliver. A page that is never composited — a background
 * tab that is discarded, an embedded view that is not displayed, a headless renderer — mounts
 * effects and constructs observers perfectly happily and then never fires a single callback,
 * because intersection is a property of a rendered page. Cancelling the timer at mount meant the
 * one situation the timer existed for was the exact situation that disarmed it. This was observed,
 * not theorised: in a non-compositing preview the whole page below the hero sat at opacity 0
 * indefinitely, and a fresh observer created by hand on a visible element never fired either.
 *
 * So the timer is cancelled from inside the observer's first callback — the only event that
 * proves the mechanism works — and if it fires first it latches `__boRevealOff`, after which this
 * component stops hiding anything for the rest of the session. Content is never behind an
 * observer that is not running.
 *
 * A MutationObserver picks up nodes React adds later (a filter re-render, "show more"), and the
 * pathname dependency re-scans on client navigation, where the DOM is replaced wholesale.
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
    const scan = () => {
      for (const el of document.querySelectorAll('[data-reveal]:not([data-shown])')) {
        if (seen.has(el)) continue;
        seen.add(el);
        io.observe(el);
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
