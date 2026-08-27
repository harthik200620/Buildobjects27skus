import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quoteProvider, readerChain, toReading } from './quote-reader';

/**
 * THE QUOTE READER'S TWO SILENT FAILURE MODES.
 *
 * Both of them shipped, and neither showed up as an error anywhere — the feature simply told
 * people it was not available, or fell over, on a deployment that had everything it needed.
 *
 *  1. IT LOOKED FOR THE WRONG KEY. The live site carries BO_CHAT_API_KEY; the reader checked
 *     ANTHROPIC_API_KEY. So it reported "no reader configured" while holding a working credential,
 *     exactly the way the assistant was dark for a week.
 *
 *  2. IT COMMITTED TO ONE PROVIDER. On this account the Gemini key is present and billing-blocked:
 *     every read returned 429. Because Gemini was chosen on key presence alone and there was no
 *     second attempt, the feature was dead with a valid key in the environment. Whether a provider
 *     ANSWERS is not something key presence can tell you.
 */

const KEYS = ['GEMINI_API_KEY', 'BO_CHAT_API_KEY', 'ANTHROPIC_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('which readers a deployment can use', () => {
  it('finds the key the live site actually sets', () => {
    process.env.BO_CHAT_API_KEY = 'sk-test';
    expect(readerChain()).toEqual(['anthropic']);
    expect(quoteProvider()).toBe('anthropic');
  });

  it('keeps a second reader behind the first, so one bad key is not the end of it', () => {
    process.env.GEMINI_API_KEY = 'g-test';
    process.env.BO_CHAT_API_KEY = 'sk-test';
    /* Order matters and the fallback matters more: Gemini reads a photograph better when it works,
       and when it answers 429 every time the read still has somewhere to go. */
    expect(readerChain()).toEqual(['gemini', 'anthropic']);
  });

  it('says so plainly when there is no reader at all', () => {
    expect(readerChain()).toEqual([]);
    expect(quoteProvider()).toBe('mock');
  });
});

describe('what comes back from the reader', () => {
  const raw = {
    contractor: 'Sri Venkateswara Constructions',
    stated_total: 3_377_460,
    confidence: 0.95,
    summary: 'A quotation for a 30x40 residence.',
    questions: ['What area of brickwork does the lump sum cover?', '  ', 'Is centering inside the RCC rate?'],
    lines: [
      { label: 'Brickwork with cement mortar', qty: 0, unit: 'LS', rate: 0, amount: 420_000, assessment: 'No quantity stated.', confidence: 0.9 },
      /* A heading the reader mistook for a line: no amount. */
      { label: 'STRUCTURE', qty: 0, unit: '', rate: 0, amount: 0, assessment: '', confidence: 0.4 },
    ],
  };

  it('carries the questions through, and drops the blanks', () => {
    const r = toReading(raw, 'anthropic');
    expect(r.questions).toEqual(['What area of brickwork does the lump sum cover?', 'Is centering inside the RCC rate?']);
  });

  it('keeps a lump-sum line but throws away a heading', () => {
    const r = toReading(raw, 'anthropic');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].label).toBe('Brickwork with cement mortar');
    /* Zero means "the document does not say", and it has to reach the UI as null rather than as a
       quantity of nothing — a lump sum with no quantity is the single most important thing on a
       quotation to notice. */
    expect(r.lines[0].qty).toBeNull();
    expect(r.lines[0].rate).toBeNull();
    expect(r.lines[0].amount).toBe(420_000);
  });

  it('refuses a quotation that is not in rupees rather than comparing it anyway', () => {
    expect(() => toReading({ ...raw, currency_ok: 'no' }, 'anthropic')).toThrow(/rupees/);
  });

  it('refuses a page it could read nothing priced from', () => {
    expect(() => toReading({ ...raw, lines: [] }, 'anthropic')).toThrow(/no priced lines/i);
  });
});
