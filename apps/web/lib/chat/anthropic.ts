/**
 * The Anthropic Messages API over raw HTTP, behind the same contract as gemini.ts. Nothing above
 * this file knows which model answered, so a provider is a translation of `GenerateArgs` in and
 * `GenerateResult` out — the grounding guarantee is untouched.
 *
 * Three places the two APIs disagree, each a silent failure if you get it wrong:
 *
 *   TOOLS. Gemini takes `parameters`, Anthropic `input_schema`. Same JSON Schema, different key,
 *   and the wrong one is ACCEPTED with the tools ignored — the model then answers from its own
 *   weights and the validator refuses everything it says.
 *   TOOL RESULTS GO BACK AS A USER TURN, whose content is `tool_result` blocks carrying the
 *   `tool_use_id` the model issued — not the tool's name.
 *   `max_tokens` IS REQUIRED. Gemini defaults; Anthropic rejects the request.
 */

import type { GenerateArgs, GenerateResult } from './gemini';

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 45_000;

export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * BO_CHAT_*, not ANTHROPIC_*.
 *
 * `ANTHROPIC_BASE_URL` is a machine-wide name — an SDK reads it, a shell profile exports it, a
 * local proxy sets it — and Next gives the process environment precedence over `.env`. On this
 * machine that silently pointed every request at `http://127.0.0.1:8787`, which returned "cannot
 * reach its model" while the endpoint in `.env` answered a curl in two seconds.
 *
 * ANTHROPIC_* is still read as a fallback, but it can no longer shadow an explicit choice.
 */
const pick = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n];
    if (v?.trim()) return v.trim();
  }
  return undefined;
};

export function anthropicBase(): string {
  return (pick('BO_CHAT_BASE_URL', 'ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '');
}

export function anthropicModel(): string {
  return pick('BO_CHAT_MODEL', 'ANTHROPIC_CHAT_MODEL') ?? 'claude-haiku-4-5-20251001';
}

export function chatKey(): string | undefined {
  return pick('BO_CHAT_API_KEY', 'ANTHROPIC_API_KEY');
}

export function hasAnthropicKey(): boolean {
  return !!chatKey();
}

/* Anthropic's content blocks, as narrowly as this file needs them. */
interface TextBlock {
  type: 'text';
  text: string;
}
interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
type OutBlock = TextBlock | ToolUseBlock | { type: string };

interface MessagesResponse {
  content?: OutBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  error?: { message?: string; type?: string };
}

type InBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (n: number) => Math.min(4_000, 350 * 2 ** n) + Math.random() * 200;

/**
 * The engine's history, translated.
 *
 * `functionCall` parts become `tool_use` blocks and `functionResponse` parts become a USER turn
 * of `tool_result` blocks — and the ids have to line up, so a call's id is derived from its
 * position in the conversation. The engine pushes calls and their responses in matching order in
 * the same round, which is what makes that safe.
 */
function toMessages(args: GenerateArgs): Array<{ role: 'user' | 'assistant'; content: string | InBlock[] }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string | InBlock[] }> = [];
  let call = 0;
  let lastCallIds: string[] = [];

  for (const c of args.contents) {
    const uses: InBlock[] = [];
    const results: InBlock[] = [];
    const texts: string[] = [];

    for (const p of c.parts) {
      if (p.functionCall) {
        const id = `call_${call++}`;
        uses.push({ type: 'tool_use', id, name: p.functionCall.name, input: p.functionCall.args ?? {} });
      } else if (p.functionResponse) {
        results.push({
          type: 'tool_result',
          tool_use_id: lastCallIds[results.length] ?? `call_${call - 1}`,
          content: JSON.stringify(p.functionResponse.response ?? {}),
        });
      } else if (typeof p.text === 'string' && p.text) {
        texts.push(p.text);
      }
    }

    if (uses.length) {
      lastCallIds = uses.map((u) => (u as { id: string }).id);
      out.push({ role: 'assistant', content: texts.length ? [{ type: 'text', text: texts.join('\n') } as InBlock, ...uses] : uses });
    } else if (results.length) {
      out.push({ role: 'user', content: results });
    } else if (texts.length) {
      out.push({ role: c.role === 'model' ? 'assistant' : 'user', content: texts.join('\n') });
    }
  }
  return out;
}

