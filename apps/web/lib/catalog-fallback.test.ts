/**
 * THE CATALOGUE WITH NOTHING BEHIND IT.
 *
 * `lib/static-catalogue.ts` states the contract in its own header: every loader tries the live
 * path first and falls back to the snapshot, so "Vercel serves it with no environment variables
 * at all". That is a promise about a deployment, and until this file existed nothing checked it.
 *
 * It had already been broken twice. `allCategories` was fixed once — its comment records a
 * deployment whose every category list was blank while the pages rendered fine — and the three
 * loaders beside it were left returning empty arrays. Those three are exactly the ones the
 * assistant reads, so a store with no database had an assistant that answered "we do not stock
 * that" about its own cement, which is the worst possible way for this to fail: fluent, confident
 * and wrong, with no error anywhere to notice.
 *
 * So the test is not "does suggest work". It is: with no search server and no database, does the
 * store still know what it sells.
 */

import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  /* An empty host makes the Meilisearch constructor throw SYNCHRONOUSLY, which is the case that
     broke `suggest` — the throw happened while the Promise.all array was being built, before any
     promise existed for a .catch() to attach to. A merely unreachable host would not reproduce
     it: that one fails at fetch time, where a .catch() does fire. */
  process.env.MEILI_HOST = '';
  /* Refused on connect rather than left to time out, so the fallback is what is slow-path tested
     and the suite is not. */
  process.env.DATABASE_URL = 'mysql://none:none@127.0.0.1:1/none';
});

describe('the catalogue with no search server and no database', () => {
  it('still finds products by name', async () => {
    const { suggest } = await import('./catalog');
    const found = await suggest('cement');

    expect(found.skus.length).toBeGreaterThan(0);
    for (const s of found.skus) {
      expect(s.sku_code).toBeTruthy();
      expect(s.name).toBeTruthy();
    }
    /* Grounding depends on this: the assistant quotes prices straight out of these documents, so
       a snapshot row that carries a name but no price would put it in the position of describing
       a product it cannot price. */
    expect(found.skus.some((s) => typeof s.selling_price === 'number')).toBe(true);
  });

  it('still knows which brands it carries', async () => {
    const { allBrands } = await import('./catalog');
    const brands = await allBrands();

    expect(brands.length).toBeGreaterThan(0);
    for (const b of brands) {
      expect(b.slug).toBeTruthy();
      expect(b.name).toBeTruthy();
    }
  });

  it('still opens a product it has just listed', async () => {
    const { skuDocsByCodes, suggest } = await import('./catalog');
    const [first] = (await suggest('cement')).skus;
    expect(first).toBeDefined();

    /* The round trip the assistant actually makes: search_products hands it a code, and
       product_detail has to be able to open that same code. These used to disagree — search fell
       back to the snapshot and detail returned an empty array — so the assistant could list a
       product and then deny it existed. */
    const [doc] = await skuDocsByCodes([first.sku_code]);
    expect(doc?.sku_code).toBe(first.sku_code);
  });

  it('answers a question asked as a whole sentence, not just a keyword', async () => {
    const { suggest } = await import('./catalog');

    /* The reported failure, verbatim. The matcher tested the whole query as ONE substring, so a
       sentence matched nothing, the assistant's tool came back empty, and it told a customer we
       do not stock solar panels while three of them sat in the catalogue. */
    const asked = await suggest('What steel and solar panels do you have');
    expect(asked.skus.length).toBeGreaterThan(0);
    expect(asked.skus.some((s) => s.category === 'solar-panels')).toBe(true);

    for (const q of ['what cement do you sell', 'show me floor tiles', 'cheapest bulb']) {
      expect((await suggest(q)).skus.length, q).toBeGreaterThan(0);
    }
  });

  it('ranks the products that answer more of the question first', async () => {
    const { suggest } = await import('./catalog');

    /* "steel" also appears in a fire extinguisher's specification. Scoring by how many of the
       query's words a document matches puts the panels — which match two — above it. Without the
       ranking the first thing the customer sees for this question is an extinguisher. */
    const found = await suggest('steel and solar panels');
    expect(found.skus[0]?.category).toBe('solar-panels');
  });

  it('still lists its categories', async () => {
    const { allCategories } = await import('./catalog');
    const cats = await allCategories();

    expect(cats.length).toBeGreaterThan(0);
    expect(cats.every((c) => c.slug && c.name)).toBe(true);
  });
});
