import { getDb, otpChallenges } from '@buildobjects/db';
import { NextResponse } from 'next/server';

/**
 * Demo OTP: any Indian mobile number, the fixed code below, ten-minute validity. Nothing is sent
 * anywhere yet.
 *
 * The response deliberately carries no code. The sign-in screen prints the demo code itself, so
 * echoing it here buys nothing today and would hand out a live code on the day this starts
 * generating real ones — the kind of change that is easy to make and easy to forget to audit.
 */
const DEMO_CODE = '000000';
const VALIDITY_MS = 10 * 60_000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? '').replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(phone)) return NextResponse.json({ error: 'Enter a valid 10-digit Indian mobile number' }, { status: 400 });
  try {
    await getDb()
      .insert(otpChallenges)
      .values({ phone, code: DEMO_CODE, expiresAt: new Date(Date.now() + VALIDITY_MS) });
  } catch (e) {
    // The demo must work even before the schema exists; the login route re-validates the code.
    console.warn('[auth/otp] could not record challenge:', (e as Error).message);
  }
  return NextResponse.json({ ok: true, demo: true });
}
