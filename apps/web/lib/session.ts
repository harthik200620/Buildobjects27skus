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

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET || 'buildo-local-dev-secret');

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(secret());
}

export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
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
