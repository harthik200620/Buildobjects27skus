import { describe, expect, it } from 'vitest';
import { extractEntities } from './validator';

/**
 * The validator throws away any reply containing a named entity the tools did not return, which
 * is the whole hallucination guard — and it is only as good as its idea of what a name IS.
 *
 * Every case below is ordinary English that was being read as a brand name. A false positive here
 * is not a cosmetic problem: it silently binned the model's answer and served a canned line in its
 * place, which reads to a customer as the assistant simply refusing to help.
 */
describe('what counts as a named entity', () => {
  it('does not mistake pronouns and contractions for brands', () => {
    /* The observed failure: this draft was rejected on "Let" and "I'll". */
    expect(extractEntities("Let me check the panels and I'll give you the price")).toEqual([]);

    for (const grammar of ['We have three of them.', "That's the cheapest one.", "Here's what we stock.", "I've checked and I'd take the second."]) {
      expect(extractEntities(grammar), grammar).toEqual([]);
    }
  });

  it('mid-sentence grammar counts as grammar too', () => {
    /* SENTENCE_STARTERS only ever applied at the start of a sentence, so a capitalised function
       word anywhere else went straight through as a candidate name. */
    expect(extractEntities("The panel is in stock and I'll ship it")).toEqual([]);
  });

  it('still catches the brands it exists to catch', () => {
    expect(extractEntities('The UltraTech is cheapest')).toContain('UltraTech');
    /* Joined, because a leading verb the trimmer does not know ("Try") stays attached — which is
       the safe direction: an over-collected candidate costs one set lookup, a missed one is a
       hallucination that ships. */
    expect(extractEntities('Try Birla Shakti instead').join(' ')).toContain('Birla Shakti');
    /* The point of the whole guard: an invented seller must still be collected. */
    expect(extractEntities('Let me suggest Sharma Traders')).toContain('Sharma Traders');
  });
});
