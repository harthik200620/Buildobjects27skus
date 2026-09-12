'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import { IconArrow, IconBack, IconChat, IconCheck, IconPhone, IconPin } from '@/components/icons';
import { inr } from '@/lib/media';
import { addPick } from '@/lib/picks';
import { maskedPhone } from '@/lib/tracking/cities';
import { deliveryCode, rateOrder, readOrder, SPEEDS, setSpeed } from '@/lib/tracking/orders';
import { events, simMinutes } from '@/lib/tracking/simulate';
import type { Order, Phase } from '@/lib/tracking/types';
import { useTracking } from './useTracking';

/* Leaflet touches window at import; the map only exists in the browser. The stand-in keeps the
   map's height so nothing beneath it moves when it arrives. */
const TrackingMap = dynamic(() => import('./TrackingMap'), { ssr: false, loading: () => <div className="tk-map" aria-hidden="true" /> });

const STEPS = ['Confirmed', 'Partner on the way', 'Picked up', 'Delivered'];
const STEP: Record<Phase, number> = { confirmed: 0, assigned: 1, at_yard: 1, on_the_way: 2, arriving: 2, delivered: 3 };

/** The router's manoeuvre vocabulary, in words a person would use. */
const MOVE: Record<string, string> = {
  depart: 'Set off',
  'depart-left': 'Set off',
  'depart-right': 'Set off',
  'turn-left': 'Turn left',
  'turn-right': 'Turn right',
  'turn-slight left': 'Bear left',
  'turn-slight right': 'Bear right',
  'turn-sharp left': 'Sharp left',
  'turn-sharp right': 'Sharp right',
  'turn-straight': 'Carry straight on',
  'end of road-left': 'Left at the end of the road',
  'end of road-right': 'Right at the end of the road',
  'end of road-straight': 'Straight on at the end of the road',
  'fork-left': 'Keep left at the fork',
  'fork-right': 'Keep right at the fork',
  'fork-straight': 'Carry straight on at the fork',
  'roundabout-left': 'Into the roundabout',
  'roundabout-right': 'Into the roundabout',
  'exit roundabout-left': 'Leave the roundabout',
  'exit roundabout-right': 'Leave the roundabout',
  'exit roundabout-slight left': 'Leave the roundabout',
  'exit roundabout-slight right': 'Leave the roundabout',
  'exit-left': 'Take the exit on the left',
  'exit-right': 'Take the exit on the right',
  'merge-left': 'Merge left',
  'merge-right': 'Merge right',
  'ramp-left': 'Take the ramp on the left',
  'ramp-right': 'Take the ramp on the right',
  'ramp-straight': 'Stay on the ramp',
  'new name-straight': 'Carry straight on',
  'continue-uturn': 'Turn back',
  arrive: 'Arrive',
  'arrive-left': 'Arrive, on the left',
  'arrive-right': 'Arrive, on the right',
};

const moveWords = (move: string) => MOVE[move] ?? MOVE[move.split('-')[0]] ?? 'Carry on';

/** "400 m" / "1.5 km" — rounded the way a driver reads a sign, never to a false precision. */
const distance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);

/** "Turn right onto HITEC City Road in 400 m" — or without the road where it has no name. */
function directionLine(next: { move: string; road: string; inM: number }): string {
  const where = next.road ? `${moveWords(next.move)} onto ${next.road}` : moveWords(next.move);
  return `${where} in ${distance(next.inM)}`;
}

/** 17:24, in the store's own time zone whatever the reader's device says. */
const clock = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

/**
 * The manoeuvre as an arrow, the way every satnav draws it.
 *
 * A SHAPE RATHER THAN A SENTENCE, because on a 375px screen the sentence wrapped onto four lines
 * and covered a third of the map — and because a driver reads an arrow at a glance and a clause
 * never. The words are still there for a screen reader, and the whole route is written out in
 * full in the panel below.
 */
