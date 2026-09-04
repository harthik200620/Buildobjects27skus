import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSplash, type SplashIO } from './splash';
import { SPLASH_FADE_MS, SPLASH_SEQUENCE_MS } from './splash-timing';

/**
 * The loading overlay: when it shows, how long it insists on staying, and when it lets go.
 *
 * The state machine in lib/splash.ts is driven here with a fake clock and a fake element, because
 * the things that go wrong with an overlay like this are all about ORDER — a hold arriving after
 * a release, hydration landing before or after the sequence has finished, React's development
 * double-mount — and none of them can be seen in a browser without a stopwatch.
 */
function rig(opts: { on?: boolean; now?: number; firstPaint?: number; reduced?: boolean } = {}) {
  const classes = new Set<string>(opts.on === false ? [] : ['splash', 'splash--on']);
  const log: string[] = [];
  let now = opts.now ?? 0;
  let timers: { id: number; at: number; fn: () => void }[] = [];
  let seq = 0;
  const el = {
    classList: {
      contains: (c: string) => classes.has(c),
      add: (...cs: string[]) => {
        for (const c of cs) {
          classes.add(c);
          log.push(`+${c}`);
        }
      },
      remove: (...cs: string[]) => {
        for (const c of cs) {
          if (classes.delete(c)) log.push(`-${c}`);
        }
      },
    },
    get offsetWidth() {
      log.push('reflow');
      return 1;
    },
  } as unknown as HTMLElement;
  const io: SplashIO = {
    el: () => el,
    now: () => now,
    firstPaint: () => opts.firstPaint ?? 0,
    reducedMotion: () => opts.reduced ?? false,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  };
  /** Move the clock, firing whatever comes due on the way. */
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      timers = timers.filter((t) => t.id !== next.id);
      next.fn();
    }
    now = until;
  };
  return {
    splash: createSplash(io),
    classes,
    log,
    advance,
    pending: () => timers.length,
    on: () => classes.has('splash--on'),
    out: () => classes.has('splash--out'),
  };
}

describe('the overlay on a hard load', () => {
  it('stays for the whole sequence, counted from the first paint, then fades and goes', () => {
    const r = rig({ firstPaint: 120, now: 600 });
    r.splash.settle();
    r.advance(120 + SPLASH_SEQUENCE_MS - 600 - 1);
    expect(r.on()).toBe(true);
    expect(r.out()).toBe(false);
    r.advance(1);
    expect(r.out()).toBe(true);
    r.advance(SPLASH_FADE_MS);
    expect(r.on()).toBe(false);
    expect(r.out()).toBe(false);
  });

  it('goes at once when hydration lands after the sequence has already played', () => {
    const r = rig({ firstPaint: 0, now: SPLASH_SEQUENCE_MS + 900 });
    r.splash.settle();
    r.advance(0);
    expect(r.out()).toBe(true);
  });

  it('is held by a route still pending at hydration, and released when that route lands', () => {
    const r = rig({ firstPaint: 100, now: 400 });
    r.splash.hold(); // the loading boundary's sensor, whose effect runs before the controller's
    r.splash.settle();
    expect(r.pending()).toBe(0);
    r.advance(5000);
    expect(r.on()).toBe(true);
    r.splash.release();
    r.advance(0);
    expect(r.out()).toBe(true); // 5400 is past 100 + the sequence
  });

  it('does not restart the keyframes already running since the first paint', () => {
    const r = rig({ now: 300 });
    r.splash.hold();
    expect(r.log).toEqual([]);
  });

  it('has no minimum under reduced motion, where there is no sequence to protect', () => {
    const r = rig({ firstPaint: 100, now: 300, reduced: true });
    r.splash.settle();
    r.advance(0);
    expect(r.out()).toBe(true);
  });
});