/**
 * One POST to /messages, retried, and nothing at all about what the answer means.
 *
 * `generate` and `readDocumentAsJson` each had their own copy of this, and two copies of a retry
 * policy is two policies: one honoured `retry-after` and the other ignored it, one treated a
 * non-JSON body as a retryable attempt and the other let `res.json()` throw out of the loop.
 *
 * The MEANING stays with the caller — a chat turn and a filled-in schema are not the same answer,
 * and a transport that started interpreting bodies would have to know about both.
 */
type Wire = { ok: true; json: unknown } | { ok: false; error: NonNullable<GenerateResult['error']> };

async function postMessages(key: string, body: unknown, timeoutMs: number, tag: string): Promise<Wire> {
  let last: NonNullable<GenerateResult['error']> | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${anthropicBase()}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e: unknown) {
      clearTimeout(timer);
      const err = e as { name?: string; message?: string; cause?: unknown } | null;
      if (err?.name === 'AbortError') return { ok: false, error: { code: 'TIMEOUT', message: 'The model did not answer in time.', retryable: true } };
      /* Operational, and it earns its place: a fetch that throws inside a server runtime says
         nothing useful to the caller by design, so without this the only symptom is "cannot reach
         its model" and the cause — DNS, proxy, TLS, a bad base URL — is invisible. */
      console.error(`[${tag}] ${anthropicBase()}/messages failed:`, err?.message ?? e, err?.cause ?? '');
      last = { code: 'NETWORK', message: String(err?.message ?? e), retryable: true };
      if (attempt < MAX_ATTEMPTS - 1) await sleep(backoff(attempt));
      continue;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const detail = await res
        .text()
        .then((t) => t.slice(0, 300))
        .catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      last = { code: `HTTP_${res.status}`, message: detail, retryable };
      if (!retryable || attempt === MAX_ATTEMPTS - 1) return { ok: false, error: last };
      /* `retry-after` is the server saying when it will be ready; the backoff is only a guess. */
      const after = Number(res.headers.get('retry-after')) * 1000;
      await sleep(Number.isFinite(after) && after > 0 ? after : backoff(attempt));
      continue;
    }

    const json = await res.json().catch(() => null);
    if (json !== null) return { ok: true, json };
    last = { code: 'BAD_JSON', message: 'The model returned a body that is not JSON.', retryable: true };
    if (attempt < MAX_ATTEMPTS - 1) await sleep(backoff(attempt));
  }

  return { ok: false, error: last ?? { code: 'UNKNOWN', message: 'The model could not be reached.', retryable: false } };
}

export async function generate(args: GenerateArgs): Promise<GenerateResult> {
  const t0 = Date.now();
  const key = chatKey();
  if (!key) {
    return {
      ok: false,
      text: '',
      calls: [],
      finishReason: null,
      error: { code: 'NO_KEY', message: 'BO_CHAT_API_KEY is not set.', retryable: false },
      usage: null,
      latency_ms: 0,
    };
  }

  const body: Record<string, unknown> = {
    model: anthropicModel(),
    /* Required by this API — a request without it is a 400, which is the sort of difference that
       only shows up as "the assistant is having trouble reaching its model". */
    max_tokens: args.maxOutputTokens ?? 1400,
    system: args.system,
    messages: toMessages(args),
    temperature: args.temperature ?? 0.2,
  };
  if (args.tools?.length && args.toolMode !== 'NONE') {
    /* `input_schema`, not `parameters`. With the wrong key the request still succeeds and the
       tools are simply absent, so the model answers ungrounded and the validator refuses it —
       a failure that looks like a bad model rather than a bad request. */
    body.tools = args.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    if (args.toolMode === 'ANY') body.tool_choice = { type: 'any' };
  }

  const fail = (error: NonNullable<GenerateResult['error']>): GenerateResult => ({
    ok: false,
    text: '',
    calls: [],
    finishReason: null,
    error,
    usage: null,
    latency_ms: Date.now() - t0,
  });

  const wire = await postMessages(key, body, TIMEOUT_MS, 'chat');
  if (!wire.ok) return fail(wire.error);
  const json = wire.json as MessagesResponse;
  if (json.error) return fail({ code: 'MODEL_ERROR', message: (json.error.message ?? '').slice(0, 200), retryable: false });

  const blocks = json.content ?? [];
  const text = blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return {
    ok: true,
    text,
    calls: blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use').map((b) => ({ name: b.name, args: b.input ?? {} })),
    finishReason: json.stop_reason ?? null,
    error: null,
    usage: {
      prompt: json.usage?.input_tokens ?? 0,
      output: json.usage?.output_tokens ?? 0,
      thoughts: 0,
      cached: json.usage?.cache_read_input_tokens ?? 0,
    },
    latency_ms: Date.now() - t0,
  };
}

