'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import Welcome, { type Region, type WelcomeStep } from './Welcome';

/**
 * Where to go once the visitor is through the door.
 *
 * The proxy puts `?next=` on the redirect when somebody asked for a page before signing in. It
 * is read here rather than on the server because the page it lives on is prerendered — a static
 * document has no query string — and reading it here costs one property access at submit time.
 *
 * Only same-origin paths are honoured. `//evil.example` is a protocol-relative URL that a bare
 * `startsWith('/')` would wave through, so it is rejected explicitly.
 */
function destination(): string {
  if (typeof window === 'undefined') return '/';
  const next = new URLSearchParams(window.location.search).get('next');
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/** State + network for the front door. Welcome itself stays presentational. */
export default function WelcomeGate({ regions }: { regions: Region[] }) {
  const router = useRouter();
  const [regionId, setRegionId] = React.useState(regions[0]?.region_id ?? 'hyd');
  const [pincode, setPincode] = React.useState(regions[0]?.default_pincode ?? '500001');
  const [phone, setPhone] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [step, setStep] = React.useState<WelcomeStep>('start');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pincodeError = React.useMemo(() => {
    if (pincode.length < 6) return null;
    if (!/^5[0-3]\d{4}$/.test(pincode))
      return 'We do not deliver to that pincode yet. Today we cover Andhra Pradesh and Telangana — pincodes 50xxxx to 53xxxx.';
    return null;
  }, [pincode]);

  /* Typing a pincode that belongs to another seeded city moves the segment with it. */
  const onPincode = (p: string) => {
    setPincode(p);
    if (p.length === 6) {
      const r = regions.find((x) => p >= x.pincode_from && p <= x.pincode_to);
      if (r) setRegionId(r.region_id);
    }
  };

  async function sendOtp() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not send the code');
      setOtp('');
      setStep('verify');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, otp, regionId, pincode }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'That code did not match');
      router.replace(destination());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Welcome
      regions={regions}
      regionId={regionId}
      pincode={pincode}
      onRegion={setRegionId}
      onPincode={onPincode}
      pincodeError={pincodeError}
      phone={phone}
      onPhone={setPhone}
      otp={otp}
      onOtp={setOtp}
      step={step}
      onStep={(s) => {
        setError(null);
        setStep(s);
      }}
      busy={busy}
      error={error}
      onSendOtp={sendOtp}
      onLogin={login}
    />
  );
}