describe('the overlay on a client navigation', () => {
  it('shows again with its keyframes restarted, and stays a full sequence from that moment', () => {
    const r = rig({ on: false, now: 5000 });
    r.splash.hold();
    expect(r.log).toEqual(['reflow', '+splash--on']);
    expect(r.on()).toBe(true);
    r.advance(100);
    r.splash.release();
    r.advance(SPLASH_SEQUENCE_MS - 100 - 1);
    expect(r.out()).toBe(false);
    r.advance(1);
    expect(r.out()).toBe(true);
  });

  it('is kept by a second navigation that starts while the first is still pending', () => {
    const r = rig({ on: false, now: 5000 });
    r.splash.hold();
    r.splash.hold();
    r.splash.release();
    r.advance(10_000);
    expect(r.on()).toBe(true);
    expect(r.out()).toBe(false);
    r.splash.release();
    r.advance(0);
    expect(r.out()).toBe(true);
  });

  it('cancels a pending fade when a new navigation starts before it fires', () => {
    const r = rig({ on: false, now: 5000 });
    r.splash.hold();
    r.splash.release();
    expect(r.pending()).toBe(1);
    r.splash.hold();
    expect(r.pending()).toBe(0);
    expect(r.on()).toBe(true);
    /* Already on, not fading: nothing to restart. */
    expect(r.log.filter((l) => l === 'reflow')).toHaveLength(1);
  });

  it('restarts the sequence if a navigation starts during the fade-out', () => {
    const r = rig({ on: false, now: 5000 });
    r.splash.hold();
    r.splash.release();
    r.advance(SPLASH_SEQUENCE_MS);
    expect(r.out()).toBe(true);
    r.advance(100);
    r.splash.hold();
    expect(r.out()).toBe(false);
    expect(r.on()).toBe(true);
    expect(r.log.slice(-3)).toEqual(['-splash--out', 'reflow', '+splash--on']);
  });

  it('survives development double-mounting: hold, release, hold leaves one hold and nothing pending', () => {
    const r = rig({ on: false, now: 5000 });
    r.splash.hold();
    r.splash.release();
    r.splash.hold();
    expect(r.splash.holds).toBe(1);
    expect(r.pending()).toBe(0);
  });

  it('never counts below zero', () => {
    const r = rig({ on: false });
    r.splash.release();
    r.splash.release();
    expect(r.splash.holds).toBe(0);
  });
});

describe('the overlay on a click', () => {
  it('holds from the click and lets go a full sequence later, once the URL has changed', () => {
    const r = rig({ on: false, now: 5000 });
    r.splash.depart();
    expect(r.on()).toBe(true);
    r.advance(200);
    r.splash.arrive();
    r.advance(SPLASH_SEQUENCE_MS - 200 - 1);
    expect(r.out()).toBe(false);
    r.advance(1);
    expect(r.out()).toBe(true);
  });

  it('is one hold however many clicks land before the page does', () => {
    const r = rig({ on: false });
    r.splash.depart();
    r.splash.depart();
    expect(r.splash.holds).toBe(1);
    r.splash.arrive();
    expect(r.splash.holds).toBe(0);
  });

  it('shares the count with a pending route, and the last of the two lets go', () => {
    const r = rig({ on: false, now: 5000 });
    r.splash.hold();
    r.splash.depart();
    expect(r.splash.holds).toBe(2);
    r.splash.release();
    expect(r.splash.holds).toBe(1);
    r.advance(3000);
    expect(r.on() && !r.out()).toBe(true);
    r.splash.arrive();
    r.advance(0);
    expect(r.out()).toBe(true);
  });

  it('lets go on its own if the URL never changes', () => {
    const r = rig({ on: false, now: 5000 });
    r.splash.depart();
    r.advance(6000);
    expect(r.out()).toBe(true);
  });

  it('ignores an arrival nothing departed for', () => {
    const r = rig({ on: false });
    r.splash.arrive();
    expect(r.on()).toBe(false);
    expect(r.pending()).toBe(0);
  });
});

/*
 * The stylesheet's side of the contract. theme.css collapses every animation to its final frame
 * under prefers-reduced-motion, so each set of keyframes MUST end on the settled picture — the
 * mark lit and still, nothing in flight — or a reduced-motion reader gets a half-drawn logo.
 */
