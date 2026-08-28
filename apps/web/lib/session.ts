import { jwtVerify, SignJWT } from 'jose';

/**
 * Demo auth. A signed, httpOnly cookie carries the session; the `sessions` row exists for
 * audit and logout. The proxy verifies the cookie statelessly, so no request pays a DB read.
 */
export const SESSION_COOKIE = 'bo_session';
export const SESSION_DAYS = 30;

export interface SessionClaims {
  sid: string;
  uid: number;
  phone: string;
  regionId: string;
  pincode: string;
}

/**
 * The signing key, and the one place this store can be impersonated if it is wrong.
 *
 * The development fallback below is a literal in a PUBLIC repository. A production build that used
 * it would accept any `bo_session` cookie a reader of this file could mint — a login as any phone
 * number, on a live store. So it is a development fallback and nothing else: with NODE_ENV set to
 * production and no SESSION_SECRET, this throws rather than falling back, which fails the login
 * route and returns null from every verification. Everyone is logged out, which is recoverable;
 * everyone is forgeable is not.
 */
const secret = () => {
  const configured = process.env.SESSION_SECRET;
  if (configured) return new TextEncoder().encode(configured);
  if (process.env.NODE_ENV === 'production')
    throw new Error('SESSION_SECRET is not set. Sessions are disabled rather than signed with the public development key.');
  return new TextEncoder().encode('buildo-local-dev-secret');
};

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(secret());
}

export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    /* `secret()` throwing lands here too, which is the intent: an unconfigured deployment
       verifies nothing rather than verifying against a key anybody can read. */
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (typeof payload.sid !== 'string' || typeof payload.phone !== 'string') return null;
    return {
      sid: payload.sid,
      uid: Number(payload.uid),
      phone: payload.phone,
      regionId: String(payload.regionId ?? 'hyd'),
      pincode: String(payload.pincode ?? '500001'),
    };
  } catch {
    return null;
  }
}

export const cookieOptions = (maxAgeSeconds = SESSION_DAYS * 86400) => ({
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: maxAgeSeconds,
});
