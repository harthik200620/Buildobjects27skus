/**
 * The tracking contract.
 *
 * Everything the tracking page draws comes through these shapes and nothing else. Today
 * `simulate.ts` fills them from a demo timeline; a dispatch backend with a partner app fills the
 * same shapes from GPS. The page cannot tell the difference, which is the point.
 */

export type Phase = 'confirmed' | 'assigned' | 'at_yard' | 'on_the_way' | 'arriving' | 'delivered';

export interface Place {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface Partner {
  name: string;
  /** Digits only. Shown masked; dialled in full. */
  phone: string;
  rating: number;
  trips: number;
  vehicle: { number: string; model: string };
}

export interface OrderLine {
  sku: string;
  name: string;
  qty: number;
  unit: string;
}

export interface Order {
  id: string;
  regionId: string;
  placedAt: number;
  lines: OrderLine[];
  total: number;
  coins: number;
  /**
   * The demo clock. Simulated time = simMs + (now − wallMs) × speed, rebased whenever the speed
   * changes so the truck never jumps. A real order has speed 1 and never rebases.
   */
  clock: { simMs: number; wallMs: number; speed: number };
}

/** One manoeuvre from the router: how far it runs, what the driver does, the road it joins. */
export interface Step {
  m: number;
  move: string;
  road: string;
}

/** One road leg as routed: GeoJSON order, [lng, lat]. `min` is free-flow driving time. */
export interface Leg {
  km: number;
  min: number;
  coords: [number, number][];
  steps: Step[];
}

/** What the driver is doing now and what they do next — the tracker's turn-by-turn line. */
export interface Directions {
  /** The road under the truck, empty where the router had no name for it. */
  road: string;
  /** Null on the last step, where the next thing that happens is arriving. */
  next: { move: string; road: string; inM: number } | null;
}

export interface Snapshot {
  phase: Phase;
  legIndex: 0 | 1;
  /** Where the truck is, or null until a partner is assigned. */
  at: { lat: number; lng: number } | null;
  /** Degrees clockwise from north. */
  heading: number;
  /** Whole minutes to the door; 0 once it is there. */
  etaMin: number;
  /** 0–1 of the whole job, for the progress rail. */
  done: number;
  /** The road still ahead on the current leg. */
  remaining: [number, number][];
  /** Where the driver is in the turn-by-turn; null before a partner is on the road. */
  directions: Directions | null;
}