const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'styles', 'splash.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function keyframes(name: string): string {
  const at = css.indexOf(`@keyframes ${name} {`);
  expect(at, `@keyframes ${name} is not in splash.css`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`unterminated @keyframes ${name}`);
}
/** The declarations of the frame that includes 100% (or `to`). */
function lastFrame(name: string): string {
  const block = keyframes(name);
  const m = block.match(/(?:^|\n)\s*(?:[\d.]+%,\s*)*(?:100%|to)\s*\{([^}]*)\}/);
  expect(m, `${name} has no 100% frame`).not.toBeNull();
  return m?.[1] ?? '';
}
function rule(selector: string): string {
  const at = css.indexOf(`\n  ${selector} {`);
  expect(at, `${selector} is not a rule in splash.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('\n  }', open));
}

describe('splash.css ends every sequence on the settled picture', () => {
  it.each(['splash-draw', 'splash-draw-inner'])('%s finishes with the bowl fully drawn', (name) => {
    expect(lastFrame(name)).toMatch(/stroke-dashoffset:\s*0\s*;/);
  });
  it.each(['splash-stem-mid', 'splash-stem-side', 'splash-ghost'])('%s finishes visible', (name) => {
    expect(lastFrame(name)).toMatch(/opacity:\s*1\s*;/);
  });
  it.each(['splash-stem-mid', 'splash-stem-side', 'splash-bowl'])('%s finishes in the brand teal, not white-hot', (name) => {
    expect(lastFrame(name)).toMatch(/fill:\s*var\(--teal-700\)\s*;/);
  });
  it.each(['splash-beam', 'splash-beam-halo', 'splash-head', 'splash-sweep'])('%s finishes with the light gone', (name) => {
    expect(lastFrame(name)).toMatch(/opacity:\s*0\s*;/);
  });
  it('breathes back to where it started, so a single collapsed cycle changes nothing', () => {
    const block = keyframes('splash-breathe');
    const first = block.match(/0%[^{]*\{([^}]*)\}/)?.[1];
    expect(first).toMatch(/opacity:\s*1\s*;/);
    expect(lastFrame('splash-breathe')).toMatch(/opacity:\s*1\s*;/);
  });
});

describe('splash.css can play the sequence more than once', () => {
  /*
   * THE BUG THIS GUARDS, which shipped. Every animation was declared on the element that runs it
   * — `.splash-beam { animation: splash-beam … }` — so all of them started when the document was
   * parsed, ran once and finished. Showing the overlay again for a client-side navigation puts
   * `.splash--on` back on the CONTAINER and says nothing to the children, whose animations were
   * long over. The reader clicked a link and got the settled mark: no star, no beam, no drawing.
   *
   * A declaration that arrives with a class is cancelled when the class goes and created afresh
   * when it returns, which is a restart. So every animation of the sequence must be reachable
   * only through `.splash--on`, and that is what this asserts — by name, from the stylesheet, so
   * that moving one back onto its element fails here rather than in front of a customer.
   */
  /** Every rule in the file, as [selector, declarations], ignoring @keyframes' own frames. */
  const rules: [string, string][] = [];
  {
    const withoutKeyframes = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    for (const m of withoutKeyframes.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push([m[1].trim(), m[2]]);
  }

  /** The animation names one rule sets, whether by shorthand or by `animation-name`. */
  function namesIn(decls: string): string[] {
    const out: string[] = [];
    for (const m of decls.matchAll(/animation(?:-name)?\s*:([^;]+);/g)) for (const n of m[1].matchAll(/splash-[a-z-]+/g)) out.push(n[0]);
    return out;
  }

  /* Everything the sequence is made of. The failsafe and the reduced-motion appearance are NOT
     here: they belong to the overlay itself, which is the element the class is on. */
  const SEQUENCE = [
    'splash-beam',
    'splash-beam-halo',
    'splash-ghost',
    'splash-stem-side',
    'splash-stem-mid',
    'splash-bowl',
    'splash-draw',
    'splash-draw-inner',
    'splash-bloom-stems',
    'splash-bloom-bowl',
    'splash-breathe',
    'splash-head',
    'splash-sweep',
    'splash-star-core',
    'splash-star-halo',
    'splash-twinkle',
  ];

  it.each(SEQUENCE)('%s is only ever run from a rule scoped to .splash--on', (name) => {
    const carriers = rules.filter(([, decls]) => namesIn(decls).includes(name));
    expect(carriers.length, `${name} is declared nowhere`).toBeGreaterThan(0);
    for (const [selector] of carriers) expect(selector, `${selector} runs ${name} without .splash--on, so it can only ever play once`).toContain('.splash--on');
  });

  it('has a keyframes block for every animation it names', () => {
    for (const name of SEQUENCE) expect(css, `@keyframes ${name} is missing`).toContain(`@keyframes ${name} {`);
  });

  it('leaves the failsafe on the overlay itself, where a class change restarts it anyway', () => {
    for (const [selector, decls] of rules) {
      if (!namesIn(decls).includes('splash-failsafe')) continue;
      expect(selector).toContain('.splash--on');
    }
  });
});

describe('splash.css keeps the page reachable', () => {
  it('lets the overlay go on its own if no script ever arrives', () => {
    const on = rule('.splash--on');
    expect(on).toMatch(/animation:\s*splash-failsafe\s+1ms\s+linear\s+calc\(var\(--splash-seq\)\s*\+\s*\d+ms\)\s+forwards/);
    expect(lastFrame('splash-failsafe')).toMatch(/visibility:\s*hidden/);
    expect(lastFrame('splash-failsafe')).toMatch(/pointer-events:\s*none/);
  });
  it('is hidden and inert by default, so a page without the class never has an overlay', () => {
    const base = rule('.splash');
    expect(base).toMatch(/visibility:\s*hidden/);
    expect(base).toMatch(/pointer-events:\s*none/);
  });
  it('sits above everything else the store stacks', () => {
    const mine = Number(rule('.splash').match(/z-index:\s*(\d+)/)?.[1]);
    const dirs = [path.join(__dirname, '..', 'app'), path.join(__dirname, '..', '..', '..', 'packages', 'ui', 'src')];
    let top = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.css') && entry.name !== 'splash.css')
          for (const m of fs.readFileSync(p, 'utf8').matchAll(/z-index:\s*(\d+)/g)) top = Math.max(top, Number(m[1]));
      }
    };
    for (const d of dirs) walk(d);
    expect(mine).toBeGreaterThan(top);
  });
  it('is imported by globals.css', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8')).toContain('./styles/splash.css');
  });
});
