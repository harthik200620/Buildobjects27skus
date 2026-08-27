/**
 * The Anthropic Messages API, over raw HTTP, behind the same contract as gemini.ts.
 *
 * ── WHY A SECOND CLIENT AND NOT A REWRITE ───────────────────────────────────────────────────
 * The engine, the tools, the fact ledger and the grounding validator are all written against one
 * shape — `GenerateArgs` in, `GenerateResult` out, with `calls` for the tools the model wants
 * run. Nothing above this file knows or cares which model answered. So a new provider is a new
 * translation of that shape, not a change to any of it: this file speaks Anthropic on one side
 * and the engine's own vocabulary on the other, and the whole grounding guarantee is untouched.
 *
 * ── THE THREE PLACES THE TWO APIs DISAGREE ──────────────────────────────────────────────────
 * Every one of these is a silent failure if you get it wrong, so they are written out:
 *
 *   TOOLS. Gemini takes `parameters`; Anthropic takes `input_schema`. Same JSON Schema, different
 *   key, and a request with the wrong one is accepted with the tools simply ignored — the model
 *   then answers from its own weights and the validator refuses everything it says.
 *
 *   TOOL RESULTS GO BACK AS A USER TURN. Gemini has a `functionResponse` part; Anthropic wants a
 *   `user` message whose content is `tool_result` blocks carrying the `tool_use_id` from the
 *   call. The id has to be the one the model issued, not the tool's name.
 *
 *   `max_tokens` IS REQUIRED. Anthropic rejects a request without it. Gemini defaults.
 *
 * ── AND IT HAS A BASE URL ───────────────────────────────────────────────────────────────────
 * `ANTHROPIC_BASE_URL` so the same client can point at Anthropic directly or at a compatible
 * gateway. Nothing else changes.
 */

import type { GenerateArgs, GenerateResult } from './gemini';

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 45_000;

export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * BO_CHAT_*, NOT ANTHROPIC_*, and the reason is a bug this already caused.
 *
 * `ANTHROPIC_BASE_URL` is a machine-wide name: an SDK reads it, a shell profile exports it, a
 * local proxy sets it. Next gives the PROCESS environment precedence over `.env` — correctly, so
 * a deploy can override a checked-in default — which means whatever the machine happens to have
 * silently wins over what this app was configured with. On this machine the server's environment
 * carried `http://127.0.0.1:8787`, so every request went to a local port nothing was listening
 * on and came back as "cannot reach its model" while the endpoint in `.env` was fine and a curl
 * to it returned 200 in under two seconds.
 *
 * The store's assistant is its own setting and gets its own name. ANTHROPIC_* is still read as a
 * fallback for anyone who deliberately sets it, but it can no longer shadow an explicit choice.
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

  let lastErr: GenerateResult['error'] = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
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
      const err = e as { name?: string; message?: string } | null;
      if (err?.name === 'AbortError')
        return {
          ok: false,
          text: '',
          calls: [],
          finishReason: null,
          error: { code: 'TIMEOUT', message: 'The model did not answer in time.', retryable: true },
          usage: null,
          latency_ms: Date.now() - t0,
        };
      lastErr = { code: 'NETWORK', message: String(err?.message ?? e), retryable: true };
      /* Operational, and it earns its place: a fetch that throws inside a server runtime says
         nothing useful to the caller by design, so without this the only symptom is "cannot
         reach its model" and the cause — DNS, proxy, TLS, a bad base URL — is invisible. */
      console.error(`[chat] ${anthropicBase()}/messages failed:`, err?.message ?? e, (e as { cause?: unknown })?.cause ?? '');
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoff(attempt));
        continue;
      }
      break;
    }
    clearTimeout(timer);

    if (res.status === 429 || res.status >= 500) {
      lastErr = {
        code: `HTTP_${res.status}`,
        message: await res
          .text()
          .then((t) => t.slice(0, 200))
          .catch(() => ''),
        retryable: true,
      };
      if (attempt < MAX_ATTEMPTS - 1) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : backoff(attempt));
        continue;
      }
      break;
    }

    const json = (await res.json().catch(() => null)) as MessagesResponse | null;
    if (!json) {
      lastErr = { code: 'BAD_JSON', message: 'The model returned a body that is not JSON.', retryable: true };
      continue;
    }
    if (!res.ok || json.error) {
      return {
        ok: false,
        text: '',
        calls: [],
        finishReason: null,
        error: { code: `HTTP_${res.status}`, message: (json.error?.message ?? '').slice(0, 200), retryable: false },
        usage: null,
        latency_ms: Date.now() - t0,
      };
    }

    const blocks = json.content ?? [];
    const text = blocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const calls = blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use').map((b) => ({ name: b.name, args: b.input ?? {} }));

    return {
      ok: true,
      text,
      calls,
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

  return {
    ok: false,
    text: '',
    calls: [],
    finishReason: null,
    error: lastErr ?? { code: 'UNKNOWN', message: 'The model could not be reached.', retryable: false },
    usage: null,
    latency_ms: Date.now() - t0,
  };
}

/**
 * READ A DOCUMENT INTO A SCHEMA.
 *
 * `generate` above is a conversation: text in, text or tool calls out. This is the other thing this
 * API is good for and the chat path never needed — hand it a photograph or a PDF and force it to
 * answer in a fixed shape.
 *
 * Two details carry the whole function:
 *
 *   THE BLOCK TYPE DEPENDS ON THE FILE. An image is an `image` block, a PDF is a `document` block,
 *   and sending a PDF as an image is a 400 that reads like a malformed request rather than a wrong
 *   content type.
 *
 *   THE TOOL IS FORCED. `tool_choice: {type:'tool', name}` is what turns "please reply as JSON"
 *   into a guarantee. Asked politely in the prompt instead, a model that finds a document hard to
 *   read will explain why in prose, and the caller gets a parse error where it wanted an answer.
 *
 * The retry and timeout behaviour is deliberately the same as `generate`'s, because a document
 * read fails the same ways a chat turn does — an overloaded model, a dropped connection — and two
 * different retry policies in one file is one of them nobody remembers.
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

  const timeoutMs = args.timeoutMs ?? 90_000;
  let lastErr: GenerateResult['error'] = null;

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
      if (err?.name === 'AbortError')
        return {
          ok: false,
          data: null,
          error: { code: 'TIMEOUT', message: 'The reader timed out.', retryable: true },
          usage: null,
          latency_ms: Date.now() - t0,
        };
      console.error('[quote] reader fetch failed:', err?.message, err?.cause ?? '');
      lastErr = { code: 'NETWORK', message: err?.message ?? 'network error', retryable: true };
      if (attempt < MAX_ATTEMPTS - 1) await sleep(backoff(attempt));
      continue;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = { code: `HTTP_${res.status}`, message: detail.slice(0, 300), retryable };
      if (retryable && attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoff(attempt));
        continue;
      }
      return { ok: false, data: null, error: lastErr, usage: null, latency_ms: Date.now() - t0 };
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
    };
    const use = (json.content ?? []).find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
    if (!use?.input || typeof use.input !== 'object') {
      /* Forced tool use means this should be unreachable; if it ever is, it is a contract change
         and not something to paper over with a half-parsed answer. */
      lastErr = { code: 'NO_TOOL_USE', message: 'The reader answered without filling in the schema.', retryable: false };
      return { ok: false, data: null, error: lastErr, usage: null, latency_ms: Date.now() - t0 };
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

  return {
    ok: false,
    data: null,
    error: lastErr ?? { code: 'UNKNOWN', message: 'The reader could not be reached.', retryable: false },
    usage: null,
    latency_ms: Date.now() - t0,
  };
}
