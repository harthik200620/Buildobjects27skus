/**
 * The analysis-call budget for a live session: at most one call in flight, at least 2.5 s
 * between call starts, at most 40 calls per session (the UI offers "Continue" → `resume(n)`),
 * and a motion trigger (rotation ≥ 15° or flow ≥ 20 % of the frame since the last call) that
 * asks for an early call — subject to the same limits. The clock is injectable for tests.
 */
export interface CallBudgetOptions {
  minIntervalMs?: number;
  maxCalls?: number;
  motionRotationDeg?: number;
  motionFlowFrac?: number;
  now?: () => number;
}

export const BUDGET_DEFAULTS: Required<Omit<CallBudgetOptions, 'now'>> = { minIntervalMs: 2500, maxCalls: 40, motionRotationDeg: 15, motionFlowFrac: 0.2 };

export type BudgetDenial = 'in_flight' | 'too_soon' | 'exhausted';
export type CallReason = 'start' | 'timer' | 'motion' | 'watchdog' | 'manual' | 'retry';

export interface CallTicket {
  id: number;
  startedAt: number;
  reason: CallReason;
}

export interface BudgetSnapshot {
  calls: number;
  cap: number;
  remaining: number;
  inFlight: boolean;
  lastStartedAt: number | null;
  lastEndedAt: number | null;
  nextAllowedAt: number;
  exhausted: boolean;
}

export class CallBudget {
  private readonly minIntervalMs: number;
  private cap: number;
  private readonly motionRotationDeg: number;
  private readonly motionFlowFrac: number;
  private readonly now: () => number;
  private calls = 0;
  private nextId = 1;
  private inFlightTicket: CallTicket | null = null;
  private lastStartedAt: number | null = null;
  private lastEndedAt: number | null = null;

  constructor(opts: CallBudgetOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? BUDGET_DEFAULTS.minIntervalMs;
    this.cap = opts.maxCalls ?? BUDGET_DEFAULTS.maxCalls;
    this.motionRotationDeg = opts.motionRotationDeg ?? BUDGET_DEFAULTS.motionRotationDeg;
    this.motionFlowFrac = opts.motionFlowFrac ?? BUDGET_DEFAULTS.motionFlowFrac;
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  get inFlight(): boolean {
    return this.inFlightTicket !== null;
  }
  get count(): number {
    return this.calls;
  }
  get remaining(): number {
    return Math.max(0, this.cap - this.calls);
  }
  get exhausted(): boolean {
    return this.calls >= this.cap;
  }

  /** The earliest time a new call may start (ignoring in-flight). */
  nextAllowedAt(): number {
    return this.lastStartedAt === null ? 0 : this.lastStartedAt + this.minIntervalMs;
  }

  /** Why a call cannot start right now, or null when it can. */
  check(at = this.now()): BudgetDenial | null {
    if (this.inFlightTicket) return 'in_flight';
    if (this.exhausted) return 'exhausted';
    if (at < this.nextAllowedAt()) return 'too_soon';
    return null;
  }

  /** Reserve a call; null when denied (check `check()` for the reason). Always pair with `end()`. */
  begin(reason: CallReason = 'timer'): CallTicket | null {
    const at = this.now();
    if (this.check(at)) return null;
    const ticket: CallTicket = { id: this.nextId++, startedAt: at, reason };
    this.inFlightTicket = ticket;
    this.lastStartedAt = at;
    this.calls++;
    return ticket;
  }

  /** Release the in-flight slot. A stale ticket (not the one in flight) is ignored. */
  end(ticket: CallTicket): void {
    if (this.inFlightTicket?.id !== ticket.id) return;
    this.inFlightTicket = null;
    this.lastEndedAt = this.now();
  }

  /** Should this motion (since the last call) trigger an early analysis? True only when the budget would also allow it now. */
  motion(sample: { rotationDeg?: number; flowFrac?: number }): boolean {
    const moved = (sample.rotationDeg ?? 0) >= this.motionRotationDeg || (sample.flowFrac ?? 0) >= this.motionFlowFrac;
    return moved && this.check() === null;
  }

  /** Raise the session cap by n after the user chooses to continue. */
  resume(n: number): void {
    if (n > 0) this.cap += Math.floor(n);
  }

  snapshot(): BudgetSnapshot {
    return {
      calls: this.calls,
      cap: this.cap,
      remaining: this.remaining,
      inFlight: this.inFlight,
      lastStartedAt: this.lastStartedAt,
      lastEndedAt: this.lastEndedAt,
      nextAllowedAt: this.nextAllowedAt(),
      exhausted: this.exhausted,
    };
  }
}
