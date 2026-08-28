import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { productTitle, skuTitle, skuVariant, withoutBrand } from './label';

const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalogue', 'skus.json'), 'utf8')) as Record<
  string,
  { brand?: { name?: string } | string; product?: { name?: string } }
>;
const products = Object.values(catalogue)
  .map((r) => ({ brand: String((r.brand as { name?: string })?.name ?? r.brand ?? '').trim(), name: String(r.product?.name ?? '').trim() }))
  .filter((r) => r.brand && r.name);

describe('printing a brand and a name without saying the brand twice', () => {
  it('has a catalogue where this is the common case, not the exception', () => {
    const prefixed = products.filter(
      (p) => p.name.toLowerCase().startsWith(p.name.split(' ')[0].toLowerCase()) && productTitle(p.brand, p.name) !== `${p.brand} ${p.name}`,
    );
    expect(products.length).toBeGreaterThan(20);
    expect(prefixed.length).toBeGreaterThan(products.length * 0.8);
  });

  it('never prints the brand twice, for any product in the catalogue', () => {
    for (const { brand, name } of products) {
      const title = productTitle(brand, name);
      const first = brand.split(/\s+/)[0];
      /* The brand's first word may legitimately appear later — "Dr. Fixit LW+ … Pidilite" — so this
         only rejects it appearing twice at the very front. */
      expect(title.toLowerCase().startsWith(`${first.toLowerCase()} ${first.toLowerCase()} `)).toBe(false);
    }
  });

  it('leaves a name alone when the brand does not open it', () => {
    expect(withoutBrand('Dr. Fixit LW+ Waterproofing', 'Pidilite')).toBe('Dr. Fixit LW+ Waterproofing');
    expect(productTitle('Pidilite', 'Dr. Fixit LW+ Waterproofing')).toBe('Pidilite Dr. Fixit LW+ Waterproofing');
  });

  it('takes the whole brand off when the whole brand opens the name', () => {
    expect(withoutBrand('ACC Suraksha Power Cement', 'ACC')).toBe('Suraksha Power Cement');
    expect(productTitle('ACC', 'ACC Suraksha Power Cement')).toBe('ACC Suraksha Power Cement');
  });

  it('takes the shared first word off when the brand is longer than the prefix', () => {
    expect(withoutBrand('UltraTech Portland Pozzolana Cement', 'UltraTech Cement')).toBe('Portland Pozzolana Cement');
  });

  it('never returns nothing', () => {
    expect(withoutBrand('ACC', 'ACC')).toBe('ACC');
    expect(productTitle('ACC', 'ACC')).toBe('ACC');
    expect(skuTitle('ACC', 'ACC', null)).toBe('ACC');
  });

  /* skuTitle does the same brand trim AND drops the variant suffix the search index glues on. */
  it('strips the variant suffix as well, for a search hit', () => {
    const name = 'Wipro Garnet 9 W B22 Cool Day White LED Bulb 9 W · B22 · single lamp';
    expect(skuTitle(name, 'Wipro Lighting', '9 W · B22 · single lamp')).toBe('Garnet 9 W B22 Cool Day White LED Bulb');
  });

  it('keeps the clauses that identify an item on a shelf', () => {
    expect(skuVariant('9 W · B22 · 6500 K cool day white · single lamp')).toBe('9 W · B22');
    expect(skuVariant(null)).toBe('');
  });
});
