/**
 * The turn loop.
 *
 * Scope gate → tool loop → grounding validation → one silent repair → answer, and a refusal at
 * any point that fails. The ordering is the design: the cheapest guard runs first, and nothing
 * reaches the reader that has not been held against the facts the tools actually produced.
 *
 * The repair pass is worth its latency. Flash's grounding failures are overwhelmingly ONE bad
 * token in an otherwise correct answer — a rounded price, a brand carried over from the previous
 * turn — and handing the model its own violation list fixes most of them in a single round. What
 * survives two rounds is not a formatting slip, and that turn degrades to an honest refusal.
 *
 * ── PORTED, AND WHAT CHANGED ────────────────────────────────────────────────────────────────
 * The loop is the BuildO price-intelligence assistant's, because the loop is the part that is not
 * domain-specific. Three things are different here:
 *
 *   THE TOOLS ARE ASYNC. This store's catalogue is Meilisearch and Postgres, not a local SQLite
 *   file, so every call is awaited and the round's calls run CONCURRENTLY — four sequential
 *   searches would be four round trips where one is enough.
 *
 *   THERE IS NO ANSWER CACHE. The original keyed its cache on SQLite's data_version, so a
 *   collection run invalidated every entry the moment it committed and no stale price could ever
 *   be served. This store has no equivalent signal, and a cache with no invalidation is a
 *   promise to quote yesterday's price at somebody tomorrow. Left out rather than approximated.
 *
 *   THERE IS NO REGION GATE. The original refused a pincode it had no supply data for. Here the
 *   session already carries a served pincode — the store would not have let them in otherwise.
 */

import { allCategories } from '@/lib/catalog';
import { generate as anthropicGenerate, hasAnthropicKey } from './anthropic';
import { type GeminiContent, GeminiKeyMissing, type GenerateArgs, type GenerateResult, generate as geminiGenerate, hasKey as hasGeminiKey } from './gemini';
import { FactLedger } from './ledger';
import { SYSTEM_PROMPT, scopeBlock, TOOL_SCHEMAS, WELCOME } from './prompt';
import { shelfCategoryNamed } from './routing';
import { callTool, type ToolContext } from './tools';
import { checkScope, trimProse, type Violation, validateAll } from './validator';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface EngineInput {
  message: string;
  history: ChatMessage[];
  pincode: string;
  regionId: string;
}

export interface EngineTrace {
  scope: 'allowed' | 'blocked';
  tool_calls: Array<{ name: string; ok: boolean; ms: number }>;
  rounds: number;
  repaired: boolean;
  trimmed?: boolean;
  violations: Violation[];
  ledger: { numbers: number; entities: number; sources: number };
  model_ms: number;
  total_ms: number;
  tokens: { prompt: number; output: number; thoughts: number; cached: number } | null;
}

export interface EngineResult {
  reply: string;
  /** Structured payloads the panel renders as cards under the reply. */
  ui: unknown[];
  suggestions: string[];
  refused: boolean;
  trace: EngineTrace;
}

const MAX_TOOL_ROUNDS = 4;
const MAX_HISTORY_TURNS = 8;

function refusal(text: string, trace: Partial<EngineTrace>, t0: number): EngineResult {
  return {
    reply: text,
    ui: [],
    suggestions: WELCOME.chips.slice(0, 3).map((c) => c.prompt),
    refused: true,
    trace: {
      scope: 'blocked',
      tool_calls: [],
      rounds: 0,
      repaired: false,
      violations: [],
      ledger: { numbers: 0, entities: 0, sources: 0 },
      model_ms: 0,
      total_ms: Date.now() - t0,
      tokens: null,
      ...trace,
    },
  };
}

/**
 * The model, injectable.
 *
 * The one component here whose output cannot be asserted is the model, which makes it the one
 * that has to be substitutable — guard rails are only worth testing against a model that
 * misbehaves on purpose, and a real key returns a well-behaved answer that proves nothing.
 */
