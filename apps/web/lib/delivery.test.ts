import { describe, expect, it } from 'vitest';
import { deliverBy } from './delivery';

/**
 * All dates below are fixed UTC instants; the function works in IST internally, so a late-UTC
 * timestamp is deliberately used to prove the +5:30 shift changes which day we count from.
 */
const at = (iso: string) => new Date(iso);

describe('deliverBy', () => {
  it('returns null when the pincode is not served', () => {
    expect(deliverBy(null)).toBeNull();
    expect(deliverBy(undefined)).toBeNull();
    expect(deliverBy(Number.NaN)).toBeNull();
  });

  it('counts forward from today in IST', () => {
    // Tue 2026-08-25 06:00 UTC = 11:30 IST. Two delivery days later is Thursday.
    expect(deliverBy(2, at('2026-08-25T06:00:00Z'))).toBe('Thu, 27 Aug');
  });

  it('uses the Indian calendar day, not the server one', () => {
    // 2026-08-25 20:00 UTC is already Wed 26 Aug in IST, so one day out is Thursday.
    expect(deliverBy(1, at('2026-08-25T20:00:00Z'))).toBe('Thu, 27 Aug');
  });

  it('does not count Sunday as a delivery day', () => {
    // From Fri 28 Aug 2026: two days would be Sat + Sun, but Sunday does not count, so Monday.
    expect(deliverBy(2, at('2026-08-28T06:00:00Z'))).toBe('Mon, 31 Aug');
  });

  it('never lands on a Sunday, even for a same-day promise made on Saturday', () => {
    // Sat 29 Aug 2026 + 1 day = Sunday, which is pushed to Monday.
    expect(deliverBy(1, at('2026-08-29T06:00:00Z'))).toBe('Mon, 31 Aug');
  });

  it('never returns a Sunday for a zero-day promise made on a Sunday', () => {
    expect(deliverBy(0, at('2026-08-30T06:00:00Z'))).toBe('Mon, 31 Aug');
  });

  it('treats a negative lead time as immediate rather than counting backwards', () => {
    expect(deliverBy(-5, at('2026-08-25T06:00:00Z'))).toBe('Tue, 25 Aug');
  });

  it('rolls across a month boundary', () => {
    // "Sept", not "Sep" — that is what en-IN gives for September, and it is what ships.
    expect(deliverBy(3, at('2026-08-31T06:00:00Z'))).toBe('Thu, 3 Sept');
  });
});
