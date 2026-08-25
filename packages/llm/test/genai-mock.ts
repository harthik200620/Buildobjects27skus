import { vi } from 'vitest';

/**
 * Shared stand-in for `@google/genai`. Every test file registers
 *   vi.mock('@google/genai', async (orig) => ({ ...(await orig()), GoogleGenAI: (await import('./genai-mock')).GoogleGenAI }))
 * so the real enums / ApiError stay available while the client is this fake.
 */
export const generateContent = vi.fn();
export const list = vi.fn();
export const ctor = vi.fn();

export class GoogleGenAI {
  models = { generateContent, list };
  constructor(opts: unknown) {
    ctor(opts);
  }
}

export function okResponse(text: string, extra: Record<string, unknown> = {}) {
  return {
    text,
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 125 },
    modelVersion: 'mock-version',
    candidates: [{ content: { parts: [{ text }] } }],
    ...extra,
  };
}

export function modelList(entries: { name: string; actions?: string[] }[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of entries) yield { name: `models/${e.name}`, supportedActions: e.actions ?? ['generateContent'] };
    },
  };
}

export function lastRequest(): {
  model: string;
  contents: { role: string; parts: { text?: string; inlineData?: unknown }[] }[];
  config: Record<string, unknown>;
} {
  const calls = generateContent.mock.calls;
  return calls[calls.length - 1][0];
}
