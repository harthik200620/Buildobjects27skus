import type { QuotedLine } from '@buildobjects/estimator';
import { arr, enumOf, generateJson, imagePart, type JsonSchema, num, obj, resolveModel, str } from '@buildobjects/llm';
import { hasAnthropicKey, readDocumentAsJson } from './chat/anthropic';

/**
 * Reading a contractor's quotation.
 *
 * ── WHY A READER AND NOT A PARSER ───────────────────────────────────────────────────────────
 * `parseQuoteText` in the estimator package already handles a quote somebody pastes out of
 * WhatsApp: last number on the line is the amount, the rest is the label. It is free, instant,
 * offline, and it is right most of the time. It stays, and it is what runs when there is no key.
 *
 * What it cannot do is read a PHOTOGRAPH, and a photograph is how most people actually hold their
 * quotation — a page on a contractor's letterhead, shot on a phone, sent on WhatsApp. That is what
 * this is for. It is the same shape as `lib/drawing.ts`, deliberately: gemini → anthropic → mock
 * by key presence, one strict-JSON call, a timeout, a typed error.
 *
 * ── WHAT THE MODEL IS ALLOWED TO SAY ────────────────────────────────────────────────────────
 * It reads the document into typed lines, and it writes the plain-language assessment beside each
 * one. The comparison itself — the range, the percentage, the verdict — is still computed by the
 * estimator engine against a dated rate card, and the UI prints both. That is not a restriction on
 * the model so much as a courtesy to the reader: they can see what the rate card says and what the
 * model says, side by side, and disagree with either.
 */

export type QuoteProvider = 'gemini' | 'anthropic' | 'mock';

export const QUOTE_MAX_BYTES = 14 * 1024 * 1024;
export const QUOTE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const QUOTE_TIMEOUT_MS = 90_000;

export class QuoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'QuoteError';
  }
}

export interface QuoteFile {
  bytes: Buffer;
  mimeType: string;
  name: string;
}

/** One line as the reader returns it: the engine's `QuotedLine` plus what the model made of it. */
export interface ReadQuoteLine extends QuotedLine {
  /** The model's own read of this line, in the buyer's language. Shown beside the engine's verdict. */
  assessment: string | null;
}

export interface QuoteReading {
  provider: QuoteProvider;
  lines: ReadQuoteLine[];
  /** Who wrote it, if the document says. Never inferred. */
  contractor: string | null;
  /** The total printed ON the document, which may not equal the sum of its lines — and when it
      does not, that is worth the buyer knowing before anything else. */
  statedTotal: number | null;
  /** One paragraph on the quotation as a whole. */
  summary: string;
  /**
   * What the reader still needs before it can judge this properly.
   *
   * A quotation is half a conversation. It says 4,20,000 for brickwork and does not say over what
   * area, in what block, at what height - and without those the comparison is arithmetic rather
   * than an opinion. Asking is what a quantity surveyor does in the first two minutes, and the old
   * reader had no way to.
   */
  questions: string[];
  /** 0–1, the reader's own confidence in the read. */
  confidence: number;
  notes: string;
}

/**
 * EVERY READER THIS DEPLOYMENT COULD USE, best first.
 *
 * Two things were wrong with picking one and committing to it.
 *
 * The old check read ANTHROPIC_API_KEY, which the live site does not set - the key it carries is
 * BO_CHAT_API_KEY, and `hasAnthropicKey` resolves both. So the deployment reported "no reader
 * configured" while holding a perfectly good one, exactly the way the assistant was dark.
 *
 * And a single choice cannot survive a reader that is configured but not working. On this account
 * the Gemini key is present and billing-blocked: every read came back 429, and because Gemini was
 * chosen first and there was no second attempt, the feature was dead with a valid key in the
 * environment. Whether a provider ANSWERS is not something key presence can tell you.
 */
export function readerChain(): Array<Exclude<QuoteProvider, 'mock'>> {
  const out: Array<Exclude<QuoteProvider, 'mock'>> = [];
  if (process.env.GEMINI_API_KEY) out.push('gemini');
  if (hasAnthropicKey()) out.push('anthropic');
  return out;
}

/** What a press would try FIRST, so the interface can say whether reading is possible at all. */
export function quoteProvider(): QuoteProvider {
  return readerChain()[0] ?? 'mock';
}

