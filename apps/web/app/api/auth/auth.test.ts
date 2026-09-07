import { __resetGuardsForTests } from '@buildobjects/llm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The auth routes' job is to refuse bad input before anything else happens, and to hand back a
 * cookie that only this app can have signed. Both are worth a test: the validation is the entire
 * gate on who gets a session, and the cookie flags are the difference between an httpOnly
 * session and one any script on the page can read.
 *
 * The database is stubbed. These routes are written to survive an unreachable database — that
 * is deliberate, so the demo works before `pnpm db:seed` has ever run — and the tests hold them
 * to it rather than requiring MySQL to be up.
 *
 * THE THROTTLE BUCKETS ARE RESET BETWEEN TESTS. They are process-global by design (one sliding
 * window per key, shared by every request the process serves), so without the reset in
 * `beforeEach` the tests would leak into each other and whichever ran twelfth would start
 * failing with a 429 — a real behaviour, in the wrong place, and maddening to diagnose.
 */
const chain = () => {
  const self: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'insert', 'values', 'onDuplicateKeyUpdate']) {
    self[m] = vi.fn(() => self);
  }
  self.limit = vi.fn(async () => []);
  return self;
};

vi.mock('@buildobjects/db', () => ({
  getDb: vi.fn(() => chain()),
  users: {},
  sessions: {},
  regions: { regionId: 'region_id' },
  otpChallenges: {},
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({})) }));

const { POST: login } = await import('./login/route');
const { POST: sendOtp } = await import('./otp/route');

const post = (body: unknown) => new Request('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify(body) });

const valid = { phone: '9876543210', otp: '000000', pincode: '500001', regionId: 'hyd' };

beforeEach(() => {
  vi.clearAllMocks();
  __resetGuardsForTests();
});

describe('POST /api/auth/login', () => {
  it('issues a session for a valid demo login', async () => {
    const res = await login(post(valid));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, pincode: '500001' });
  });

  it('sets the session cookie httpOnly, lax and path-wide', async () => {
    const res = await login(post(valid));
    const cookie = res.cookies.get('bo_session');
    expect(cookie?.value).toBeTruthy();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    // Three dot-separated segments: it is a signed JWT, not an opaque string we made up.
    expect(cookie?.value.split('.')).toHaveLength(3);
  });

  it('rejects anything that is not a 10-digit Indian mobile number', async () => {
    for (const phone of ['', '123', '1234567890', '98765432101', 'abcdefghij', '5876543210']) {
      const res = await login(post({ ...valid, phone }));
      expect(res.status, `phone ${JSON.stringify(phone)}`).toBe(400);
    }
  });

  it('accepts a number written with spaces or a country code', async () => {
    // Non-digits are stripped before validation, so a pasted number still works.
    const res = await login(post({ ...valid, phone: '98765 43210' }));
    expect(res.status).toBe(200);
  });

  it('refuses a wrong code with 401, not 400', async () => {
    const res = await login(post({ ...valid, otp: '123456' }));
    expect(res.status).toBe(401);
  });

  it('refuses a pincode outside Andhra Pradesh and Telangana', async () => {
    for (const pincode of ['110001', '400001', '600001', '54321', '5000012']) {
      const res = await login(post({ ...valid, pincode }));
      expect(res.status, `pincode ${pincode}`).toBe(400);
    }
  });

  it('accepts every serviceable pincode band', async () => {
    for (const pincode of ['500001', '510001', '520001', '530001', '539999']) {
      const res = await login(post({ ...valid, pincode }));
      expect(res.status, `pincode ${pincode}`).toBe(200);
    }
  });

  it('falls back to a region derived from the pincode when the given one is unknown', async () => {
    // The stub returns no matching region row, so the route picks from the pincode prefix.
    await expect((await login(post({ ...valid, regionId: 'atlantis', pincode: '500001' }))).json()).resolves.toMatchObject({ regionId: 'hyd' });
    await expect((await login(post({ ...valid, regionId: 'atlantis', pincode: '520001' }))).json()).resolves.toMatchObject({ regionId: 'vij' });
  });

  it('answers a malformed body with a validation error rather than throwing', async () => {
    const res = await login(new Request('http://localhost/api/auth/login', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/otp', () => {
  const otpPost = (body: unknown) => new Request('http://localhost/api/auth/otp', { method: 'POST', body: JSON.stringify(body) });

  it('accepts a valid mobile number', async () => {
    const res = await sendOtp(otpPost({ phone: '9876543210' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it('rejects an invalid mobile number', async () => {
    for (const phone of ['', '123', '5876543210']) {
      expect((await sendOtp(otpPost({ phone }))).status, phone).toBe(400);
    }
  });

  it('never returns the code in the response body', async () => {
    // The demo code is published in the UI copy; the endpoint still must not echo a code, or a
    // real SMS implementation would leak one the day it replaces this.
    const body = await (await sendOtp(otpPost({ phone: '9876543210' }))).json();
    expect(JSON.stringify(body)).not.toContain('000000');
  });
});

/**
 * The sign-in throttles.
 *
 * These two routes are the only ones a stranger can reach without a session, and until this they
 * had no limit at all: /api/auth/otp wrote a database row per call (and becomes an SMS gateway
 * the day the code is real), and /api/auth/login verified a six-digit code a caller could guess
 * a million times. See lib/rate-limit.ts for the numbers and why the buckets are split.
 */
describe('the sign-in throttles', () => {
  const otpPost = (phone: string, ip = '203.0.113.1') =>
    new Request('http://localhost/api/auth/otp', { method: 'POST', body: JSON.stringify({ phone }), headers: { 'x-forwarded-for': ip } });
  const loginPost = (body: unknown, ip = '203.0.113.1') =>
    new Request('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': ip } });

  it('stops a script asking for codes for one number forever', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await sendOtp(otpPost('9876543210'))).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
  });

  it('answers a refusal with Retry-After, so a caller is told when to come back', async () => {
    for (let i = 0; i < 5; i++) await sendOtp(otpPost('9876543210'));
    const res = await sendOtp(otpPost('9876543210'));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  /* The attack the per-address bucket alone would miss: one number, many addresses. */
  it('holds the per-number limit even when every request comes from a different address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await sendOtp(otpPost('9876543210', `198.51.100.${i}`))).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });

  /* And the attack the per-number bucket alone would miss: one host, walking a list. */
  it('holds the per-address limit even when every request names a different number', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 13; i++) statuses.push((await sendOtp(otpPost(`98765432${String(i).padStart(2, '0')}`))).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
  });

  it('caps how many codes can be guessed for one number', async () => {
    const wrong = { phone: '9876543210', otp: '123456', pincode: '500001', regionId: 'hyd' };
    const statuses: number[] = [];
    for (let i = 0; i < 13; i++) statuses.push((await login(loginPost(wrong))).status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
  });

  /* A correct code must not refill the budget — otherwise an attacker with one working account
     interleaves a valid sign-in and guesses forever. */
  it('counts a successful sign-in against the limit too', async () => {
    for (let i = 0; i < 10; i++) expect((await login(loginPost(valid))).status).toBe(200);
    expect((await login(loginPost(valid))).status).toBe(429);
  });

  /* A malformed number is rejected before the throttle, so a caller cannot exhaust a real
     number's allowance by naming it badly — and typos cost an honest user nothing. */
  it('does not spend a slot on a number that is not a number', async () => {
    for (let i = 0; i < 20; i++) expect((await sendOtp(otpPost('123'))).status).toBe(400);
    expect((await sendOtp(otpPost('9876543210'))).status).toBe(200);
  });
});
