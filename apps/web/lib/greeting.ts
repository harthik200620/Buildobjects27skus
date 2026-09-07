/**
 * The welcome a city gets when somebody signs in from it.
 *
 * ONE CITY, AND THE SHAPE FOR THE REST. Tirupati is the only one with a photograph, so it is the
 * only one that greets. Every other region signs in straight into the store rather than being
 * shown a stand-in — a greeting that names your city over a picture of somewhere else is worse
 * than no greeting, and a stock backdrop under "నమస్కారం విజయవాడ" would be exactly that. Adding
 * Vijayawada is a photograph and four lines here.
 *
 * THE TELUGU IS THE GREETING, not a translation of it. `hello` is what the screen says; the Latin
 * line beneath is a caption for a reader who does not have the script, which is why it is small
 * and set in the store's own face rather than being a second, competing headline.
 */
export interface CityGreeting {
  /** The region id in lib/data.ts — this is what a session carries. */
  regionId: string;
  /** "నమస్కారం" — the word itself, and the largest thing on the screen. */
  hello: string;
  /** The city, in Telugu, under it. */
  cityTe: string;
  /** The city and state in Latin, as a caption. */
  city: string;
  state: string;
  /** The photograph, and what it is of — the alt text a screen reader gets. */
  wide: string;
  tall: string;
  alt: string;
}

export const GREETINGS: readonly CityGreeting[] = [
  {
    regionId: 'tpt',
    hello: 'నమస్కారం',
    cityTe: 'తిరుపతి',
    city: 'Tirupati',
    state: 'Andhra Pradesh',
    wide: '/greet/tirupati-wide.webp',
    tall: '/greet/tirupati-tall.webp',
    alt: 'The gopuram of the Sri Venkateswara temple at Tirumala, lit at dawn, with mist across the Seshachalam hills behind it',
  },
];

export const greetingFor = (regionId: string | null | undefined): CityGreeting | null => (regionId && GREETINGS.find((g) => g.regionId === regionId)) || null;
