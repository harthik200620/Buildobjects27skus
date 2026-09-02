import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The product card opens the product when you click it — anywhere on it.
 *
 * THE BUG THIS GUARDS. A product card is a photograph, a title, a price and a CTA row, and the
 * whole rectangle is meant to be one link. It is built the standard way: an ordinary `<a>` around
 * the title, stretched over the card by `.prod-title a::after { position: absolute; inset: 0 }`,
 * so the link's accessible name stays the product's name. That trick rests on two conditions that
 * are invisible at the call site, and both had quietly stopped holding:
 *
 *   1. `.prod-card` must be the anchor's nearest POSITIONED ancestor. `.prod-body` and
 *      `.prod-title` had each acquired a `position: relative` that nothing used, and the nearest
 *      one wins — so `inset: 0` resolved against the title's own box, 165x45 of a 234x517 card.
 *   2. Nothing in between may out-STACK it. `.prod-media img` sits at z-index 2, and the media box
 *      created no stacking context, so the photograph painted over the link.
 *
 *   Together: clicking the picture of the product did nothing, which is the one gesture every
 *   shopper makes. `elementFromPoint` over the photograph returned the IMG, not the anchor.
 *
 * WHY A STYLESHEET TEST. Neither condition is visible in ProductCard.tsx — the markup was correct
 * throughout — and neither breaks a render, a type or a snapshot. A `position: relative` added to
 * `.prod-body` for some unrelated reason silently turns the whole catalogue into dead cards, and
 * the only signal is a human clicking one. So the assertions are about the CSS, because the CSS is
 * where the defect lives.
 */
const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'store.css'), 'utf8');

/** The declarations of one top-level rule in store.css, by exact selector. */
function ruleBody(selector: string): string {
  const at = css.indexOf(`\n  ${selector} {`);
  expect(at, `${selector} is not a rule in store.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  const close = css.indexOf('\n  }', open);
  return css.slice(open + 1, close);
}

/** `position: relative`, ignoring any that only appears inside a comment. */
const declaresRelative = (body: string) => /(^|;|\n)\s*position:\s*relative\s*;/.test(body.replace(/\/\*[\s\S]*?\*\//g, ''));

describe('the stretched link that makes a product card clickable', () => {
  it('still exists, and still covers the whole card', () => {
    const body = ruleBody('.prod-title a::after');
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset:\s*0/);
  });

  it('has .prod-card as its positioning root', () => {
    expect(declaresRelative(ruleBody('.prod-card'))).toBe(true);
  });

  it.each(['.prod-body', '.prod-title'])('%s does not position itself, which would shrink the link to that box', (selector) => {
    expect(declaresRelative(ruleBody(selector))).toBe(false);
  });

  it('isolates the photograph, so its z-index cannot paint over the link', () => {
    expect(ruleBody('.prod-media')).toMatch(/isolation:\s*isolate/);
  });

  it('keeps the CTA row above the link, so its buttons stay clickable', () => {
    const body = ruleBody('.prod-cta');
    expect(declaresRelative(body)).toBe(true);
    expect(body).toMatch(/z-index:\s*[1-9]/);
  });
});
