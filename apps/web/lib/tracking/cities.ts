import type { Partner, Place } from './types';

/**
 * Demo geography, one set per serviceable region (`lib/data.ts`).
 *
 * EVERY POINT HERE SITS ON A NAMED ARTERIAL ROAD, and that is not decoration. The first version
 * used coordinates picked off a map by eye; a router snaps an off-road point to whatever way is
 * nearest, and in these cities the nearest way is usually an unnamed colony lane. The result was
 * a truck routed confidently down alleys it could not enter. These twelve points were taken from
 * OSM's own `highway=primary|secondary|tertiary` ways via Overpass, so the router starts and ends
 * on roads a loaded vehicle can actually use — and `scripts/routes-fetch.mts` fails the run if a
 * committed route ever drifts onto a track, a driveway or a footway.
 *
 * THE TRIPS ARE SHORT ON PURPOSE. A yard and a door about two kilometres apart is what a twenty
 * minute promise costs when the vehicle is a loaded truck routed at truck speeds — around
 * 19 km/h through these cities — rather than a scooter carrying a milk packet. Every city here
 * comes in under twenty minutes at the evening peak, and simulate.test.ts holds them to it.
 */
export interface City {
  id: string;
  name: string;
  yard: Place;
  drop: Place;
  partnerAt: { lat: number; lng: number };
  partner: Partner;
  /**
   * How much slower than the router's own estimate the roads run at this hour.
   *
   * SMALL NUMBERS ON PURPOSE. These were 1.6 at peak when routing came from OSRM's car profile,
   * which quotes free-flow speeds. Valhalla's truck costing already prices in urban crawling — it
   * returns about 19 km/h across Hyderabad — so the old multiplier charged for the same traffic
   * twice and pushed a 3 km delivery past forty minutes. What is left is the difference between a
   * quiet road and a jammed one, which is all this was ever meant to model.
   */
  traffic: { peak: number; day: number; night: number };
}

export const CITIES: Record<string, City> = {
  hyd: {
    id: 'hyd',
    name: 'Hyderabad',
    yard: { name: 'Kondapur yard', address: 'Gachibowli–Miyapur Highway, Kondapur, Hyderabad 500084', lat: 17.470697, lng: 78.365295 },
    drop: { name: 'Madhapur', address: 'HITEC City–Kondapur Main Road, Madhapur, Hyderabad 500081', lat: 17.457, lng: 78.3763 },
    partnerAt: { lat: 17.4765, lng: 78.365 },
    partner: { name: 'Ravi Kumar', phone: '9848041235', rating: 4.9, trips: 2340, vehicle: { number: 'TS 09 UB 4521', model: 'Tata Ace Gold' } },
    traffic: { peak: 1.25, day: 1.1, night: 0.95 },
  },
  tpt: {
    id: 'tpt',
    name: 'Tirupati',
    yard: { name: 'K.T. Road yard', address: 'K.T. Road, Tirupati 517501', lat: 13.63858, lng: 79.418501 },
    drop: { name: 'Prakasam Road', address: 'Prakasam Road, Tirupati 517501', lat: 13.630841, lng: 79.413438 },
    partnerAt: { lat: 13.642082, lng: 79.428991 },
    partner: { name: 'Srinivasulu Naidu', phone: '9440217788', rating: 4.8, trips: 1180, vehicle: { number: 'AP 03 TC 2210', model: 'Mahindra Jeeto' } },
    traffic: { peak: 1.12, day: 1.05, night: 0.95 },
  },
  vij: {
    id: 'vij',
    name: 'Vijayawada',
    yard: { name: 'Auto Nagar yard', address: 'Old NH16, Auto Nagar, Vijayawada 520007', lat: 16.518553, lng: 80.674241 },
    drop: { name: 'Mahanadu Road', address: 'Mahanadu Road, Vijayawada 520007', lat: 16.5075, lng: 80.6792 },
    partnerAt: { lat: 16.51664, lng: 80.672258 },
    partner: { name: 'Venkata Rao', phone: '9989034412', rating: 4.9, trips: 1960, vehicle: { number: 'AP 16 TE 7788', model: 'Tata Ace Gold' } },
    traffic: { peak: 1.18, day: 1.08, night: 0.95 },
  },
  vizag: {
    id: 'vizag',
    name: 'Visakhapatnam',
    yard: { name: 'Marripalem yard', address: 'Old NH16, Marripalem, Visakhapatnam 530018', lat: 17.738973, lng: 83.294248 },
    drop: { name: 'Dwaraka Nagar', address: 'Gurudwara Junction–Dwaraka Nagar Road, Visakhapatnam 530016', lat: 17.730393, lng: 83.306764 },
    partnerAt: { lat: 17.732708, lng: 83.28497 },
    partner: { name: 'Suresh Babu', phone: '9491120066', rating: 4.8, trips: 1420, vehicle: { number: 'AP 31 TF 3345', model: 'Ashok Leyland Dost' } },
    traffic: { peak: 1.15, day: 1.06, night: 0.95 },
  },
};

export const cityFor = (regionId: string): City => CITIES[regionId] ?? CITIES.hyd;

/** "+91 98480 •••35" — enough to recognise a number, not enough to copy it. */
export const maskedPhone = (digits: string) => `+91 ${digits.slice(0, 5)} •••${digits.slice(-2)}`;
