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
