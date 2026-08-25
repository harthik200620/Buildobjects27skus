export type LlmErrorCode = 'unavailable' | 'budget' | 'rate_limited' | 'bad_output' | 'api' | 'aborted';

/** Base class for every error this package raises on its own (SDK/network errors pass through untouched). */
export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status?: number;
  constructor(message: string, code: LlmErrorCode, opts: { status?: number; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'LlmError';
    this.code = code;
    this.status = opts.status;
  }
}

/** No GEMINI_API_KEY — callers must check `hasGemini()` first and degrade to their labelled mock. */
export class LlmUnavailableError extends LlmError {
  readonly unlock = 'GEMINI_API_KEY';
  constructor(message = 'Gemini is not configured — set GEMINI_API_KEY in .env to unlock live mode') {
    super(message, 'unavailable', { status: 503 });
    this.name = 'LlmUnavailableError';
  }
}

/** The daily call cap (GEMINI_DAILY_CALL_CAP) is exhausted for this process. */
export class LlmBudgetError extends LlmError {
  constructor(message: string) {
    super(message, 'budget', { status: 429 });
    this.name = 'LlmBudgetError';
  }
}

/** The model answered, but not with JSON that matches the schema. `raw` keeps the text for the log. */
export class LlmOutputError extends LlmError {
  readonly raw: string;
  constructor(message: string, raw: string, cause?: unknown) {
    super(message, 'bad_output', { cause });
    this.name = 'LlmOutputError';
    this.raw = raw;
  }
}