function TurnArrow({ move }: { move: string }) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const straight = /straight|depart|new name|arrive/.test(move);
  const path = /uturn/.test(move)
    ? 'M9 21V10a4 4 0 0 1 8 0v4'
    : /roundabout/.test(move)
      ? 'M12 21v-6m0 0a3.5 3.5 0 1 1 3.5-3.5'
      : straight
        ? 'M12 21V5'
        : /slight/.test(move)
          ? 'M12 21v-8l4-4'
          : 'M12 21v-6h6';
  const tip = /uturn/.test(move) ? 'M13.5 12.5 17 16l3.5-3.5' : straight ? 'M7.5 9.5 12 5l4.5 4.5' : 'M15 12l4 3-4 3';
  const mirrored = /left/.test(move) && !straight && !/uturn/.test(move);
  return (
    <svg viewBox="0 0 24 26" width="22" height="24" aria-hidden="true" style={mirrored ? { transform: 'scaleX(-1)' } : undefined}>
      <path d={path} {...stroke} />
      <path d={tip} {...stroke} />
    </svg>
  );
}

function headline(phase: Phase, first: string, yard: string, drop: string): [string, string] {
  switch (phase) {
    case 'confirmed':
      return ['Order confirmed', `Finding a partner near the ${yard}.`];
    case 'assigned':
      return [`${first} is heading to the yard`, 'Your load is being set out at the gate.'];
    case 'at_yard':
      return ['Loading at the yard', `${first} is checking the load against your order.`];
    case 'on_the_way':
      return ['On the way to you', `Following the fastest route to ${drop}.`];
    case 'arriving':
      return ['Almost at your gate', 'Keep the unloading spot clear.'];
    case 'delivered':
      return ['Delivered', 'Check the load before the truck leaves.'];
  }
}

export default function OrderTracker({ id }: { id: string }) {
  const [order, setOrder] = React.useState<Order | null>();
  React.useEffect(() => setOrder(readOrder(id)), [id]);
  if (order === undefined) return <div className="tk tk--pending" aria-busy="true" />;
  if (!order) return <Missing id={id} />;
  return <Tracker order={order} onChange={setOrder} />;
}