const SYSTEM = `You read construction quotations from India and return them as structured data.

The document is a builder's or contractor's quotation, often handwritten or on a letterhead, in
English or in Indian-English trade shorthand. Read what is ACTUALLY PRINTED. Never invent a line,
never complete a total, never convert a currency.

Trade words you will meet, and what they mean: centering / shuttering = formwork. Jelly, metal,
kankar = coarse aggregate. Rods, sariya, TMT = reinforcement steel. Mestri, mistri = mason labour.
Isuka = sand. Dado = wall tiling. Talupu = doors. Kitiki = windows.

Amounts use the Indian grouping (1,08,000 = one hundred and eight thousand). Read "L" or "lakh" as
100000 and "Cr" or "crore" as 10000000.

For each line write a short, plain assessment: what the line covers, and anything a first-time
builder should ask about it. Never accuse anyone of anything. A quotation can be dearer or cheaper
than a rate card for a dozen honest reasons and you have not seen the site.

THEN ASK FOR WHAT YOU ARE MISSING. A quotation is half a conversation, and the half that is absent
is where the money goes. A lump-sum line with no quantity behind it, a rate quoted over an area the
document never states, a scope that could reasonably mean two different things, a material whose
grade or brand decides its price — each of those is something you cannot judge and therefore
something to ask the buyer. Ask plainly, one sentence each, the way a quantity surveyor asks in the
first two minutes. Do not ask for anything the document already states.`;

const SCHEMA: JsonSchema = obj({
  contractor: str('The firm or person who issued the quotation, exactly as printed; "" when the document does not say'),
  stated_total: num('The grand total PRINTED on the document. 0 when no total is printed — do not add the lines up yourself', { minimum: 0 }),
  currency_ok: enumOf(['yes', 'no'], 'yes when the amounts are rupees; no when the document is in another currency'),
  confidence: num('0-1: how confident you are that you read this document correctly', { minimum: 0, maximum: 1 }),
  summary: str('One paragraph on the quotation as a whole: what it covers, what it visibly leaves out, and what to ask about'),
  questions: arr(str('One short question, addressed to the buyer, in plain words'), {
    description:
      'Up to four things you must ask the BUYER before this quotation can be judged. A lump-sum line with no quantity is a question. A rate with no area behind it is a question. A scope that could mean two things, or a material whose grade decides its price, is a question. Return an empty list ONLY when every line already states its quantity, its unit and its rate — which is rare. Never ask for something the document states.',
    maxItems: 4,
  }),
  notes: str('Anything about the document itself worth flagging — illegible sections, a missing page, a date; "" when there is nothing'),
  lines: arr(
    obj({
      label: str('The line description EXACTLY as printed on the document'),
      qty: num('Quantity if the line states one, else 0', { minimum: 0 }),
      unit: str('Unit as printed — bag, kg, sqft, nos, cft, rft, lump sum; "" when none'),
      rate: num('Rate per unit if the line states one, else 0', { minimum: 0 }),
      amount: num('The line amount in rupees. This is the only number that must be present', { minimum: 0 }),
      assessment: str('Short, plain: what this line covers and what to ask about it. Never an accusation'),
      confidence: num('0-1: how sure you are that you read THIS line correctly', { minimum: 0, maximum: 1 }),
    }),
    { description: 'Every priced line on the document, in the order it is printed', maxItems: 80 },
  ),
});

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const unit = (v: unknown): number => Math.min(1, Math.max(0, typeof v === 'number' && Number.isFinite(v) ? v : 0));

/**
 * Read the quotation with the first reader that answers.
 *
 * A failure here is almost never the document - it is a quota, a blocked key, a model having a
 * bad minute. Falling through costs one extra call in the rare case and is the difference between
 * a feature that works and a feature that works when the weather is fine.
 *
 * The file checks run ONCE, above the loop: a PDF that is too big is too big for every reader, and
 * asking three of them in turn to agree is three times the latency for the same answer.
 */
