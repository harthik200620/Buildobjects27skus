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
