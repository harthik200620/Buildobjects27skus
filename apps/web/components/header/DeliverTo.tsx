'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import { IconChevronDown, IconPin } from '@/components/icons';
import Scrim from '@/components/Scrim';
import { useDismiss } from '@/components/useDismiss';

type Note = { ok: boolean; text: string };

/**
 * "Deliver to {City} {pincode}". The panel takes a pincode, PATCHes /api/auth/session (which
 * re-signs the cookie and returns the serviceability note), shows the note, and refreshes the
 * tree so every price and delivery date is landed at the new pincode. A popover on desktop,
 * a bottom sheet on a phone — same DOM, CSS decides.
 */
export default function DeliverTo({
  pincode,
  regionName,
  deliveryDays,
  variant = 'header',
}: {
  pincode: string;
  regionName: string;
  deliveryDays: number | null;
  variant?: 'header' | 'strip';
}) {
  const router = useRouter();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [pin, setPin] = React.useState(pincode);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<Note | null>(null);
  const wrap = React.useRef<HTMLDivElement | null>(null);
  const input = React.useRef<HTMLInputElement | null>(null);
  const trigger = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    setPin(pincode);
  }, [pincode]);
  useDismiss(open, () => setOpen(false), { panel: wrap, trigger });

  React.useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) {
      setNote({ ok: false, text: 'Enter a 6-digit pincode' });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/auth/session', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pincode: pin }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; serviceability?: { serviceable: boolean; note: string } };
      if (!res.ok) throw new Error(j.error || 'Could not update the pincode');
      setNote({ ok: j.serviceability?.serviceable !== false, text: j.serviceability?.note ?? 'Pincode updated' });
      router.refresh();
      window.setTimeout(() => setOpen(false), 900);
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const panel = open && (
    <>
      <Scrim className="deliver-scrim" onDismiss={() => setOpen(false)} />
      <div className="popover deliver-pop fade-in" role="dialog" aria-labelledby={`${id}-t`}>
        <h3 className="h3" id={`${id}-t`}>
          Choose your delivery location
        </h3>
        <p className="meta">
          Prices and delivery dates are landed at this pincode.
          {deliveryDays ? ` Currently ${deliveryDays} ${deliveryDays === 1 ? 'day' : 'days'} to ${regionName}.` : ''}
        </p>
        <form className="deliver-form" onSubmit={apply}>
          <label className="field-label" htmlFor={`${id}-pin`}>
            Pincode
          </label>
          <div className="deliver-form-row">
            <input
              ref={input}
              id={`${id}-pin`}
              className="input fig"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="6-digit pincode"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-invalid={note && !note.ok ? true : undefined}
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Checking…' : 'Apply'}
            </button>
          </div>
          {note ? (
            <p className={note.ok ? 'field-hint deliver-ok' : 'field-error'} role="status">
              {note.text}
            </p>
          ) : (
            <p className="field-hint">We deliver to Andhra Pradesh and Telangana today — pincodes 50xxxx to 53xxxx.</p>
          )}
        </form>
      </div>
    </>
  );

  if (variant === 'strip') {
    return (
      <div className="deliver-wrap deliver-wrap--strip" ref={wrap}>
        <button ref={trigger} type="button" className="deliver-strip-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
          <IconPin size={16} />
          <span className="deliver-strip-text">
            Deliver to{' '}
            <b>
              {regionName} <span className="fig">{pincode}</span>
            </b>
          </span>
          <IconChevronDown size={14} />
        </button>
        {panel}
      </div>
    );
  }

  return (
    <div className="deliver-wrap deliver-wrap--header" ref={wrap}>
      <button ref={trigger} type="button" className="deliver-to" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <IconPin size={20} />
        <span className="deliver-to-text">
          <span className="deliver-to-label">Deliver to</span>
          <span className="deliver-to-value">
            {regionName} <span className="fig">{pincode}</span>
          </span>
        </span>
      </button>
      {panel}
    </div>
  );
}
