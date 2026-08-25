import { describe, expect, it } from 'vitest';
import { clamp, clamp01, formatNumber, formatRupees, formatSpecValue } from '../src/num';

describe('clamp01', () => {
  it('passes through values already in range', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
  });

  it('clamps values outside the range', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
  });

  it('coerces numeric strings, which is what LLM output actually contains', () => {
    expect(clamp01('0.8')).toBe(0.8);
    expect(clamp01('2')).toBe(1);
  });

  it('fails to zero for anything that is not a finite number', () => {
    // Zero reads as "no confidence" at every call site, which is the safe direction.
    for (const bad of [null, undefined, NaN, 'high', {}, [1, 2]]) expect(clamp01(bad)).toBe(0);
  });
});

describe('clamp', () => {
  it('bounds on both sides and leaves interior values alone', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('formatNumber', () => {
  it('groups in the Indian system, not the Western one', () => {
    expect(formatNumber(123456)).toBe('1,23,456');
    expect(formatNumber(10000000)).toBe('1,00,00,000');
  });

  it('keeps whole numbers whole and fractions to three places', () => {
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(2.34567)).toBe('2.346');
  });
});

describe('formatRupees', () => {
  it('prefixes the symbol and groups the digits', () => {
    expect(formatRupees(123456)).toBe('₹1,23,456');
  });

  it('hides paise unless asked for and actually present', () => {
    expect(formatRupees(410.5)).toBe('₹411');
    expect(formatRupees(410, { decimals: true })).toBe('₹410');
    expect(formatRupees(410.5, { decimals: true })).toBe('₹410.50');
  });

  it('renders a missing price as an em dash rather than NaN', () => {
    expect(formatRupees(null)).toBe('—');
    expect(formatRupees(undefined)).toBe('—');
    expect(formatRupees(Number.NaN)).toBe('—');
  });
});

describe('formatSpecValue', () => {
  it('trails the unit, except rupees which lead', () => {
    expect(formatSpecValue(9, 'W')).toBe('9 W');
    expect(formatSpecValue(1200, '₹')).toBe('₹1,200');
    expect(formatSpecValue(53, null)).toBe('53');
  });

  it('renders booleans as Yes/No', () => {
    expect(formatSpecValue(true)).toBe('Yes');
    expect(formatSpecValue(false)).toBe('No');
  });

  it('trusts the registry data type over the stored value type', () => {
    // EAV round-trips booleans through the string "true"; the sheet must still say Yes.
    expect(formatSpecValue('true', null, 'boolean')).toBe('Yes');
    expect(formatSpecValue('false', null, 'boolean')).toBe('No');
  });

  it('gives a unit to a numeric attribute whose value arrived as a string', () => {
    expect(formatSpecValue('6500', 'K', 'number')).toBe('6500 K');
  });

  it('renders an absent value as an em dash', () => {
    expect(formatSpecValue(null)).toBe('—');
    expect(formatSpecValue(undefined)).toBe('—');
    expect(formatSpecValue('')).toBe('—');
  });
});
