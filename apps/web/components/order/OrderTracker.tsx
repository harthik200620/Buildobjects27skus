'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import { IconArrow, IconCheck, IconPin } from '@/components/icons';
import { inr } from '@/lib/media';
import { addPick } from '@/lib/picks';
import { maskedPhone } from '@/lib/tracking/cities';
import { readOrder, SPEEDS, setSpeed } from '@/lib/tracking/orders';
import type { Order, Phase } from '@/lib/tracking/types';
import { useTracking } from './useTracking';

/* Leaflet touches window at import; the map only exists in the browser. The stand-in keeps the
   map's height so nothing beneath it moves when it arrives. */
const TrackingMap = dynamic(() => import('./TrackingMap'), { ssr: false, loading: () => <div className="tk-map" aria-hidden="true" /> });

const STEPS = ['Confirmed', 'Partner on the way', 'Picked up', 'Delivered'];
const STEP: Record<Phase, number> = { confirmed: 0, assigned: 1, at_yard: 1, on_the_way: 2, arriving: 2, delivered: 3 };

/** The router's manoeuvre vocabulary, in words a person would use. */
const MOVE: Record<string, string> = {
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
  'roundabout-left': 'Into the roundabout',
  'roundabout-right': 'Into the roundabout',
  'exit roundabout-left': 'Leave the roundabout',
  'exit roundabout-right': 'Leave the roundabout',
  'exit roundabout-slight left': 'Leave the roundabout',
  'exit roundabout-slight right': 'Leave the roundabout',
  'merge-left': 'Merge left',
  'merge-right': 'Merge right',
  'ramp-left': 'Take the ramp on the left',
  'ramp-right': 'Take the ramp on the right',
  'new name-straight': 'Carry straight on',
  'continue-uturn': 'Turn back',
  arrive: 'Arrive',
};

/** "Turn right onto HITEC City Road in 400 m" — or without the road where it has no name. */
function directionLine(next: { move: string; road: string; inM: number }): string {
  const move = MOVE[next.move] ?? MOVE[next.move.split('-')[0]] ?? 'Carry on';
  const where = next.road ? `${move} onto ${next.road}` : move;
  const far = next.inM >= 1000 ? `${(next.inM / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(next.inM / 10) * 10)} m`;
  return `${where} in ${far}`;
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
  const [title, sub] = headline(snap.phase, first, city.yard.name, city.drop.name);
  const done = snap.phase === 'delivered';
  const eta = done ? 'Delivered' : snap.phase === 'arriving' && snap.etaMin <= 1 ? 'Arriving now' : `${snap.etaMin} min`;
  const step = STEP[snap.phase];
  const next = SPEEDS[(SPEEDS.indexOf(order.clock.speed) + 1) % SPEEDS.length];

  return (
    <div className={`tk tk--${snap.phase}`}>
      <section className="tk-head card" aria-live="polite">
        <p className="micro sec-eyebrow">
          Order {order.id} · {city.yard.name} → {city.drop.name}
        </p>
        <div className="tk-head-row">
          <div className="tk-head-text" key={snap.phase}>
            <h1 className="tk-title">{title}</h1>
            <p className="tk-sub">{sub}</p>
          </div>
          <div className={`tk-eta${done ? ' is-done' : ''}`}>
            {done ? (
              <span className="tk-eta-mark">
                <IconCheck size={22} />
              </span>
            ) : (
              <>
                <span className="tk-eta-label">Arriving in</span>
                <span className="tk-eta-fig fig" key={eta}>
                  {eta}
                </span>
              </>
            )}
          </div>
        </div>
        <ol className="tk-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'is-done' : i === step ? 'is-now' : undefined}>
              <span className="tk-step-dot">{i < step ? <IconCheck size={10} /> : null}</span>
              <span className="tk-step-label">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="tk-map-wrap">
        {/* The partner's own next move, from the router's turn-by-turn. It sits on the map
            because that is what it describes, and it is the answer to "where has he got to". */}
        {snap.directions?.next && (
          <p className="tk-turn" aria-live="polite">
            <span className="tk-turn-move">{directionLine(snap.directions.next)}</span>
            {snap.directions.road && <span className="tk-turn-now">on {snap.directions.road}</span>}
          </p>
        )}
        <TrackingMap plan={plan} snap={snap} subscribe={subscribe} />
        {!done && (
          <button
            type="button"
            className="tk-speed"
            onClick={() => {
              const o = setSpeed(order.id, next);
              if (o) onChange(o);
            }}
            aria-label={`Demo running at ${order.clock.speed} times speed. Switch to ${next} times`}
          >
            Demo · {order.clock.speed}×
          </button>
        )}
      </div>

      <section className="tk-partner card" aria-label="Delivery partner">
        {snap.phase === 'confirmed' ? (
          <p className="tk-finding">
            <span className="tk-finding-ring" aria-hidden="true" />
            Assigning a partner near the yard
          </p>
        ) : (
          <>
            <div className="tk-partner-row">
              <span className="tk-avatar" aria-hidden="true">
                {partner.name
                  .split(' ')
                  .map((w) => w[0])
                  .join('')}
              </span>
              <div className="tk-partner-who">
                <p className="tk-partner-name">{partner.name}</p>
                <p className="tk-partner-meta">
                  <span className="fig">{partner.rating.toFixed(1)}</span> ★ · <span className="fig">{partner.trips.toLocaleString('en-IN')}</span> trips
                </p>
              </div>
              <a className="btn btn-secondary" href={`tel:+91${partner.phone}`}>
                Call
              </a>
            </div>
            <dl className="tk-partner-facts">
              <div>
                <dt>Truck</dt>
                <dd>
                  {partner.vehicle.model} · <span className="fig">{partner.vehicle.number}</span>
                </dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>
                  <span className="fig">{maskedPhone(partner.phone)}</span> <span className="tk-muted">masked for the partner's privacy</span>
                </dd>
              </div>
            </dl>
          </>
        )}
      </section>

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
        {done && <Again order={order} />}
      </section>
    </div>
  );
}

function Again({ order }: { order: Order }) {
  const router = useRouter();
  return (
    <div className="tk-cta">
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          for (const l of order.lines) addPick({ sku_code: l.sku, qty: l.qty });
          router.push('/cart');
        }}
      >
        Order this again <IconArrow size={15} />
      </button>
      <Link href="/search" className="btn btn-secondary">
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