export interface EngineDeps {
  generate?: (a: GenerateArgs) => Promise<GenerateResult>;
  hasKey?: () => boolean;
}

/**
 * WHICH MODEL ANSWERS, decided by which key is set.
 *
 * Anthropic first when it is configured, because that is the deliberate choice; Gemini is the
 * fallback the store already had. Nothing above this line knows the difference — the engine, the
 * tools, the ledger and the validator are written against one contract and both clients speak it,
 * so the grounding guarantee is identical whichever answers.
 */
export function chatProvider(): 'anthropic' | 'gemini' | 'none' {
  if (hasAnthropicKey()) return 'anthropic';
  if (hasGeminiKey()) return 'gemini';
  return 'none';
}

export async function runTurn(input: EngineInput, deps: EngineDeps = {}): Promise<EngineResult> {
  const provider = chatProvider();
  const generate = deps.generate ?? (provider === 'anthropic' ? anthropicGenerate : geminiGenerate);
  const keyPresent = deps.hasKey ?? (() => provider !== 'none');
  const t0 = Date.now();
  const ctx: ToolContext = { pincode: input.pincode, regionId: input.regionId };

  /* ── 1. the scope gate, before a single token is spent ── */
  const scope = checkScope(input.message);
  if (!scope.allow) return refusal(scope.reply, { scope: 'blocked' }, t0);

  if (!keyPresent()) throw new GeminiKeyMissing();

  /* ── 2. the tool loop ── */
  const contents: GeminiContent[] = [];
  for (const m of input.history.slice(-MAX_HISTORY_TURNS * 2)) {
    contents.push({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] });
  }
  contents.push({ role: 'user', parts: [{ text: input.message }] });

  /*
   * THE CATALOGUE'S SHAPE, BEFORE THE FIRST TOKEN.
   *
   * One memoised read — the live table when there is a database, the frozen snapshot when there
   * is not — and it does two jobs at once:
   *
   *   IT GOES IN THE PROMPT, so the model knows what the store sells and what it is about to sell
   *   without spending a get_catalogue_scope round trip to find out. That call costs a whole
   *   extra generation; this costs about a hundred and forty tokens, once.
   *
   *   IT GOES IN THE LEDGER, because the validator rejects any named entity the tools did not
   *   return, and a category the model only ever saw in its instructions would be rejected as an
   *   invention. Telling the model something and then refusing to let it repeat that thing is the
   *   subtle way this feature would have failed.
   */
  const cats = await allCategories();
  const system = SYSTEM_PROMPT + scopeBlock(cats);

  const ledger = new FactLedger();
  ledger.entity(...cats.map((c) => c.name));
  /* Whether the TOOLS found anything, which is a different question from whether the ledger has
     anything in it now that the scope above is seeded into it. */
  let toolFacts = false;
  /* Which stocked category the customer just named, if any — see the nudge in the loop. */
  const onShelf = shelfCategoryNamed(input.message, cats);
  let searched = false;
  let nudged = false;
  const ui: unknown[] = [];
  const toolTrace: EngineTrace['tool_calls'] = [];
  let modelMs = 0;
  let tokens: EngineTrace['tokens'] = null;
  let rounds = 0;
  let draft = '';

  for (; rounds < MAX_TOOL_ROUNDS; rounds++) {
    const r = await generate({
      system,
      contents,
      tools: TOOL_SCHEMAS,
      toolMode: 'AUTO',
      /* A little thinking on the first round helps it choose between searching and estimating;
         none at all sent it to search for "what will my house cost". */
      thinkingBudget: rounds === 0 ? 512 : 0,
      maxOutputTokens: 1400,
    });
    modelMs += r.latency_ms;
    if (r.usage) tokens = r.usage;

    if (!r.ok) {
      const msg =
        r.error?.code === 'SAFETY_BLOCK'
          ? 'You can ask me any question you have regarding Build Objects.'
          : `The assistant cannot reach its model right now (${r.error?.code ?? 'unknown'}). Try again in a moment.`;
      return refusal(msg, { scope: 'allowed', rounds, tool_calls: toolTrace, model_ms: modelMs }, t0);
    }

    if (!r.calls.length) {
      /*
       * THE ONE ANSWER THAT MAY NOT COME FROM MEMORY.
       *
       * The prompt tells the model to search anything not on the coming-soon list, and the prompt
       * is a request. Asked "what steel and solar panels do you have", it answered "Steel &
       * Reinforcement and Solar Panels are both coming soon" — with three solar panels in stock —
       * because the two lists sat next to each other and the second name pattern-matched to the
       * first name's answer. The same build gave the right answer locally and the wrong one in
       * production, which is what model variance looks like and why this cannot be left to
       * wording alone.
       *
       * So when the customer has plainly named a stocked category and the model tried to answer
       * without looking, it is sent back once. Once, not until it complies: a loop that insists
       * would spend the whole round budget arguing on the turns where the match was spurious.
       */
      if (onShelf && !searched && !nudged) {
        nudged = true;
        contents.push({ role: 'model', parts: [{ text: r.text }] });
        contents.push({
          role: 'user',
          parts: [
            {
              /* "the whole question" is load-bearing. Naming one category and asking for a search
                 pulled the model's attention onto that category alone: "what steel and solar
                 panels do you have" came back listing three panels and never mentioning steel,
                 which is half the answer and the half the customer had to ask twice for. */
              text: `${onShelf} is one of our stocked categories, not a coming-soon one. Call search_products for it, then answer the customer's WHOLE question from what comes back — including any other material they asked about, which may be coming soon. Do not say ${onShelf} is coming soon.`,
            },
          ],
        });
        continue;
      }
      draft = r.text;
      break;
    }

    contents.push({ role: 'model', parts: r.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) });
    /* Concurrently. Every call in a round is independent by construction — the model asked for
       all of them before seeing any of their answers — and this store's tools are network calls,
       so running them in series would pay the slowest one several times over. */
    const outs = await Promise.all(
      r.calls.map(async (c) => {
        const ts = Date.now();
        const out = await callTool(c.name, c.args, ctx);
        toolTrace.push({ name: c.name, ok: !('error' in out.data), ms: Date.now() - ts });
        return out;
      }),
    );
    if (r.calls.some((c) => c.name === 'search_products')) searched = true;
    for (const out of outs) {
      if (!out.ledger.isEmpty) toolFacts = true;
      ledger.merge(out.ledger);
      if (out.ui?.length) ui.push(...out.ui);
    }
    contents.push({ role: 'user', parts: outs.map((out, i) => ({ functionResponse: { name: r.calls[i].name, response: { result: out.data } } })) });
  }

  if (!draft) {
    return refusal(
      'I could not work that out. Ask me for one thing at a time — a product, a price, or a house.',
      {
        scope: 'allowed',
        rounds,
        tool_calls: toolTrace,
        model_ms: modelMs,
      },
      t0,
    );
  }

  /* ── 3. grounding ── */
  const userText = [input.message, ...input.history.filter((m) => m.role === 'user').map((m) => m.content)].join('\n');
  const toolless = toolTrace.length === 0;

  let verdict = validateAll({ draft, ledger, userText, toolless });
  let repaired = false;
  let trimmed = false;

  /* Grounded, only long. Cut it here — free, instant, and a local trim cannot introduce a claim
     the way another model round can. The violation stays on the trace so the rate is visible. */
  if (!verdict.pass && verdict.trimmable) {
    draft = trimProse(draft);
    trimmed = true;
    verdict = { ...verdict, pass: true, repairInstruction: null };
  }

  /** The tools found facts; the prose did not survive. Hand over the cards. */
  const giveUp = (violations: Violation[]): EngineResult => {
    /* Logged for the same reason the chat route logs its 502: the reply the reader gets says
       nothing about WHY the draft was dropped, and without this the only evidence that the
       validator rejected something is a fallback sentence that looks like a deliberate answer. */
    console.warn('[chat] draft rejected:', violations.map((v) => `${v.kind}:${v.token}`).join(' '));
    return giveUpBody(violations);
  };
  const giveUpBody = (violations: Violation[]): EngineResult => ({
    reply: honestFallback(toolFacts, toolTrace, cats),
    ui,
    suggestions: suggestionsFrom(ui),
    refused: true,
    trace: {
      scope: 'allowed',
      tool_calls: toolTrace,
      rounds,
      repaired: true,
      trimmed,
      violations,
      ledger: ledger.size,
      model_ms: modelMs,
      total_ms: Date.now() - t0,
      tokens,
    },
  });

  if (!verdict.pass) {
    /* One silent repair. The model sees its own violations and nothing else new — and NO tool
       schemas on this call, because carrying 1,400 tokens of declarations alongside
       toolMode:'NONE' is paying for something the model is forbidden to use. */
    contents.push({ role: 'model', parts: [{ text: draft }] });
    contents.push({ role: 'user', parts: [{ text: verdict.repairInstruction as string }] });

    const r2 = await generate({ system, contents, toolMode: 'NONE', thinkingBudget: 0, maxOutputTokens: 900, temperature: 0.1 });
    modelMs += r2.latency_ms;
    if (r2.usage) tokens = r2.usage;

    /* The repair call itself failed — network, safety block, truncation. Falling through here
       would ship the ungrounded text this whole path exists to stop. */
    if (!r2.ok || !r2.text) return giveUp(verdict.violations);

    const v2 = validateAll({ draft: r2.text, ledger, userText, toolless });
    repaired = true;
    if (!v2.pass) return giveUp(v2.violations);
    draft = r2.text;
    verdict = v2;
  }

  return {
    reply: draft,
    ui,
    suggestions: suggestionsFrom(ui),
    refused: false,
    trace: {
      scope: 'allowed',
      tool_calls: toolTrace,
      rounds,
      repaired,
      trimmed,
      violations: verdict.violations,
      ledger: ledger.size,
      model_ms: modelMs,
      total_ms: Date.now() - t0,
      tokens,
    },
  };
}