/**
 * Read a document into a schema: hand it a photograph or a PDF and force a fixed shape back.
 *
 * THE BLOCK TYPE DEPENDS ON THE FILE — an image is an `image` block, a PDF a `document` block, and
 * sending a PDF as an image is a 400 that reads like a malformed request.
 *
 * THE TOOL IS FORCED. `tool_choice: {type:'tool', name}` turns "please reply as JSON" into a
 * guarantee; asked politely in the prompt, a model that finds a document hard to read explains why
 * in prose and the caller gets a parse error where it wanted an answer. Transport and retries are
 * `postMessages` above, the same ones a chat turn uses.
 */
export interface DocumentReadArgs {
  system: string;
  prompt: string;
  /** JSON Schema for the answer. Passed through as the forced tool's `input_schema`. */
  schema: Record<string, unknown>;
  file: { bytes: Buffer; mimeType: string };
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface DocumentReadResult {
  ok: boolean;
  data: Record<string, unknown> | null;
  error: GenerateResult['error'];
  usage: GenerateResult['usage'];
  latency_ms: number;
}

const TOOL_NAME = 'record_reading';

export async function readDocumentAsJson(args: DocumentReadArgs): Promise<DocumentReadResult> {
  const t0 = Date.now();
  const key = chatKey();
  if (!key) return { ok: false, data: null, error: { code: 'NO_KEY', message: 'BO_CHAT_API_KEY is not set.', retryable: false }, usage: null, latency_ms: 0 };

  const isPdf = args.file.mimeType === 'application/pdf';
  const source = { type: 'base64', media_type: args.file.mimeType, data: args.file.bytes.toString('base64') };
  const body = {
    model: anthropicModel(),
    max_tokens: args.maxOutputTokens ?? 8000,
    system: args.system,
    temperature: 0,
    tools: [{ name: TOOL_NAME, description: 'Record what you read from the document.', input_schema: args.schema }],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [isPdf ? { type: 'document', source } : { type: 'image', source }, { type: 'text', text: args.prompt }],
      },
    ],
  };

  const wire = await postMessages(key, body, args.timeoutMs ?? 90_000, 'quote');
  if (!wire.ok) return { ok: false, data: null, error: wire.error, usage: null, latency_ms: Date.now() - t0 };

  const json = wire.json as {
    content?: Array<{ type: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  };
  const use = (json.content ?? []).find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!use?.input || typeof use.input !== 'object') {
    /* Forced tool use means this should be unreachable; if it ever is, it is a contract change
       and not something to paper over with a half-parsed answer. */
    return {
      ok: false,
      data: null,
      error: { code: 'NO_TOOL_USE', message: 'The reader answered without filling in the schema.', retryable: false },
      usage: null,
      latency_ms: Date.now() - t0,
    };
  }

  return {
    ok: true,
    data: use.input as Record<string, unknown>,
    error: null,
    usage: {
      prompt: json.usage?.input_tokens ?? 0,
      output: json.usage?.output_tokens ?? 0,
      thoughts: 0,
      cached: json.usage?.cache_read_input_tokens ?? 0,
    },
    latency_ms: Date.now() - t0,
  };
}