export async function readQuote(file: QuoteFile): Promise<QuoteReading> {
  const chain = readerChain();
  if (!chain.length) return mockReading(file);

  if (!(QUOTE_TYPES as readonly string[]).includes(file.mimeType))
    throw new QuoteError(`The reader cannot take ${file.mimeType} — photograph the quote as JPEG or PNG, or attach the PDF`, 415);
  if (file.bytes.length > QUOTE_MAX_BYTES) throw new QuoteError('That file is over 14 MB — a photograph of the page is plenty', 413);

  let last: unknown = null;
  for (const provider of chain) {
    try {
      return provider === 'anthropic' ? await readWithAnthropic(file) : await readWithGemini(file);
    } catch (e) {
      /* Logged rather than swallowed: a reader that is failing every time is a thing somebody has
         to fix, and a silent fallback hides it for as long as the other one holds. */
      console.warn(`[quote] ${provider} reader failed:`, (e as Error)?.message);
      last = e;
    }
  }
  throw last instanceof QuoteError ? last : new QuoteError('No reader could get through to a model just now. Try again in a moment.', 502);
}

/** The same key and model the assistant runs on - see lib/chat/anthropic. */
async function readWithAnthropic(file: QuoteFile): Promise<QuoteReading> {
  const res = await readDocumentAsJson({
    system: SYSTEM,
    prompt: PROMPT(file.name),
    schema: SCHEMA as unknown as Record<string, unknown>,
    file: { bytes: file.bytes, mimeType: file.mimeType },
    timeoutMs: QUOTE_TIMEOUT_MS,
  });
  if (!res.ok || !res.data) throw new QuoteError(`The reader could not get through to its model (${res.error?.code ?? 'unknown'}).`, 502);
  return toReading(res.data, 'anthropic');
}

async function readWithGemini(file: QuoteFile): Promise<QuoteReading> {
  const model = await resolveModel('pro', process.env.GEMINI_QUOTE_MODEL);
  const res = await generateJson<Record<string, unknown>>({
    caller: 'calculator.quote',
    model,
    system: SYSTEM,
    parts: [imagePart({ mimeType: file.mimeType, base64: file.bytes.toString('base64') }), PROMPT(file.name)],
    schema: SCHEMA,
    thinking: 'drawing',
    temperature: 0,
    mediaResolution: 'high',
    timeoutMs: QUOTE_TIMEOUT_MS,
  });
  return toReading(res.data, 'gemini');
}

const PROMPT = (name: string) =>
  `File: ${name}. Read every priced line on this quotation into the schema. Use 0 for a number the document does not state and "" for text it does not carry. Do not total the lines yourself.`;

/** Maps the strict-schema output onto `QuoteReading`. Exported so a test can drive it without a key. */
export function toReading(raw: unknown, provider: QuoteProvider): QuoteReading {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.currency_ok === 'no') throw new QuoteError('That quotation is not priced in rupees, so there is nothing here to compare it against', 422);

  const lines: ReadQuoteLine[] = (Array.isArray(r.lines) ? r.lines : [])
    .map((row, i): ReadQuoteLine | null => {
      const l = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
      const amount = pos(l.amount);
      const label = text(l.label, 160);
      /* A line with no amount or no description is not a line — it is a heading the reader
         mistook for one, and dropping it is better than showing a row of dashes. */
      if (amount === null || label === null) return null;
      return {
        line: i + 1,
        label,
        qty: pos(l.qty),
        unit: text(l.unit, 16),
        rate: pos(l.rate),
        amount,
        confidence: unit(l.confidence),
        assessment: text(l.assessment, 400),
      };
    })
    .filter((l): l is ReadQuoteLine => l !== null);

  if (lines.length === 0) throw new QuoteError('No priced lines could be read from that page — try a straighter, brighter photograph', 422);

  return {
    provider,
    lines,
    contractor: text(r.contractor, 120),
    statedTotal: pos(r.stated_total),
    summary: text(r.summary, 1200) ?? '',
    questions: (Array.isArray(r.questions) ? r.questions : [])
      .map((q) => text(q, 200))
      .filter((q): q is string => q !== null)
      .slice(0, 4),
    confidence: unit(r.confidence),
    notes: text(r.notes, 600) ?? '',
  };
}

/**
 * No key: say so, plainly, and do not pretend to have read anything.
 *
 * The drawing reader returns a labelled sample here. A quotation is somebody's real money and a
 * fabricated one would be worse than useless, so this returns nothing and names what is missing.
 * The paste box beside it still works and costs nothing, which is the honest fallback.
 */
function mockReading(file: QuoteFile): QuoteReading {
  return {
    provider: 'mock',
    lines: [],
    contractor: null,
    statedTotal: null,
    summary: '',
    questions: [],
    confidence: 0,
    notes: `No reader is configured, so ${file.name} was not read. Set GEMINI_API_KEY to read a photographed quote — or type the lines into the box, which works without one.`,
  };
}
