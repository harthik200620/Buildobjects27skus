import type { Partner, Place } from './types';

/**
 * Demo geography, one set per serviceable region (`lib/data.ts`).
 *
 * The yard and the drop are picked to be a Blinkit-shaped trip: a few kilometres apart on real
 * roads, inside the twenty minutes the cart promises even at peak. The partner starts a short
 * ride from the yard, as a dispatcher would choose. `scripts/routes-fetch.mts` turns these three
 * points into road geometry (routes.json); change a point here and re-run it.
 *
 * Traffic is a multiplier on free-flow driving time by hour of day — Hyderabad's Kondapur–
 * Madhapur stretch genuinely runs at half speed in the evening, Tirupati's Tilak Road does not.
 */
export interface City {
  id: string;
  name: string;
  yard: Place;
  drop: Place;
  partnerAt: { lat: number; lng: number };
  partner: Partner;
  traffic: { peak: number; day: number; night: number };
}

export const CITIES: Record<string, City> = {
  hyd: {
    id: 'hyd',
    name: 'Hyderabad',
    yard: { name: 'Kondapur yard', address: 'Botanical Garden Road, Kondapur, Hyderabad 500084', lat: 17.463392, lng: 78.361844 },
    drop: { name: 'Madhapur', address: 'Road No. 12, Ayyappa Society, Madhapur, Hyderabad 500081', lat: 17.450258, lng: 78.38025 },
    partnerAt: { lat: 17.469822, lng: 78.365119 },
    partner: { name: 'Ravi Kumar', phone: '9848041235', rating: 4.9, trips: 2340, vehicle: { number: 'TS 09 UB 4521', model: 'Tata Ace Gold' } },
    traffic: { peak: 1.6, day: 1.3, night: 1 },
  },
  tpt: {
    id: 'tpt',
    name: 'Tirupati',
    yard: { name: 'Renigunta Road yard', address: 'Renigunta Road, near Karakambadi crossing, Tirupati 517507', lat: 13.638555, lng: 79.444845 },
    drop: { name: 'Tilak Road', address: 'Tilak Road, Tirupati 517501', lat: 13.631193, lng: 79.417997 },
    partnerAt: { lat: 13.633666, lng: 79.440922 },
    partner: { name: 'Srinivasulu Naidu', phone: '9440217788', rating: 4.8, trips: 1180, vehicle: { number: 'AP 03 TC 2210', model: 'Mahindra Jeeto' } },
    traffic: { peak: 1.3, day: 1.15, night: 1 },
  },
  vij: {
    id: 'vij',
    name: 'Vijayawada',
    yard: { name: 'Auto Nagar yard', address: 'Auto Nagar, Vijayawada 520007', lat: 16.494934, lng: 80.679164 },
    drop: { name: 'Benz Circle', address: 'MG Road, near Benz Circle, Vijayawada 520010', lat: 16.497436, lng: 80.656181 },
    partnerAt: { lat: 16.491938, lng: 80.66905 },
    partner: { name: 'Venkata Rao', phone: '9989034412', rating: 4.9, trips: 1960, vehicle: { number: 'AP 16 TE 7788', model: 'Tata Ace Gold' } },
    traffic: { peak: 1.4, day: 1.2, night: 1 },
  },
  vizag: {
    id: 'vizag',
    name: 'Visakhapatnam',
    yard: { name: 'Marripalem yard', address: 'NH16 service road, Marripalem, Visakhapatnam 530018', lat: 17.743885, lng: 83.256047 },
    drop: { name: 'Dwaraka Nagar', address: 'Dwaraka Nagar, Visakhapatnam 530016', lat: 17.729016, lng: 83.303834 },
    partnerAt: { lat: 17.743037, lng: 83.265995 },
    partner: { name: 'Suresh Babu', phone: '9491120066', rating: 4.8, trips: 1420, vehicle: { number: 'AP 31 TF 3345', model: 'Ashok Leyland Dost' } },
    traffic: { peak: 1.35, day: 1.2, night: 1 },
  },
};

export const cityFor = (regionId: string): City => CITIES[regionId] ?? CITIES.hyd;

/** "+91 98480 •••35" — enough to recognise a number, not enough to copy it. */
export const maskedPhone = (digits: string) => `+91 ${digits.slice(0, 5)} •••${digits.slice(-2)}`;
