import { describe, expect, it } from 'vitest';
import { shelfCategoryNamed } from './routing';

const CATS = [
  { name: 'Cement', status: 'live' as const },
  { name: 'Solar Panels', status: 'live' as const },
  { name: 'Total Stations', status: 'live' as const },
  { name: 'Fire Extinguishers', status: 'live' as const },
  { name: 'Steel & Reinforcement', status: 'upcoming' as const },
  { name: 'Plumbing', status: 'upcoming' as const },
];

/**
 * The deterministic half of the routing fix.
 *
 * The prompt asks the model to look up anything it is not certain about, and a prompt is a
 * request: the same build answered "Solar Panels are coming soon" in production and answered
 * correctly on a laptop. This decides, in code, when an answer is not allowed to come from
 * memory — so the guarantee does not depend on the model reading carefully.
 */
describe('spotting a stocked category in what the customer said', () => {
  it('finds one named in a whole sentence', () => {
    expect(shelfCategoryNamed('What steel and solar panels do you have', CATS)).toBe('Solar Panels');
    expect(shelfCategoryNamed('what cement do you sell?', CATS)).toBe('Cement');
  });

  it('folds the plural, both directions', () => {
    /* "panels" has to find Solar Panels and "panel" has to as well. */
    expect(shelfCategoryNamed('price of one solar panel', CATS)).toBe('Solar Panels');
  });

  it('leaves coming-soon categories alone', () => {
    /* Answering these without a tool is the intended behaviour, so a match here would force a
       pointless search and could talk the model out of the right answer. */
    expect(shelfCategoryNamed('do you sell plumbing pipes?', CATS)).toBeNull();
    expect(shelfCategoryNamed('any steel reinforcement?', CATS)).toBeNull();
  });

  it('does not fire on the words every shopping question contains', () => {
    /* Without the shopping-word filter, "total" made this a question about Total Stations. */
    expect(shelfCategoryNamed('what is the total cost of my order', CATS)).toBeNull();
    expect(shelfCategoryNamed('is that the price with delivery', CATS)).toBeNull();
  });

  it('matches on the distinctive word of a two-word name', () => {
    expect(shelfCategoryNamed('do you have a theodolite or a station', CATS)).toBe('Total Stations');
    expect(shelfCategoryNamed('I need an extinguisher', CATS)).toBe('Fire Extinguishers');
  });
});
