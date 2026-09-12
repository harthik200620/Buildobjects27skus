'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import { IconTruck } from '@/components/icons';
import { activeOrder } from '@/lib/tracking/orders';
import { plan, simMinutes, snapshot } from '@/lib/tracking/simulate';
import type { Order } from '@/lib/tracking/types';

/** "Arriving in 8 min", following the shopper around the store while a truck is on the road. */
export default function ActiveOrderPill() {
  const path = usePathname();
  const [order, setOrder] = React.useState<Order | null>(null);
  const [eta, setEta] = React.useState(0);

  React.useEffect(() => {
    const sync = () => setOrder(activeOrder());
    sync();
    window.addEventListener('bo-orders', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('bo-orders', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  React.useEffect(() => {
    if (!order) return;
    const p = plan(order);
    const tick = () => {
      const s = snapshot(p, simMinutes(order));
      if (s.phase === 'delivered') setOrder(null);
      else setEta(s.etaMin);
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [order]);

  if (!order || path.startsWith('/order/')) return null;
  return (
    <Link href={`/order/${order.id}`} className="tk-pill">
      <IconTruck size={16} />
      <span>
        Arriving in <b className="fig">{eta} min</b>
      </span>
      <span className="tk-pill-go">Track</span>
    </Link>
  );
}
