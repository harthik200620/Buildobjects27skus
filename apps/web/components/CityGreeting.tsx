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
 * IT IS A DOOR NOW, NOT A DISSOLVE. It used to hold for about two seconds and let itself out, and
 * any tap, key or scroll would end it early. It waits instead: the city says hello, and the reader
 * decides when to walk in. That is the whole point of the change — the store should not appear
 * behind a greeting nobody chose to leave.
 *
 * WHICH MAKES IT A DIALOG, and it has to be treated as one. A screen that waits for a click is
 * modal whether or not it says so: it takes the pointer, it takes the Tab key, and it has to be
 * announced and escapable. So `aria-hidden` is gone, the backdrop stops clicks reaching a store
 * the reader cannot see, focus starts and stays on the one control, and Escape does what the
 * button does — somebody signing in at a site office on a phone still has a reason to be in a
 * hurry, and a screen a person cannot get past is not premium however well it is set.
 */

/** The beats, in milliseconds from the moment the mark clears. */
const IN = 900;
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

  /*
   * The one control, and the keyboard around it.
   *
   * FOCUS GOES TO THE BUTTON and stays there. There is exactly one thing to do on this screen, so
   * the trap is a single line — Tab and Shift-Tab put focus back — rather than a ring of sentinel
   * nodes. Without it, Tab walks into a store the reader cannot see and cannot get back out of,
   * which is the specific way a modal built out of an overlay usually fails.
   *
   * ESCAPE IS THE WAY OUT. The button is the way in; a person who does not want the ceremony
   * should not have to find it with a mouse.
   */
  const go = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (phase !== 'showing') return;
    /* After the button's own entrance delay, so focus does not land on something mid-flight. */
    const focus = window.setTimeout(() => go.current?.focus({ preventScroll: true }), IN);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        leave();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        go.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focus);
      window.removeEventListener('keydown', onKey);
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
      role="dialog"
      aria-modal="true"
      aria-labelledby="greet-said greet-place greet-where"
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
        {/*
         * The two lines the screen exists to say, unchanged — the greeting at display size and the
         * city beneath it. They are the dialog's name between them (`aria-labelledby` takes a
         * list), so it is announced on arrival by being the label rather than by a live region
         * repeating it. `lang` so a screen reader speaks Telugu instead of spelling it out in the
         * page's language.
         */}
        <p className="greet-hello" id="greet-said" lang="te">
          {city.hello}
        </p>
        <p className="greet-city" id="greet-place" lang="te">
          {city.cityTe}
        </p>
        <span className="greet-rule" />
        <p className="greet-latin" id="greet-where">
          {city.city}
          <span className="greet-dot">·</span>
          {city.state}
        </p>

        {/* The door. Nothing else on this screen is interactive, and nothing happens until it is
            pressed — see the note at the top of this file. */}
        <button type="button" ref={go} className="greet-go" onClick={leave}>
          <span className="greet-go-word">Enter Build Objects World</span>
          <svg className="greet-go-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <path d="M4 12h15" />
            <path d="m13 6 6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
