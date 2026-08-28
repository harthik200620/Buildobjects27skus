'use client';

import React from 'react';
import { IconCamera, IconCheck, IconClose, IconUser } from '@/components/icons';
import Wordmark from '@/components/Wordmark';
import { ageFrom, type Gender, loadPassport, loadPhoto, mrz, type Passport, passportId, readPhoto, savePassport, savePhoto } from '@/lib/passport';

/**
 * The BO Passport, as a card and as a form.
 *
 * A passport data page is the most-read identity layout on earth: everybody already knows the
 * number is at the top right, the photograph at the left, the fields a two-column grid of tiny
 * labels over larger values, and the two lines at the foot the machine's copy of the rest.
 * Borrowing it means nobody has to be taught how to read this card.
 *
 * SO IT SAYS WHAT IT IS, TWICE — the issuing authority line carries the wordmark, and a standing
 * note says it is not a government document. A loyalty card styled after a passport is a design
 * decision; one that could be mistaken for a travel document is a forgery, and the difference is
 * entirely in whether the card tells you which it is.
 *
 * THE NUMBER IS NOT A FIELD. It is derived from the account itself (lib/passport.ts): a number a
 * person can type is a number two people can share.
 *
 * Editing happens IN the card, in the same grid, with the same labels — the fields sit exactly
 * where the values sat, so nothing moves when you press Edit and nothing has to be re-found when
 * you press Done. A separate form on a separate screen is how a card and its data drift apart.
 */

export interface BoPassportProps {
  /** From the session — the two things the number is derived from. */
  uid: number | string;
  phone: string;
}

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'F', label: 'Female' },
  { value: 'M', label: 'Male' },
  { value: 'X', label: 'Other' },
];

