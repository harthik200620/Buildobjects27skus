import type { FacetConfig } from '@buildobjects/catalog';
import { describe, expect, it } from 'vitest';
import { appliedChips, esc, parseFilters, sortParam, toMeiliFilter, toQuery } from './filters';

const config = {
  facets: [
    { key: 'brand', attr: 'brand', label: 'Brand', kind: 'checkbox', values: [] },
    { key: 'wattage', attr: 'attr_wattage', label: 'Wattage', kind: 'range', unit: 'W', min: 3, max: 20 },
    { key: 'base_type', attr: 'attr_base_type', label: 'Base', kind: 'checkbox', values: [{ value: 'B22', label: 'B22 bayonet', count: 4 }] },
    { key: 'dimmable', attr: 'attr_dimmable', label: 'Dimmable', kind: 'toggle', true_label: 'Dimmable only' },
  ],
} as unknown as FacetConfig;

describe('parseFilters', () => {
  it('reads the whole URL vocabulary', () => {
    const state = parseFilters({
      q: ' led bulb ',
      brand: 'Philips|Havells',
      price: '100-500',
      stock: '1',
      sort: 'price_asc',
      page: '3',
      f_wattage: '5-15',
      f_base_type: 'B22|E27',
      f_dimmable: '1',
    });
    expect(state).toMatchObject({
      q: 'led bulb',
      brand: ['Philips', 'Havells'],
      price: [100, 500],
      stock: true,
      sort: 'price_asc',
      page: 3,
      attrs: { wattage: [5, 15], base_type: ['B22', 'E27'], dimmable: true },
    });
  });

  it('treats an open-ended range as open on that side', () => {
    expect(parseFilters({ price: '-500' }).price).toEqual([null, 500]);
    expect(parseFilters({ price: '100-' }).price).toEqual([100, null]);
  });

  it('ignores a sort key it does not know', () => {
    expect(parseFilters({ sort: 'price_asc' }).sort).toBe('price_asc');
    expect(parseFilters({ sort: 'cheapest' }).sort).toBeUndefined();
  });

  it('never returns a page below 1, whatever the query string says', () => {
    for (const page of ['0', '-4', 'abc', '']) expect(parseFilters({ page }).page).toBe(1);
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(parseFilters({ q: ['first', 'second'] }).q).toBe('first');
  });
});

describe('toQuery', () => {
  it('round-trips through parseFilters', () => {
    const before = parseFilters({ q: 'cement', brand: 'ACC|Ambuja', price: '100-500', stock: '1', sort: 'price_desc', page: '2', f_wattage: '5-15' });
    const after = parseFilters(Object.fromEntries(new URLSearchParams(toQuery(before).slice(1))));
    expect(after).toEqual(before);
  });

  it('leaves defaults out of the URL', () => {
    expect(toQuery({ q: '', page: 1, sort: 'relevance' })).toBe('');
  });

  it('drops a range that is open on both sides', () => {
    expect(toQuery({ price: [null, null] })).toBe('');
  });
});

describe('esc', () => {
  it('quotes and escapes so a value cannot break out of a filter expression', () => {
    expect(esc('cement')).toBe('"cement"');
    expect(esc('a"b')).toBe('"a\\"b"');
    expect(esc('a\\b')).toBe('"a\\\\b"');
  });
});

describe('toMeiliFilter', () => {
  it('scopes to the fixed category over the state one', () => {
    expect(toMeiliFilter({ attrs: {}, category: 'bulbs' }, config, 'cement')).toContain('category = "cement"');
  });

  it('splits a price range into two bounds and omits the open side', () => {
    expect(toMeiliFilter({ attrs: {}, price: [100, null] }, config)).toEqual(['selling_price >= 100']);
    expect(toMeiliFilter({ attrs: {}, price: [null, 500] }, config)).toEqual(['selling_price <= 500']);
  });

  it('maps a facet key to its indexed attribute name', () => {
    expect(toMeiliFilter({ attrs: { base_type: ['B22'] } }, config)).toEqual(['attr_base_type IN ["B22"]']);
  });

  it('falls back to the attr_ convention for a key the config does not describe', () => {
    expect(toMeiliFilter({ attrs: { unknown: ['x'] } }, config)).toEqual(['attr_unknown IN ["x"]']);
  });

  it('escapes values coming from the URL', () => {
    expect(toMeiliFilter({ attrs: {}, brand: ['A"B'] }, config)).toEqual(['brand IN ["A\\"B"]']);
  });
});

describe('sortParam', () => {
  it('leaves relevance to the engine and maps the rest', () => {
    expect(sortParam(undefined)).toBeUndefined();
    expect(sortParam('relevance')).toBeUndefined();
    expect(sortParam('price_asc')).toEqual(['selling_price:asc']);
    expect(sortParam('newest')).toEqual(['created_at:desc']);
  });
});

describe('appliedChips', () => {
  it('gives each brand its own chip that removes only that brand', () => {
    const chips = appliedChips({ attrs: {}, brand: ['Philips', 'Havells'] }, config);
    expect(chips.map((c) => c.label)).toEqual(['Philips', 'Havells']);
    expect(chips[0].remove).toEqual({ brand: ['Havells'] });
  });

  it('words a price range by which side is open', () => {
    const label = (price: [number | null, number | null]) => appliedChips({ attrs: {}, price }, config)[0].label;
    expect(label([null, 500])).toBe('Under ₹500');
    expect(label([100, null])).toBe('₹100 and above');
    expect(label([100, 500])).toBe('₹100 – ₹500');
  });

  it('labels a range facet with its unit', () => {
    expect(appliedChips({ attrs: { wattage: [5, 15] } }, config)[0].label).toBe('Wattage: 5–15 W');
  });

  it('prefers a toggle facet true_label over its plain label', () => {
    expect(appliedChips({ attrs: { dimmable: true } }, config)[0].label).toBe('Dimmable only');
  });

  it('shows a value label rather than the raw stored value', () => {
    expect(appliedChips({ attrs: { base_type: ['B22'] } }, config)[0].label).toBe('Base: B22 bayonet');
  });

  it('removing the last value of a multi-select drops the whole facet', () => {
    expect(appliedChips({ attrs: { base_type: ['B22'] } }, config)[0].remove).toEqual({ attrs: {} });
  });

  it('removing one of several values keeps the others', () => {
    const chips = appliedChips({ attrs: { base_type: ['B22', 'E27'] } }, config);
    expect(chips[0].remove).toEqual({ attrs: { base_type: ['E27'] } });
  });
});
