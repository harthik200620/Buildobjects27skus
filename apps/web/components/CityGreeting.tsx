'use client';

import React from 'react';
import { consumeGreeting } from '@/lib/greet-session';
import type { CityGreeting as City } from '@/lib/greeting';
import { splash } from '@/lib/splash';

/**
 * The city's welcome, once, immediately after signing in: the photograph, నమస్కారం across it, and
 * the city beneath.
 *
 * IT IS ALREADY THERE WHEN THE MARK LIFTS, which is the whole trick and was wrong at first. The
 * greeting used to stay hidden until the splash had gone and then fade itself in — so a reader saw
 * the mark, then the store, then a greeting sliding over the store they had just been given, then
 * the store again. Reported as "first the page is opened and then the welcome comes".
 *
 * The splash is opaque and sits above this, so the fix is to become fully opaque UNDER it the
 * moment the photograph is decoded. The splash's own fade is then the only transition: it lifts
 * onto the greeting, never onto the store. The words wait for it to go before they move, watched
 * rather than timed, because a slow page holds the splash longer than any constant would guess.
 *
 * IT IS ALWAYS SKIPPABLE. A tap, a click or any key ends it immediately. A screen a person cannot
 * get past is not premium however well it is set, and somebody signing in at a site office on a
 * phone has a reason to be in a hurry.
 *
 * IT IS NOT A DIALOG. Nothing here is interactive except getting rid of it, and it is decorative
 * over content that is already there — so it is aria-hidden with a polite live region announcing
 * the greeting once, rather than a modal that traps focus for two seconds.
 */

/** The beats, in milliseconds from the moment the mark clears. */
const IN = 900;
const HOLD = 1900;
const OUT = 620;

/** Is the loading mark still covering the screen? */
const splashUp = () => document.getElementById('bo-splash')?.classList.contains('splash--on') === true;

