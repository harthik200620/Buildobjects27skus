'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { IconArrow, IconClockCheck, IconPin, IconRoom, IconShield } from './icons';
import Wordmark from './Wordmark';

/**
 * Sign-in, and the only screen that collects anything from the user.
 *
 * One markup tree, two layouts: the controls are written once and CSS places them — stacked
 * below 1024 px, split two-up above it. The decorative mark is the exception and is swapped in
 * JS rather than CSS, because the wide version is a WebGL canvas that should not be mounted at
 * all on a viewport that will not show it; narrow viewports get a 56 px PNG.
 *
 * We ask for three things: the pincode every price is landed at, a phone number, and a one-time
 * code. No password, no profile — the result is one httpOnly cookie.
 */

const StitchCanvas = dynamic(() => import('./LogoStitchCanvas'), { ssr: false });

/** The mark's real teal, sampled from the logo. A literal: the engine paints WebGL, not CSS. */
const THREAD = '#56d3d8';

export interface Region {
  region_id: string;
  name: string;
  state_code: string;
  pincode_from: string;
  pincode_to: string;
  default_pincode: string;
}
export type WelcomeStep = 'start' | 'deliver' | 'verify';

export default function Welcome({
  regions,
  regionId,
  pincode,
  onRegion,
  onPincode,
  pincodeError,
  phone,
  onPhone,
  otp,
  onOtp,
  step,
  onStep,
  busy,
  error,
  onSendOtp,
  onLogin,
}: {
  regions: Region[];
  regionId: string;
  pincode: string;
  onRegion: (r: string) => void;
  onPincode: (p: string) => void;
  pincodeError: string | null;
  phone: string;
  onPhone: (p: string) => void;
  otp: string;
  onOtp: (o: string) => void;
  step: WelcomeStep;
  onStep: (s: WelcomeStep) => void;
  busy: boolean;
  error: string | null;
  onSendOtp: () => void;
  onLogin: () => void;
}) {
  const pinRef = React.useRef<HTMLInputElement | null>(null);
  const otpRef = React.useRef<HTMLInputElement | null>(null);
  const region = regions.find((r) => r.region_id === regionId);
  const pinReady = /^\d{6}$/.test(pincode) && !pincodeError;
  const phoneReady = /^[6-9]\d{9}$/.test(phone);
  const otpReady = /^\d{6}$/.test(otp);

  /* The split is a layout fact, so the canvas follows the same 1024 px the CSS uses. False
     until mounted, so the server and the first client render agree. */
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  React.useEffect(() => {
    if (step === 'deliver') pinRef.current?.focus({ preventScroll: true });
  }, [step]);
  React.useEffect(() => {
    if (step === 'verify') otpRef.current?.focus({ preventScroll: true });
  }, [step]);

  /*
   * Four things the store does, in the words of what it does.
   *
   * Two of these used to read "Quality materials" and "Trusted brands" — claims that every
   * building-materials seller on the internet makes, that nobody can check, and that therefore
   * carry no information at all. A promise a competitor can copy verbatim is not a promise. What
   * replaces them is specific enough to be wrong, which is what makes it worth printing.
   */
  const marks = [
    { Icon: IconShield, label: 'Tax-paid prices' },
    { Icon: IconClockCheck, label: 'Every price dated and sourced' },
    { Icon: IconRoom, label: 'True-size view in your room' },
    { Icon: IconPin, label: 'Landed at your pincode' },
  ];

  return (
    <div className="welcome">
      {/* ── the figure ───────────────────────────────────────────────────── */}
      <div className="welcome-figure">
        {wide ? (
          <>
            <div className="welcome-figure-art">
              <StitchCanvas color={THREAD} sheen />
            </div>
            <p className="welcome-figure-caption">Construction materials · Andhra Pradesh &amp; Telangana</p>
          </>
        ) : (
          <Wordmark size={56} variant="mark" className="welcome-figure-mark" />
        )}
      </div>

      {/* ── sign-in ──────────────────────────────────────────────────────── */}
      <div className="welcome-entry">
        <div className="welcome-entry-in">
          <p className="welcome-eyebrow">Welcome to</p>
          {/* The lockup itself is the page's h1 — the name is drawn, not set, so the heading
              carries the drawing and the accessible name comes from the SVG's aria-label. */}
          <h1 className="welcome-title">
            <Wordmark size={44} variant="word" />
          </h1>
          <p className="welcome-lede">
            Construction materials from the brands your engineer already writes into the specification, priced per unit and landed at your pincode.
          </p>
          <p className="welcome-lede welcome-lede--2">Delivering today across Andhra Pradesh and Telangana.</p>

          <div className="welcome-steps">
            {step === 'start' && (
              <div className="welcome-stack">
                {/* One button, because there is one flow. "Get started" and "Log in / Sign up"
                    both called onStep('deliver'): the same three screens either way, since
                    there is no password and no separate registration. Two buttons that do the
                    same thing ask the visitor to make a choice that does not exist. */}
                <button type="button" onClick={() => onStep('deliver')} className="btn btn-primary btn--lg btn--block">
                  Set my pincode and enter <IconArrow size={16} />
                </button>
                <p className="caption">No password. Your pincode first, so every price you see is the landed one — then a mobile number and a one-time code.</p>
                <p className="caption">
                  Demo sign-in: any 10-digit mobile number, one-time code <span className="fig">000000</span>.
                </p>
              </div>
            )}

            {step === 'deliver' && (
              <div className="card card--pad welcome-card fade-in">
                <span className="field-label" id="welcome-city-label">
                  Deliver to
                </span>
                <div className="segmented segmented--lg" role="group" aria-labelledby="welcome-city-label">
                  {regions.map((r) => (
                    <button
                      key={r.region_id}
                      type="button"
                      onClick={() => {
                        onRegion(r.region_id);
                        onPincode(r.default_pincode);
                      }}
                      aria-pressed={regionId === r.region_id}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
                <label className="field-label" htmlFor="welcome-pin">
                  Pincode
                </label>
                <input
                  ref={pinRef}
                  id="welcome-pin"
                  value={pincode}
                  onChange={(e) => onPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  aria-invalid={!!pincodeError}
                  aria-describedby="welcome-pin-hint"
                  placeholder="6-digit pincode"
                  className="input input--lg fig"
                />
                <p id="welcome-pin-hint" role={pincodeError ? 'alert' : undefined} className={pincodeError ? 'field-error' : 'field-hint'}>
                  {pincodeError ??
                    `${region?.name ?? 'Your city'} — ${region ? `${region.pincode_from} to ${region.pincode_to}` : 'any AP or Telangana pincode'}. Other AP/TS pincodes work too.`}
                </p>

                <label className="field-label" htmlFor="welcome-phone">
                  Mobile number
                </label>
                <div className="welcome-row">
                  <span className="welcome-prefix fig">+91</span>
                  <input
                    id="welcome-phone"
                    value={phone}
                    onChange={(e) => onPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && pinReady && phoneReady) onSendOtp();
                    }}
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="10-digit mobile"
                    className="input input--lg fig"
                  />
                </div>
                {error && (
                  <p role="alert" className="field-error">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={onSendOtp}
                  disabled={!pinReady || !phoneReady || busy}
                  className="btn btn-primary btn--lg btn--block"
                  style={{ marginTop: 16 }}
                >
                  {busy ? 'Sending…' : 'Send one-time code'}
                </button>
              </div>
            )}

            {step === 'verify' && (
              <div className="card card--pad welcome-card fade-in">
                <label className="field-label" htmlFor="welcome-otp">
                  One-time code
                </label>
                <p className="meta">
                  Sent to{' '}
                  <span className="fig">
                    +91 {phone.slice(0, 5)} {phone.slice(5)}
                  </span>{' '}
                  · delivering to <span className="fig">{pincode}</span>
                </p>
                <input
                  ref={otpRef}
                  id="welcome-otp"
                  value={otp}
                  onChange={(e) => onOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && otpReady) onLogin();
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  className="input input--lg fig welcome-otp"
                  style={{ marginTop: 8 }}
                />
                <p role={error ? 'alert' : undefined} className={error ? 'field-error' : 'field-hint'}>
                  {error ?? 'Demo code: 000000'}
                </p>
                <button type="button" onClick={onLogin} disabled={!otpReady || busy} className="btn btn-primary btn--lg btn--block" style={{ marginTop: 16 }}>
                  {busy ? 'Entering…' : 'Enter Build Objects'}
                </button>
                <button type="button" onClick={() => onStep('deliver')} className="welcome-again">
                  Change number or pincode
                </button>
              </div>
            )}
          </div>

          <ul className="welcome-marks">
            {marks.map(({ Icon, label }) => (
              <li key={label}>
                <Icon size={20} />
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <p className="welcome-foot">
            <IconClockCheck size={14} /> Prices carry their date and source on every product page.
          </p>
        </div>
      </div>
    </div>
  );
}
