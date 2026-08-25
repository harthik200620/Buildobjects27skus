import { describe, expect, it } from 'vitest';
import { parseHighlight } from '@/components/Highlight';

/**
 * This parser is a security boundary: it exists so Meilisearch's `_formatted` output never
 * reaches the DOM as raw HTML. The cases that matter are the hostile ones — a product name
 * containing markup must come back as *text*, so React escapes it on render.
 */
describe('parseHighlight', () => {
  it('splits a match out of the surrounding text', () => {
    expect(parseHighlight('UltraTech <mark class="hl">PPC</mark> Cement')).toEqual([
      { text: 'UltraTech ', match: false },
      { text: 'PPC', match: true },
      { text: ' Cement', match: false },
    ]);
  });

  it('handles a match at the very start and the very end', () => {
    expect(parseHighlight('<mark class="hl">ACC</mark> cement')).toEqual([
      { text: 'ACC', match: true },
      { text: ' cement', match: false },
    ]);
    expect(parseHighlight('cement <mark class="hl">bag</mark>')).toEqual([
      { text: 'cement ', match: false },
      { text: 'bag', match: true },
    ]);
  });

  it('handles several matches in one field', () => {
    expect(parseHighlight('<mark class="hl">LED</mark> 9W <mark class="hl">bulb</mark>')).toEqual([
      { text: 'LED', match: true },
      { text: ' 9W ', match: false },
      { text: 'bulb', match: true },
    ]);
  });

  it('returns an unhighlighted field as one plain run', () => {
    expect(parseHighlight('Ambuja Plus 50 kg')).toEqual([{ text: 'Ambuja Plus 50 kg', match: false }]);
  });

  it('returns nothing for an empty field', () => {
    expect(parseHighlight('')).toEqual([]);
  });

  it('treats markup in the product name as text, not markup', () => {
    // Meili splices its tags into the raw stored value without escaping it, so this is exactly
    // what a poisoned catalogue row would produce. Every part must come back match:false text.
    const hostile = '<img src=x onerror=alert(1)> cement';
    expect(parseHighlight(hostile)).toEqual([{ text: hostile, match: false }]);
  });

  it('keeps injected markup inside a highlighted run as text', () => {
    const parts = parseHighlight('<mark class="hl"><script>alert(1)</script></mark> bag');
    expect(parts).toEqual([
      { text: '<script>alert(1)</script>', match: true },
      { text: ' bag', match: false },
    ]);
    // The dangerous substring survives as *content*, which React escapes — it is never markup.
    expect(parts[0].match).toBe(true);
  });

  it('does not treat a lookalike tag as a highlight marker', () => {
    // Only the exact configured pre/post pair opens a run; anything else stays text.
    const s = '<mark>PPC</mark> cement';
    expect(parseHighlight(s)).toEqual([{ text: s, match: false }]);
  });

  it('leaves an unterminated marker as text rather than swallowing the rest', () => {
    const s = 'cement <mark class="hl">PPC';
    expect(parseHighlight(s)).toEqual([{ text: s, match: false }]);
  });
});