export default function CityGreeting({ city }: { city: City | null }) {
  /*
   * idle    not armed — this device did not just sign in
   * armed   armed, photograph still decoding; nothing drawn, and the splash is covering anyway
   * ready   opaque, under the splash, waiting for it to lift
   * showing the splash has gone and the words are arriving
   * leaving fading out onto the store
   */
  const [phase, setPhase] = React.useState<'idle' | 'armed' | 'ready' | 'showing' | 'leaving' | 'done'>('idle');
  /* True only on the degraded path: the photograph took longer than the splash, so the greeting
     has to arrive over a store the reader can already see. It fades rather than appearing. */
  const [late, setLate] = React.useState(false);

  /*
   * Spend the ticket at mount, ONCE — the ref, not the dependency list, is what guarantees that.
   * React invokes an effect twice in development, and the second invocation would find a ticket
   * already spent, conclude there is nothing to show, and put the mark down while the first
   * invocation was still decoding the photograph.
   *
   * The ticket is spent even when the region has no photograph, so it cannot sit there and fire on
   * some later navigation that happens to mount this.
   */
  const spent = React.useRef(false);
  React.useEffect(() => {
    if (spent.current) return;
    spent.current = true;
    const region = consumeGreeting();
    if (region && city && region === city.regionId) {
      setPhase('armed');
      return;
    }
    /*
     * Nothing to show — no ticket, no photograph for this city, or storage refused. The front door
     * raised the mark on the way here and something has to put it down, or a shopper signing in
     * from Hyderabad would sit behind it until its failsafe fired.
     */
    splash().release();
  }, [city]);

  /* The photograph, decoded before anything is shown. A greeting that fades up on an empty frame
     and then snaps to a picture is worse than one that starts a beat later. */
  React.useEffect(() => {
    if (phase !== 'armed' || !city) return;
    const wide = new Image();
    const tall = new Image();
    let live = true;
    const both = [wide, tall].map((img, i) => {
      img.src = i === 0 ? city.wide : city.tall;
      return img.decode().catch(() => undefined);
    });
    /* Raced against a deadline: `decode()` on an image that never settles never settles either. */
    Promise.race([Promise.all(both), new Promise((r) => setTimeout(r, 2500))]).then(() => {
      if (!live) return;
      /* If the mark has already gone, the store is on screen and this has to arrive over it. */
      setLate(splashUp() === false);
      setPhase('ready');
      /* Opaque now, so the mark can finish its own sequence and lift onto this rather than onto
         the store. The mark holds its full minimum from when it was raised, so releasing early
         does not cut it short. */
      splash().release();
    });
    return () => {
      live = false;
    };
  }, [phase, city]);

  /* The words begin when the mark is down. */
  React.useEffect(() => {
    if (phase !== 'ready') return;
    const gone = () => !splashUp();
    if (gone()) {
      setPhase('showing');
      return;
    }
    const poll = window.setInterval(() => {
      if (gone()) {
        window.clearInterval(poll);
        window.clearTimeout(bail);
        setPhase('showing');
      }
    }, 80);
    /* The splash has its own failsafe; this is the greeting's. */
    const bail = window.setTimeout(() => {
      window.clearInterval(poll);
      setPhase('showing');
    }, 6000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(bail);
    };
  }, [phase]);

  const leave = React.useCallback(() => {
    setPhase((p) => (p === 'showing' ? 'leaving' : p));
  }, []);

  /* Its own clock, and any gesture that means "I have read it". */
  React.useEffect(() => {
    if (phase !== 'showing') return;
    const t = window.setTimeout(leave, IN + HOLD);
    for (const e of ['pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(e, leave, { passive: true });
    return () => {
      window.clearTimeout(t);
      for (const e of ['pointerdown', 'keydown', 'wheel'] as const) window.removeEventListener(e, leave);
    };
  }, [phase, leave]);

  React.useEffect(() => {
    if (phase !== 'leaving') return;
    const t = window.setTimeout(() => setPhase('done'), OUT);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (!city || phase === 'idle' || phase === 'done') return null;

  return (
    <div
      className="greet"
      data-phase={phase}
      data-late={late ? '' : undefined}
      aria-hidden="true"
      style={{ '--greet-in': `${IN}ms`, '--greet-out': `${OUT}ms` } as React.CSSProperties}
    >
      {/*
       * TWO CROPS, NOT ONE STRETCHED. The original is two and a third to one; covering a phone
       * with it means a 2.5x enlargement of a JPEG, which is soft in the one place this screen
       * cannot afford to be. `scripts/derive-greeting.mts` cuts a portrait version centred on the
       * gopuram, and the source order hands the browser whichever fits before it fetches anything.
       */}
      <picture className="greet-pic">
        <source media="(min-width: 720px)" type="image/webp" srcSet={city.wide} />
        <source media="(min-width: 720px)" srcSet={city.wide.replace('.webp', '.jpg')} />
        <source type="image/webp" srcSet={city.tall} />
        <img src={city.tall.replace('.webp', '.jpg')} alt="" decoding="async" />
      </picture>

      {/* The photograph's own light, carried down over the type so the words never sit on the
          brightest part of the frame. */}
      <div className="greet-scrim" />
      {/* The store's grain, the same fractal noise the page beneath uses, so the photograph and
          the store are the same surface rather than a picture pasted onto one. */}
      <div className="greet-grain" />

      <div className="greet-words">
        <p className="greet-hello">{city.hello}</p>
        <p className="greet-city">{city.cityTe}</p>
        <span className="greet-rule" />
        <p className="greet-latin">
          {city.city}
          <span className="greet-dot">·</span>
          {city.state}
        </p>
      </div>

      {/* Said once, for a reader who is not looking at it. */}
      <p className="greet-sr" role="status" aria-live="polite" aria-hidden={false}>
        {city.hello} {city.cityTe} — {city.city}, {city.state}
      </p>
    </div>
  );
}
