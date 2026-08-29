/**
 * Demo session cookie for scripts that drive pages behind the door (Lighthouse, screenshots, e2e).
 * Mirrors apps/web/lib/session.ts: HS256 JWT signed with SESSION_SECRET, cookie `bo_session`.
 */
import { createHmac } from 'node:crypto';
import { loadEnv } from '@buildobjects/db';

loadEnv();

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface DemoClaims {
  sid?: string;
  uid?: number;
  phone?: string;
  regionId?: string;
  pincode?: string;
  ttlSeconds?: number;
}

/** The raw JWT for the `bo_session` cookie (1 h by default). */
export function sessionToken(claims: DemoClaims = {}): string {
  const secret = process.env.SESSION_SECRET || 'buildo-local-dev-secret';
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(
    JSON.stringify({
      sid: claims.sid ?? 'script',
      uid: claims.uid ?? 0,
      phone: claims.phone ?? '9000000000',
      regionId: claims.regionId ?? 'hyd',
      pincode: claims.pincode ?? '500001',
      iat: now,
      exp: now + (claims.ttlSeconds ?? 3600),
    }),
  );
  const sig = b64u(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

/** `Cookie:` header value. */
export const sessionCookie = (claims: DemoClaims = {}): string => `bo_session=${sessionToken(claims)}`;

/** Playwright `context.addCookies()` entry. */
export function sessionCookieFor(baseUrl: string, claims: DemoClaims = {}): { name: string; value: string; domain: string; path: string } {
  const { hostname } = new URL(baseUrl);
  return { name: 'bo_session', value: sessionToken(claims), domain: hostname, path: '/' };
}
