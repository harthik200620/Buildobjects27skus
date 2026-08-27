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
 *
 * ── The second job: photographs arriving ─────────────────────────────────────
 *
 * The same scan marks lazily-loaded images `data-ready` once they have actually decoded, which
 * is what the fade in theme.css transitions on. It lives here rather than in a component of its
 * own because this is already the one place in the store that watches the DOM for new nodes —
 * a second always-mounted client component, a second MutationObserver over document.body, to
 * flip one attribute would be the same work twice.
 *
 * Only `loading="lazy"` images are touched. An eager one is above the fold and is very often the
 * page's largest contentful paint; starting it at opacity 0 would push the store's own LCP out
 * by the length of the fade, which is paying in the one number that matters for an effect nobody
 * asked for. See the note in theme.css.
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