function Tracker({ order, onChange }: { order: Order; onChange: (o: Order) => void }) {
  const { plan, snap, subscribe } = useTracking(order);
  const { city } = plan;
  const { partner } = city;
  const first = partner.name.split(' ')[0];
  const [title, phaseLine] = headline(snap.phase, first, city.yard.name, city.drop.name);
  const done = snap.phase === 'delivered';
  const driving = snap.phase === 'on_the_way' || snap.phase === 'arriving';
  const eta = done ? 'Delivered' : snap.phase === 'arriving' && snap.etaMin <= 1 ? 'Arriving now' : `${snap.etaMin} min`;
  const step = STEP[snap.phase];
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(order.clock.speed) + 1) % SPEEDS.length];
  // biome-ignore lint/correctness/useExhaustiveDependencies: `snap` is the clock tick — the feed is re-read whenever the page's own time moves, and simMinutes has no identity to key on
  const feed = React.useMemo(() => events(plan, order, simMinutes(order)), [plan, order, snap]);
  const steps = plan.legs[snap.legIndex].steps;
  const turnsLeft = snap.directions ? steps.length - snap.directions.stepIndex : 0;
  /* Keyed on distance along the leg rather than position in the list: two steps can share a
     move and a road ("turn left" twice on the same street), but never the same odometer. */
  let odometer = 0;
  const routeRows = steps.map((s, i) => {
    odometer += s.m;
    const passed = i < (snap.directions?.stepIndex ?? 0);
    const now = i === snap.directions?.stepIndex;
    return (
      <li key={`${odometer}-${s.move}`} className={passed ? 'is-passed' : now ? 'is-now' : undefined}>
        <span className="tk-route-move">{moveWords(s.move)}</span>
        {s.road && <span className="tk-route-road">{s.road}</span>}
        {s.m > 0 && <span className="tk-route-far fig">{distance(s.m)}</span>}
      </li>
    );
  });

  return (
    <div className={`tk tk--${snap.phase}`}>
      <div className="tk-map-wrap">
        <TrackingMap plan={plan} snap={snap} subscribe={subscribe} />
        <Link href="/account" className="tk-back" aria-label="Back to your account">
          <IconBack size={18} />
        </Link>
        {!done && (
          <span className="tk-live" aria-hidden="true">
            <i />
            Live
          </span>
        )}
        {/* The partner's own next move, from the router's turn-by-turn. It sits on the map
            because that is what it describes, and it is the answer to "where has he got to". */}
        {snap.directions?.next && (
          <p className="tk-turn" aria-live="polite">
            <span className="tk-turn-icon">
              <TurnArrow move={snap.directions.next.move} />
            </span>
            <span className="tk-turn-text">
              <span className="tk-turn-far fig">{distance(snap.directions.next.inM)}</span>
              <span className="tk-turn-road">{snap.directions.next.road || snap.directions.road || moveWords(snap.directions.next.move)}</span>
            </span>
            <span className="visually-hidden">{directionLine(snap.directions.next)}</span>
          </p>
        )}
        {!done && (
          <button
            type="button"
            className="tk-speed"
            onClick={() => {
              const o = setSpeed(order.id, nextSpeed);
              if (o) onChange(o);
            }}
            aria-label={`Demo running at ${order.clock.speed} times speed. Switch to ${nextSpeed} times`}
          >
            Demo · {order.clock.speed}×
          </button>
        )}
      </div>

      <section className="tk-head card" aria-live="polite">
        <p className="micro sec-eyebrow">
          Order {order.id} · {city.yard.name} → {city.drop.name}
        </p>
        <div className="tk-head-row">
          <div className="tk-head-text" key={snap.phase}>
            <h1 className="tk-title">{title}</h1>
            {/* While it drives, the line under the headline is the two numbers the ETA is made of;
                the phase sentence takes over when there is nothing moving to describe. */}
            <p className="tk-sub">
              {driving ? (
                <>
                  {first} is <b className="fig">{distance(snap.metresLeft)}</b> away, moving at <b className="fig tk-nowrap">{snap.kmh} km/h</b>
                </>
              ) : (
                phaseLine
              )}
            </p>
          </div>
          <div className={`tk-eta${done ? ' is-done' : ''}`}>
            {done ? (
              <span className="tk-eta-mark">
                <IconCheck size={22} />
              </span>
            ) : (
              <>
                <span className="tk-eta-text">
                  <span className="tk-eta-label">Arriving in</span>
                  <span className="tk-eta-fig fig" key={eta}>
                    {eta}
                  </span>
                </span>
                <span className="tk-ring" aria-hidden="true">
                  <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
                    <circle className="tk-ring-track" cx="32" cy="32" r="28" pathLength={1} />
                    <circle className="tk-ring-fill" cx="32" cy="32" r="28" pathLength={1} style={{ strokeDashoffset: 1 - snap.done }} />
                  </svg>
                  <b className="fig">{Math.round(snap.done * 100)}%</b>
                </span>
              </>
            )}
          </div>
        </div>
        <ol className="tk-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'is-done' : i === step ? 'is-now' : undefined}>
              <span className="tk-step-bar" />
              <span className="tk-step-label">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="tk-partner card" aria-label="Delivery partner">
        {snap.phase === 'confirmed' ? (
          <p className="tk-finding">
            <span className="tk-finding-ring" aria-hidden="true" />
            Assigning a partner near the yard
          </p>
        ) : (
          <>
            <div className="tk-partner-row">
              <span className={`tk-avatar${snap.kmh > 0 ? ' is-moving' : ''}`} aria-hidden="true">
                {partner.name
                  .split(' ')
                  .map((w) => w[0])
                  .join('')}
                <i />
              </span>
              <div className="tk-partner-who">
                <p className="tk-partner-name">{partner.name}</p>
                <p className="tk-partner-meta">
                  <span className="fig">{partner.rating.toFixed(1)}</span> ★ · <span className="fig">{partner.trips.toLocaleString('en-IN')}</span> trips ·{' '}
                  {partner.vehicle.model}
                </p>
              </div>
              <div className="tk-partner-acts">
                <a className="tk-act" href={`sms:+91${partner.phone}`} aria-label={`Message ${first}`}>
                  <IconChat size={18} />
                </a>
                <a className="tk-act tk-act--call" href={`tel:+91${partner.phone}`} aria-label={`Call ${first}`}>
                  <IconPhone size={18} />
                </a>
              </div>
            </div>
            <dl className="tk-partner-facts">
              <div>
                <dt className="visually-hidden">Truck</dt>
                <dd>
                  <span className="fig">{partner.vehicle.number}</span> <span className="tk-muted">· white mini truck</span>
                </dd>
              </div>
              <div>
                <dt className="visually-hidden">Phone</dt>
                <dd>
                  <span className="fig">{maskedPhone(partner.phone)}</span> <span className="tk-muted">· masked</span>
                </dd>
              </div>
            </dl>
          </>
        )}
      </section>

      {/* What has happened, newest first, off the same clock as everything else on the page. */}
      <section className="tk-feed card" aria-label="Live updates">
        <div className="tk-row">
          <h2 className="tk-h2">Live</h2>
          <span className="tk-fine tk-muted">{done ? 'the whole trip' : 'updates as he moves'}</span>
        </div>
        <ol className="tk-feed-list">
          {feed.map((e, i) => (
            <li key={e.at} className={i === 0 && !done ? 'is-now' : undefined}>
              <time className="fig" dateTime={new Date(e.at).toISOString()}>
                {clock.format(e.at)}
              </time>
              <i aria-hidden="true" />
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* The whole route, written out. A list of real road names is the only form of a route a
          person can actually check. */}
      {snap.directions && (
        <details className="tk-route card">
          <summary>
            <span>The route from here</span>
            <span className="tk-route-count fig">
              {turnsLeft} {turnsLeft === 1 ? 'turn' : 'turns'} · {distance(snap.metresLeft)}
            </span>
          </summary>
          <ol className="tk-route-list">{routeRows}</ol>
        </details>
      )}

      <section className="tk-lines card" aria-label="Your load">
        <h2 className="tk-h2">Your load</h2>
        <ul className="tk-line-list">
          {order.lines.map((l) => (
            <li key={l.sku}>
              <span>{l.name}</span>
              <span className="fig">
                {l.qty} {l.unit}
              </span>
            </li>
          ))}
        </ul>
        <dl className="tk-totals">
          {order.coins > 0 && (
            <div>
              <dt>BO Coins</dt>
              <dd className="fig">− {inr(order.coins)}</dd>
            </div>
          )}
          <div>
            <dt>Paid</dt>
            <dd className="fig">{inr(order.total)}</dd>
          </div>
        </dl>
        <p className="tk-addr">
          <IconPin size={14} /> {city.drop.address}
        </p>

        {/* The handover code. Shown from the moment the load is on the truck, because that is
            when it becomes useful, and given its own block because the customer has to read it
            out loud to somebody standing in front of them. */}
        {step >= 2 && (
          <p className={`tk-code${done ? ' is-done' : ''}`}>
            <span className="tk-code-label">{done ? 'Delivery code used' : 'Give the driver this code'}</span>
            <span className="tk-code-digits fig">{deliveryCode(order.id)}</span>
          </p>
        )}
      </section>

      {done && (
        <>
          <Rate order={order} first={first} onChange={onChange} />
          <Again order={order} />
        </>
      )}
    </div>
  );
}

/** Five stars for the partner. It is his rating, not the yard's, and the copy says so. */
function Rate({ order, first, onChange }: { order: Order; first: string; onChange: (o: Order) => void }) {
  const [hover, setHover] = React.useState(0);
  const shown = hover || order.rating || 0;
  return (
    <section className="tk-rate card" aria-label={`Rate ${first}`}>
      <h2 className="tk-h2">{order.rating ? `Thanks — sent to ${first}` : `How was ${first}?`}</h2>
      <p className="tk-fine tk-muted">Your rating goes to him, not to the yard.</p>
      <div className="tk-stars" role="group" aria-label="Stars" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`tk-star${n <= shown ? ' is-on' : ''}`}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            aria-pressed={order.rating === n}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => {
              const o = rateOrder(order.id, n);
              if (o) onChange(o);
            }}
          >
            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
              <path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7l-5.9 3.1 1.2-6.5L2.5 9.7l6.6-.9z" fill="currentColor" />
            </svg>
          </button>
        ))}
      </div>
    </section>
  );
}

function Again({ order }: { order: Order }) {
  const router = useRouter();
  return (
    <div className="tk-cta">
      <button
        type="button"
        className="btn btn-primary btn--lg btn--block"
        onClick={() => {
          for (const l of order.lines) addPick({ sku_code: l.sku, qty: l.qty });
          router.push('/cart');
        }}
      >
        Order this again <IconArrow size={15} />
      </button>
      <Link href="/search" className="btn btn-secondary btn--lg btn--block">
        Back to the catalogue
      </Link>
    </div>
  );
}

function Missing({ id }: { id: string }) {
  return (
    <div className="cart-state">
      <h1 className="cart-state-h">We can't find order {id} on this device</h1>
      <p className="cart-state-p">Orders are kept on the phone or laptop they were placed from. Place one from the cart and the truck appears here.</p>
      <div className="cart-state-cta">
        <Link href="/cart" className="btn btn-primary btn--lg">
          Go to the cart
        </Link>
      </div>
    </div>
  );
}
