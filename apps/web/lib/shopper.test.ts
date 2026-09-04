import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addFriendLoves,
  EMPTY_SHOPPER,
  lovesLink,
  markOrdered,
  markViewed,
  parseShopper,
  rate,
  readLovesLink,
  readShopper,
  SHOPPER_EVENT,
  toggleLove,
} from './shopper';

/**
 * The device's own record of its owner — what backs "Rating 4.0+", "Previously ordered",
 * "New to you" and "Loved by friends".
 *
 * Two things are worth holding here. The first is that NOTHING ON DISK IS TRUSTED: this is
 * localStorage, which anybody can edit and any older version of the app may have written, so a
 * malformed record has to degrade to an empty one rather than take a page down. The second is the
 * shared-list link, which is the only piece of this that travels between people and therefore the
 * only piece that can carry someone else's input into the app.
 */
function fakeStorage() {
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
  vi.stubGlobal('window', { localStorage: fakeStorage(), dispatchEvent: vi.fn(), Event });
  vi.stubGlobal('localStorage', globalThis.window.localStorage);
});

describe('reading a record that may be anything at all', () => {
  it('gives an empty record for nothing, rubbish, or the wrong shape', () => {
    for (const raw of [null, undefined, 42, 'nope', [], { viewed: 'yes' }]) expect(parseShopper(raw)).toEqual(EMPTY_SHOPPER);
  });

  it('keeps the good fields of a half-broken record and drops the rest', () => {
    const parsed = parseShopper({
      viewed: { GOOD: 1700000000000, BAD: 'soon' },
      rated: { GOOD: 5, TOOBIG: 9, TOOSMALL: 0, NOTANUMBER: 'five' },
      ordered: { GOOD: 1700000000000 },
      loved: null,
      friends: { GOOD: ['Priya', 'Priya', '  ', 7], BAD: 'Ravi' },
    });
    expect(parsed.viewed).toEqual({ GOOD: 1700000000000 });
    expect(parsed.rated).toEqual({ GOOD: 5 });
    expect(parsed.ordered).toEqual({ GOOD: 1700000000000 });
    expect(parsed.loved).toEqual({});
    /* De-duplicated, trimmed, and nothing that is not a name. */
    expect(parsed.friends).toEqual({ GOOD: ['Priya'] });
  });

  it('survives a stored value that is not even JSON', () => {
    localStorage.setItem('bo_shopper', '{oh no');
    expect(readShopper()).toEqual(EMPTY_SHOPPER);
  });
});

describe('what the store records', () => {
  it('remembers a product page being opened', () => {
    markViewed('CEM-ULT-PPC50');
    expect(readShopper().viewed['CEM-ULT-PPC50']).toBeGreaterThan(0);
  });

  it('remembers everything that was in an order', () => {
    markOrdered(['A', 'B']);
    expect(Object.keys(readShopper().ordered).sort()).toEqual(['A', 'B']);
  });

  it('takes stars, replaces them, and lets them be taken away', () => {
    rate('A', 5);
    expect(readShopper().rated.A).toBe(5);
    rate('A', 3);
    expect(readShopper().rated.A).toBe(3);
    rate('A', 0);
    expect(readShopper().rated.A).toBeUndefined();
  });

  it('refuses a rating outside one to five rather than storing it', () => {
    rate('A', 9);
    rate('B', -1);
    expect(readShopper().rated).toEqual({});
  });

  it('toggles a love off as well as on', () => {
    toggleLove('A');
    expect(readShopper().loved.A).toBeGreaterThan(0);
    toggleLove('A');
    expect(readShopper().loved.A).toBeUndefined();
  });

  it('tells everything on the page that something changed', () => {
    markViewed('A');
    expect(globalThis.window.dispatchEvent).toHaveBeenCalled();
    const evt = (globalThis.window.dispatchEvent as unknown as { mock: { calls: Event[][] } }).mock.calls[0][0];
    expect(evt.type).toBe(SHOPPER_EVENT);
  });
});

describe("a friend's list", () => {
  it('records who loves what, and counts only what is new', () => {
    expect(addFriendLoves('Priya', ['A', 'B'])).toBe(2);
    expect(addFriendLoves('Priya', ['A', 'B'])).toBe(0);
    expect(addFriendLoves('Ravi', ['B'])).toBe(1);
    expect(readShopper().friends).toEqual({ A: ['Priya'], B: ['Priya', 'Ravi'] });
  });

  it('names an unnamed sender rather than leaving a blank', () => {
    addFriendLoves('   ', ['A']);
    expect(readShopper().friends.A).toEqual(['A friend']);
  });

  it('round-trips through a link', () => {
    const url = lovesLink('https://shop.example', '/c/concreting', 'Priya', ['CEM-ULT-PPC50', 'TIL-KAJ-GP00215']);
    const read = readLovesLink(new URL(url).searchParams);
    expect(read).toEqual({ from: 'Priya', skus: ['CEM-ULT-PPC50', 'TIL-KAJ-GP00215'] });
  });

  /*
   * A shared link is the one input here that comes from another person, so it is treated as
   * input: only things shaped like a SKU code survive, duplicates collapse, and the list is
   * capped so a hostile link cannot fill somebody's storage.
   */
  it('takes only what looks like a SKU code from a link', () => {
    const p = new URLSearchParams({ from: 'x', loves: 'CEM-ULT-PPC50, <script>, ok, ,TIL-KAJ-GP00215' });
    expect(readLovesLink(p)?.skus).toEqual(['CEM-ULT-PPC50', 'TIL-KAJ-GP00215']);
  });

  it('caps a very long link and de-duplicates it', () => {
    const many = Array.from({ length: 500 }, (_, i) => `SKU-${i}`).join(',');
    expect(readLovesLink(new URLSearchParams({ loves: many }))?.skus).toHaveLength(100);
    expect(readLovesLink(new URLSearchParams({ loves: 'A-BC,A-BC,A-BC' }))?.skus).toEqual(['A-BC']);
  });

  it('trims a sender name that is trying to be a paragraph', () => {
    const long = 'x'.repeat(200);
    expect(readLovesLink(new URLSearchParams({ from: long, loves: 'A-BC' }))?.from).toHaveLength(40);
  });

  it('is nothing at all when the link carries no list', () => {
    expect(readLovesLink(new URLSearchParams(''))).toBeNull();
    expect(readLovesLink(new URLSearchParams({ loves: ' , , ' }))).toBeNull();
  });
});