export default function BoPassport({ uid, phone }: BoPassportProps) {
  const [data, setData] = React.useState<Passport>(() => ({ name: '', address: '', mobile: '', email: '', gender: '', dob: '', role: '' }));
  const [photo, setPhoto] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Passport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const file = React.useRef<HTMLInputElement>(null);

  /* Read after mount: localStorage does not exist on the server, and rendering the empty card
     first means the markup the server sent and the markup React expects are the same. */
  React.useEffect(() => {
    const p = loadPassport();
    setData({ ...p, mobile: p.mobile || phone });
    setPhoto(loadPhoto());
  }, [phone]);

  const id = passportId(uid, phone);
  const shown = editing && draft ? draft : data;
  const age = ageFrom(shown.dob);
  const [mrz1, mrz2] = mrz(shown, id);

  const start = () => {
    setDraft({ ...data });
    setError(null);
    setEditing(true);
  };
  const cancel = () => {
    setDraft(null);
    setEditing(false);
  };
  const save = () => {
    if (!draft) return;
    savePassport(draft);
    setData(draft);
    setDraft(null);
    setEditing(false);
  };
  const field = (k: keyof Passport, v: string) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const onPhoto = async (f: File) => {
    try {
      const url = await readPhoto(f);
      savePhoto(url);
      setPhoto(url);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="pass" data-editing={editing ? 'true' : undefined}>
      {/* ── the header band ─────────────────────────────────────────────── */}
      <div className="pass-band">
        <div className="pass-issuer">
          <Wordmark size={22} variant="full" />
          <p className="pass-issuer-sub micro">Builder identity · Telangana &amp; Andhra Pradesh</p>
        </div>
        <div className="pass-number">
          <p className="micro">Passport no.</p>
          <p className="pass-number-fig fig">{id}</p>
        </div>
      </div>

      {/* ── the data page ───────────────────────────────────────────────── */}
      <div className="pass-body">
        <div className="pass-photo-col">
          <div className="pass-photo">
            {photo ? <img src={photo} alt="" /> : <IconUser size={44} />}
            {/* The camera is only offered while editing — a card you can accidentally re-photograph
                by brushing it is a card nobody trusts. */}
            {editing && (
              <button type="button" className="pass-photo-btn" onClick={() => file.current?.click()}>
                <IconCamera size={14} /> {photo ? 'Replace' : 'Add photo'}
              </button>
            )}
          </div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPhoto(f);
              e.target.value = '';
            }}
          />
          {editing && photo && (
            <button
              type="button"
              className="btn-ghost pass-photo-clear"
              onClick={() => {
                savePhoto(null);
                setPhoto(null);
              }}
            >
              Remove photo
            </button>
          )}
        </div>

        <dl className="pass-grid">
          <Row label="Name" wide>
            {editing ? (
              <input className="pass-input" value={shown.name} onChange={(e) => field('name', e.target.value)} placeholder="As you want it printed" />
            ) : (
              <Value v={shown.name} />
            )}
          </Row>

          <Row label="Address" wide>
            {editing ? (
              <textarea className="pass-input pass-input--area" rows={2} value={shown.address} onChange={(e) => field('address', e.target.value)} />
            ) : (
              <Value v={shown.address} />
            )}
          </Row>

          <Row label="Mobile">
            {editing ? (
              <input className="pass-input" inputMode="tel" value={shown.mobile} onChange={(e) => field('mobile', e.target.value)} />
            ) : (
              <Value v={shown.mobile} fig />
            )}
          </Row>

          <Row label="Email">
            {editing ? (
              <input className="pass-input" inputMode="email" value={shown.email} onChange={(e) => field('email', e.target.value)} />
            ) : (
              <Value v={shown.email} />
            )}
          </Row>

          <Row label="Gender">
            {editing ? (
              <div className="pass-seg" role="group" aria-label="Gender">
                {GENDERS.map((g) => (
                  <button key={g.value} type="button" aria-pressed={shown.gender === g.value} onClick={() => field('gender', g.value)}>
                    {g.label}
                  </button>
                ))}
              </div>
            ) : (
              <Value v={GENDERS.find((g) => g.value === shown.gender)?.label ?? ''} />
            )}
          </Row>

          <Row label={editing ? 'Date of birth' : 'Age'}>
            {editing ? (
              <input className="pass-input" type="date" value={shown.dob} onChange={(e) => field('dob', e.target.value)} />
            ) : (
              <Value v={age === null ? '' : `${age} years`} fig />
            )}
          </Row>

          <Row label="Role" wide>
            {editing ? (
              <input
                className="pass-input"
                value={shown.role}
                onChange={(e) => field('role', e.target.value)}
                placeholder="Contractor, site engineer, owner-builder…"
              />
            ) : (
              <Value v={shown.role} />
            )}
          </Row>
        </dl>
      </div>

      {/* ── the machine-readable zone ───────────────────────────────────── */}
      <div className="pass-mrz" aria-hidden="true">
        <span>{mrz1}</span>
        <span>{mrz2}</span>
      </div>

      <div className="pass-foot">
        <p className="pass-note micro">
          A Build Objects membership card. Not a government document, and it carries no legal identity — everything on it stays in this browser.
        </p>
        {editing ? (
          <div className="pass-actions">
            <button type="button" className="btn btn-primary" onClick={save}>
              <IconCheck size={15} /> Save
            </button>
            <button type="button" className="btn btn-secondary" onClick={cancel}>
              <IconClose size={15} /> Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={start}>
            Edit passport
          </button>
        )}
      </div>

      {error && <p className="pass-error">{error}</p>}
    </div>
  );
}

function Row({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`pass-row${wide ? ' pass-row--wide' : ''}`}>
      <dt className="micro">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** An empty field prints a rule rather than nothing, so the card has the same shape either way. */
function Value({ v, fig }: { v: string; fig?: boolean }) {
  if (!v.trim()) return <span className="pass-blank">—</span>;
  return <span className={fig ? 'fig' : undefined}>{v}</span>;
}
