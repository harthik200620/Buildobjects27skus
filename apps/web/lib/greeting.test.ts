import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { armGreeting, consumeGreeting } from './greet-session';
import { GREETINGS, greetingFor } from './greeting';

/**
 * The city greeting after sign-in.
 *
 * The two things that can go wrong here are both silent. A ticket that is not spent means the
 * greeting replays on some later navigation, over a page it has nothing to do with. And a city
 * listed without its photograph — or with a path that does not resolve — means a signed-in shopper
 * gets a black screen for three seconds with no error anywhere, because a missing background image
 * is not an exception.
 */
function fakeSession() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', fakeSession());
});

describe('the ticket', () => {
  it('is spent on the first read and gone on the second', () => {
    armGreeting('tpt');
    expect(consumeGreeting()).toBe('tpt');
    expect(consumeGreeting()).toBeNull();
  });

  it('is nothing when nobody has signed in', () => {
    expect(consumeGreeting()).toBeNull();
  });

  it('keeps only the latest sign-in', () => {
    armGreeting('hyd');
    armGreeting('tpt');
    expect(consumeGreeting()).toBe('tpt');
  });

  /* A browser with storage disabled must sign in normally, just without the greeting. */
  it('does not throw when storage refuses', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage);
    expect(() => armGreeting('tpt')).not.toThrow();
    expect(consumeGreeting()).toBeNull();
  });
});

describe('which cities greet', () => {
  it('greets Tirupati and nowhere else', () => {
    expect(greetingFor('tpt')?.city).toBe('Tirupati');
    for (const other of ['hyd', 'vij', 'vizag', '', null, undefined]) expect(greetingFor(other)).toBeNull();
  });

  it('names a region the store actually serves', () => {
    const data = fs.readFileSync(path.join(__dirname, 'data.ts'), 'utf8');
    for (const g of GREETINGS) expect(data, `no region '${g.regionId}' in lib/data.ts`).toContain(`region_id: '${g.regionId}'`);
  });

  it('is written in Telugu, not transliterated into Latin', () => {
    /* U+0C00–U+0C7F. A greeting spelled "Namaskaram" in Latin letters would pass every other
       check here and be the wrong thing on the screen. */
    for (const g of GREETINGS) {
      expect(g.hello, `${g.city}'s greeting is not Telugu`).toMatch(/^[ఀ-౿\s]+$/);
      expect(g.cityTe, `${g.city} in Telugu is not Telugu`).toMatch(/^[ఀ-౿\s]+$/);
    }
  });

  it('has both photographs on disk, in both formats', () => {
    for (const g of GREETINGS)
      for (const src of [g.wide, g.tall, g.wide.replace('.webp', '.jpg'), g.tall.replace('.webp', '.jpg')]) {
        const file = path.join(__dirname, '..', 'public', src.replace(/^\//, ''));
        expect(fs.existsSync(file), `${src} is referenced but not on disk`).toBe(true);
        expect(fs.statSync(file).size, `${src} is empty`).toBeGreaterThan(1024);
      }
  });

  it('describes the photograph for a reader who cannot see it', () => {
    for (const g of GREETINGS) expect(g.alt.length).toBeGreaterThan(30);
  });
});

/*
 * The Telugu face. It is the only reason the greeting reads as Telugu rather than as whatever the
 * device happens to have, and it is the one part of this that is a build artefact rather than
 * source — so it is checked as one.
 */
describe('the Telugu face', () => {
  const font = path.join(__dirname, '..', 'public', 'fonts', 'BuildObjectsTelugu-Variable.woff2');

  it('ships', () => {
    expect(fs.existsSync(font), 'run: pnpm fonts:fetch && pnpm fonts:subset').toBe(true);
  });

  /*
   * Cut to its own script. Given the app-wide character set it carried a second copy of a Latin
   * alphabet four other faces already draw, and this ceiling is what stops that coming back.
   *
   * It is 94 KB rather than the 22 KB of the first attempt, and the difference is the conjuncts:
   * that cut had no GSUB at all, so it was small the way an unreadable thing is small. The whole
   * Telugu block is kept rather than only the letters today's two words need, so that adding a
   * city tomorrow cannot silently produce a missing glyph. It is never preloaded — see layout.tsx.
   */
  it('is cut to its own script, not given the whole app character set', () => {
    expect(fs.statSync(font).size).toBeLessThan(110 * 1024);
  });

  it('is not preloaded — it sets two words on one screen', () => {
    const layout = fs.readFileSync(path.join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');
    const block = layout.slice(layout.indexOf('const telugu'), layout.indexOf('export const metadata'));
    expect(block).toContain('preload: false');
  });

  it('is what the greeting is actually set in', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'styles', 'greeting.css'), 'utf8');
    for (const rule of ['.greet-hello', '.greet-city']) {
      const at = css.indexOf(`  ${rule} {`);
      expect(at, `${rule} is not in greeting.css`).toBeGreaterThan(-1);
      expect(css.slice(at, css.indexOf('\n  }', at))).toContain('font-family: var(--font-telugu)');
    }
  });

  it('falls back to a Telugu face the device has, never to a Latin one', () => {
    const theme = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'ui', 'src', 'theme.css'), 'utf8');
    const line = theme.split('\n').find((l) => l.trim().startsWith('--font-telugu:')) ?? '';
    for (const face of ['Noto Serif Telugu', 'Nirmala UI', 'Kohinoor Telugu']) expect(line).toContain(face);
  });
});

