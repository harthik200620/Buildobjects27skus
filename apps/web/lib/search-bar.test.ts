import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The search bar draws ONE box, and it draws it on the field.
 *
 * THE BUG THIS GUARDS. theme.css gives every focusable a `box-shadow: var(--ring-focus)` and its
 * own `border-radius`. That is right for a bare control and wrong for an input sitting inside a
 * field that already rings itself: focusing the bar drew a second rounded rectangle INSIDE the
 * first. `.search-input:focus { outline: none }` had been written to stop it and could not — the
 * global rule paints with box-shadow, not outline.
 *
 * The two halves have to move together, and each is useless alone:
 *   - the input must cancel BOTH outline and box-shadow, or the inner rectangle comes back;
 *   - the field must paint a ring on :focus-within, or cancelling the input's leaves a keyboard
 *     user with no focus indicator at all — a worse defect than the one being fixed.
 *
 * scripts/sweep.mts now accepts a ring on an ancestor, which is what makes this pair legal. That
 * concession is only safe while the ancestor really does ring, so the second assertion here is
 * what the sweep's leniency rests on.
 */
const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'store.css'), 'utf8');

function ruleBody(selector: string): string {
  const at = css.indexOf(`\n  ${selector} {`);
  expect(at, `${selector} is not a rule in store.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('\n  }', open));
}

describe('the search field, focused', () => {
  it('cancels the global ring on the input, outline AND box-shadow', () => {
    const body = ruleBody('.search-input:focus,\n  .search-input:focus-visible');
    expect(body).toMatch(/outline:\s*none/);
    expect(body).toMatch(/box-shadow:\s*none/);
  });

  it('paints the ring on the field instead, so focus is still visible', () => {
    const body = ruleBody('.search-field:focus-within');
    expect(body).toMatch(/box-shadow:\s*[^;]*\S/);
    expect(body).not.toMatch(/box-shadow:\s*none/);
    expect(body).toMatch(/border-color:/);
  });
});
