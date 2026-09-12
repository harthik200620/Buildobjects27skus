import { plan, simMinutes, snapshot } from './simulate';
import type { Order, OrderLine } from './types';

/**
 * Orders live on the device, beside the cart and the coins, for the reason lib/shopper.ts gives:
 * the deployment has no database, and a demo order kept server-side would work on a laptop and
 * vanish in production. `readOrder` is the one seam — a backend replaces it with a fetch and the
 * tracking page does not change.
 */
const KEY = 'bo_orders';
const KEEP = 10;
/** The demo plays a seventeen-minute delivery in under ninety seconds. */
export const DEMO_SPEED = 12;
export const SPEEDS = [1, 12, 40];

/**
 * The four digits the customer reads out when the truck arrives.
 *
 * Derived from the order id rather than stored, so it is the same on every device that opens the
 * order and there is nothing extra to keep in step. In a real system the driver's app holds the
 * matching code and the yard issues both — here it exists because a delivery in India without a
 * handover code does not look like a delivery, and because it gives the arrival a last beat.
 */
export const deliveryCode = (orderId: string): string => {
  let h = 7;
  for (const ch of orderId) h = (h * 31 + ch.charCodeAt(0)) % 10000;
  return String(h).padStart(4, '0');
};

function read(): Order[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(orders: Order[]) {
  localStorage.setItem(KEY, JSON.stringify(orders.slice(0, KEEP)));
  window.dispatchEvent(new Event('bo-orders'));
}

export function placeOrder(input: { regionId: string; lines: OrderLine[]; total: number; coins: number }): Order {
  const placedAt = Date.now();
  const order: Order = {
    id: `BO-${placedAt.toString(36).slice(-6).toUpperCase()}`,
    placedAt,
    clock: { simMs: 0, wallMs: placedAt, speed: DEMO_SPEED },
    ...input,
  };
  write([order, ...read()]);
  return order;
}

export const readOrder = (id: string): Order | null => read().find((o) => o.id === id) ?? null;

/** The newest order still on the road — for the strip that follows the shopper around the store. */
export const activeOrder = (): Order | null => read().find((o) => snapshot(plan(o), simMinutes(o)).phase !== 'delivered') ?? null;

/** Change the demo speed without moving the truck: the clock is rebased to this instant. */
export function setSpeed(id: string, speed: number): Order | null {
  const orders = read();
  const o = orders.find((x) => x.id === id);
  if (!o) return null;
  const wallMs = Date.now();
  o.clock = { simMs: simMinutes(o, wallMs) * 60_000, wallMs, speed };
  write(orders);
  return { ...o };
}

/** The stars a customer gives the partner once the load is at the door. Kept with the order. */
export function rateOrder(id: string, stars: number): Order | null {
  const orders = read();
  const o = orders.find((x) => x.id === id);
  if (!o) return null;
  o.rating = Math.max(1, Math.min(5, Math.round(stars)));
  write(orders);
  return { ...o };
}