describe('greeting.css keeps the screen escapable and legible', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'styles', 'greeting.css'), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`  ${selector} {`);
    expect(at, `${selector} is not in greeting.css`).toBeGreaterThan(-1);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('\n  }', at));
  };

  /*
   * IT NOW TAKES THE POINTER, AND THAT IS THE CHANGE. This asserted `pointer-events: none` for as
   * long as the screen let itself out after two seconds and nothing on it could be clicked. It
   * waits for a button now, so a click that fell through would land on a store the reader has not
   * been shown — a link followed by accident, over an opaque screen. Blocking is the correct
   * behaviour for a modal, and the property worth holding is the one below it: exactly one thing
   * on the screen can be clicked.
   */
  it('blocks the store behind it while it waits', () => {
    expect(rule('.greet')).toMatch(/pointer-events:\s*auto/);
  });

  it('swallows nothing while it is hidden — the armed phase sits over a live store', () => {
    const at = css.indexOf('.greet[data-phase="armed"],');
    expect(at, 'no rule releases the pointer while the greeting is hidden').toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf('}', at))).toMatch(/pointer-events:\s*none/);
  });

  it('has exactly one control, and it is the button', () => {
    const interactive = css.match(/^\s{2}\.greet-[\w-]+\s*\{[^}]*cursor:\s*pointer/gm) ?? [];
    expect(interactive).toHaveLength(1);
    expect(interactive[0]).toContain('.greet-go');
  });

  /*
   * The door's own rules. It is the only thing between a signed-in shopper and the store, so a
   * change that makes it invisible, unreachable or too small to hit is a change that strands
   * them on a photograph.
   */
  it('the door is big enough to hit', () => {
    /* The sweep gate holds tap targets to 44; this is the one control on the screen. */
    expect(Number(rule('.greet-go').match(/min-height:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(44);
  });

  it('the door can be clicked, though the backdrop around it is inert to the store', () => {
    expect(rule('.greet-go')).toMatch(/pointer-events:\s*auto/);
  });

  /*
   * THE GLOW IS A BOX-SHADOW, NOT A BLURRED LAYER, and this holds it there.
   *
   * The first version was a blurred `::before` at `z-index: -1`, which reads as "behind the
   * button" and is not: an element's own background paints before its negative-z-index children,
   * so the halo was laid across the FACE of the pill and the white label measured 1.66:1 against
   * it. A box-shadow is painted outside the border box by definition and cannot do that — so the
   * mechanism is the assertion, because the mechanism is what was wrong.
   */
  it('the door glows outside its own edge, never across it', () => {
    const go = rule('.greet-go');
    expect(go).toMatch(/box-shadow:/);
    expect(go).toContain('greet-breathe');
    /* 86 211 216 is --teal-700 — the hue of the city's name and the rule above it. Nothing on
       this screen introduces a colour the photograph did not already carry. */
    expect(go).toContain('rgb(86 211 216');
    expect(css.slice(css.indexOf('  .greet-go {'), css.indexOf('  .greet-go:hover'))).not.toContain('filter: blur');
  });

  /*
   * theme.css collapses every duration to nothing under prefers-reduced-motion, so an animation's
   * LAST keyframe is what a reader who asked for no motion is left looking at. For a pulse that
   * has to be the calm frame, not the peak — otherwise the button sits permanently at its
   * brightest, which is the one state it was never meant to hold.
   */
  it('the glow settles calm rather than at its peak when motion is off', () => {
    const at = css.indexOf('@keyframes greet-breathe');
    const frames = css.slice(at, css.indexOf('.greet-go:hover', at));
    /* The widest blur radius in each frame is how bright the halo is at that moment. */
    const widest = (frame: string) => Math.max(...[...frame.matchAll(/0 0 (\d+)px rgb/g)].map((m) => Number(m[1])));
    const first = widest(frames.slice(frames.indexOf('0% {'), frames.indexOf('50% {')));
    const peak = widest(frames.slice(frames.indexOf('50% {'), frames.indexOf('100% {')));
    const last = widest(frames.slice(frames.indexOf('100% {')));
    expect(last).toBe(first);
    expect(peak).toBeGreaterThan(last);
  });

  it('the door takes the store voice, at the one weight Audiowide has', () => {
    const go = rule('.greet-go');
    expect(go).toContain('font-family: var(--font-brand)');
    /* Audiowide ships one cut; anything else is a browser-synthesised bold, which type:audit
       fails and which renders smeared. */
    expect(go).toMatch(/font-weight:\s*400/);
  });

  /*
   * The ordering bug, as a test. The greeting has to be OPAQUE while the mark is still up, so the
   * mark lifts onto it; the first version stayed hidden until the mark had gone and then faded
   * itself in over the store, which is the store being shown and then covered again.
   */
  it('is fully opaque before the mark lifts, so the mark never reveals the store', () => {
    /* The rule is written over two selectors, so it is found by where it starts rather than by an
       exact multi-line string. */
    const at = css.indexOf('.greet[data-phase="ready"]');
    expect(at, 'no rule makes the greeting opaque before the mark lifts').toBeGreaterThan(-1);
    const ready = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    expect(ready).toMatch(/opacity:\s*1/);
    expect(ready).toMatch(/visibility:\s*visible/);
    /* And no entrance fade on the element itself — the mark's own fade is the transition. */
    expect(css).not.toContain('greet-enter');
  });

  it('sits under the loading mark, so the two play in sequence and not on top of each other', () => {
    const mine = Number(rule('.greet').match(/z-index:\s*(\d+)/)?.[1]);
    const splash = fs.readFileSync(path.join(__dirname, '..', 'app', 'styles', 'splash.css'), 'utf8');
    const theirs = Number(splash.match(/z-index:\s*(\d+)/)?.[1]);
    expect(mine).toBeLessThan(theirs);
  });

  it('is the biggest type in the store, which is the whole point of it', () => {
    const hello = rule('.greet-hello');
    const max = Number(hello.match(/font-size:\s*clamp\([^,]+,[^,]+,\s*([\d.]+)rem\)/)?.[1]);
    expect(max).toBeGreaterThan(8);
    /* And it fills a narrow frame too, rather than being a desktop-only flourish. */
    expect(hello).toMatch(/clamp\(\s*[\d.]+rem,\s*[\d.]+vw/);
  });

  it('carries the photograph down into the store own canvas behind the words', () => {
    expect(rule('.greet-scrim')).toContain('var(--color-canvas)');
  });
});
