import { SPLASH_FADE_MS, SPLASH_SEQUENCE_MS } from './splash-timing';

/**
 * When the loading overlay shows and when it lets go, as one small state machine.
 *
 * WHO CALLS IT. Two client components, both of which render nothing:
 *   · SplashSensor, rendered by every loading.tsx. Mounting means a route is pending — so `hold`;
 *     unmounting means its content has replaced it — so `release`.
 *   · SplashController, once in the root layout. It runs `settle` on hydration: on a hard load the
 *     overlay has been painting since the first frame with no sensor to speak for it, and either a
 *     sensor is holding it by then or the page is already there and it can go. It also turns a
 *     click on any internal link into `depart`, and the URL changing into `arrive` — because a page
 *     the router already has in its cache mounts no loading boundary at all, and the reader asked
 *     for the sequence on every page, cached or not.
 *
 * WHY A COUNT. Two holds can overlap — a navigation started while the previous one's content is
 * still arriving — and the overlay must stay until the LAST one lets go, not the first.
 *
 * WHY A MINIMUM. The animation is the point. A route that resolves in 80 ms would otherwise show
 * the star igniting and nothing else, so the overlay stays for the whole sequence from the moment
 * it started showing — which on a hard load is the document's first paint, not hydration. Under
 * prefers-reduced-motion the sequence is already collapsed to its final frame by theme.css, and
 * the minimum collapses with it: the overlay is then a plain "loading" state that goes the instant
 * the page can.
 *
 * WHY A FACTORY. Everything that touches the browser comes in through `io`, so lib/splash.test.ts
 * can drive the machine with a fake clock and a fake element and check the ordering that matters:
 * a hold placed after a release cancels the pending fade; a hard load waits from first paint, not
 * from now; the same DOM element is restarted, not duplicated.
 */
export type SplashIO = {
  /** The overlay element, or null before it exists. */
  el(): HTMLElement | null;
  /** performance.now(). */
  now(): number;
  /** When the document first painted, on this same clock; 0 if unknown. */
  firstPaint(): number;
  reducedMotion(): boolean;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

export const SPLASH_ID = 'bo-splash';
const ON = 'splash--on';
const OUT = 'splash--out';

export function createSplash(io: SplashIO) {
  let holds = 0;
  /** When the current showing began, on io.now()'s clock; 0 means "since the document painted". */
  let shownAt = 0;
  let hideTimer = 0;
  let fadeTimer = 0;

  const cancel = () => {
    io.clearTimeout(hideTimer);
    io.clearTimeout(fadeTimer);
    hideTimer = fadeTimer = 0;
  };

  const scheduleHide = () => {
    const el = io.el();
    if (!el?.classList.contains(ON)) return;
    cancel();
    const minimum = io.reducedMotion() ? 0 : SPLASH_SEQUENCE_MS;
    const since = shownAt || io.firstPaint();
    hideTimer = io.setTimeout(
      () => {
        el.classList.add(OUT);
        fadeTimer = io.setTimeout(() => {
          el.classList.remove(ON, OUT);
          shownAt = 0;
        }, SPLASH_FADE_MS);
      },
      Math.max(0, since + minimum - io.now()),
    );
  };

  /* A click on a link is a hold of its own, so that a navigation whose page is already in the
     router's cache — where no loading boundary ever mounts — still plays the sequence. */
  let travelling = false;
  let travelTimer = 0;

  return {
    /** A route started loading. */
    hold() {
      holds += 1;
      cancel();
      const el = io.el();
      if (!el) return;
      if (el.classList.contains(ON) && !el.classList.contains(OUT)) return;
      /* Removing and re-adding the class restarts every keyframe on it; the reflow between is
         what makes the browser see two changes rather than none. */
      el.classList.remove(ON, OUT);
      void el.offsetWidth;
      el.classList.add(ON);
      shownAt = io.now();
    },
    /** Its content arrived. */
    release() {
      holds = Math.max(0, holds - 1);
      if (!holds) scheduleHide();
    },
    /** Hydration: let the overlay go unless something is holding it. */
    settle() {
      if (!holds) scheduleHide();
    },
    /** The reader clicked a link to another page. One hold at a time, released by `arrive`. */
    depart() {
      if (travelling) return;
      travelling = true;
      this.hold();
      /* A click the router never acted on — a link that was prevented, a URL that did not change —
         must not hold the overlay forever. The CSS failsafe is the last line; this is the first. */
      travelTimer = io.setTimeout(() => this.arrive(), 6000);
    },
    /** The URL changed: whatever the click started has landed. */
    arrive() {
      if (!travelling) return;
      travelling = false;
      io.clearTimeout(travelTimer);
      this.release();
    },
    /** For tests. */
    get holds() {
      return holds;
    },
  };
}

export type Splash = ReturnType<typeof createSplash>;

let live: Splash | undefined;

/** The one instance the page runs, built against the real browser on first use. */
export function splash(): Splash {
  live ??= createSplash({
    el: () => document.getElementById(SPLASH_ID),
    now: () => performance.now(),
    firstPaint: () => performance.getEntriesByType('paint').find((e) => e.name === 'first-paint' || e.name === 'first-contentful-paint')?.startTime ?? 0,
    reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  });
  return live;
}