/**
 * What to say when the model could not be made to stay grounded.
 *
 * Not an apology and not a blank — the tools DID return facts, so the turn hands those over
 * directly and drops the prose that failed. The reader gets the cards; only the sentence around
 * them is lost, which is the right thing to lose.
 */
function honestFallback(toolFacts: boolean, calls: EngineTrace['tool_calls'], cats: { name: string; status: 'live' | 'upcoming' }[]): string {
  if (!calls.length) return 'You can ask me any question you have regarding Build Objects.';
  if (!toolFacts) {
    /* Named from the live table rather than a hand-written list, which had drifted: it offered
       "solar" and "CCTV" but not the fire extinguishers or the total stations, so the sentence
       meant to rescue a failed search was itself under-selling the shelf. */
    const live = cats.filter((c) => c.status === 'live').map((c) => c.name);
    return `Nothing in the catalogue matched that. What is on the shelf today: ${live.join(', ')}.`;
  }
  return 'Straight from the catalogue below — I could not write a summary I trusted.';
}

/** Follow-ups drawn from what the tools actually returned, never invented. */
function suggestionsFrom(ui: unknown[]): string[] {
  const out: string[] = [];
  for (const u of ui as Array<{ kind?: string }>) {
    if (u?.kind === 'products') out.push('Which is cheapest?', 'What are the specs?');
    if (u?.kind === 'estimate') out.push('What changes at premium finish?', 'Where does the money go?');
  }
  return [...new Set(out)].slice(0, 3);
}

export { WELCOME };
