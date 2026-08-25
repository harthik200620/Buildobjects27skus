/**
 * City cost index — Hyderabad = 1.00. Applied to every SEED rate (local materials, labour,
 * finishes). Store SKU prices are real quoted prices and are never indexed.
 * Basis: relative labour + local-material cost bands typical of AP/TS district towns vs
 * Hyderabad, Aug 2026 thumb values. needs_verification: true until replaced by real quotes.
 */
import type { StateCode } from '../../src/types';

export interface CityRate {
  key: string;
  name: string;
  state: StateCode;
  index: number;
  needs_verification: boolean;
}

export const CITIES: CityRate[] = [
  { key: 'hyderabad', name: 'Hyderabad', state: 'TS', index: 1.0, needs_verification: false },
  { key: 'warangal', name: 'Warangal', state: 'TS', index: 0.94, needs_verification: true },
  { key: 'karimnagar', name: 'Karimnagar', state: 'TS', index: 0.93, needs_verification: true },
  { key: 'nizamabad', name: 'Nizamabad', state: 'TS', index: 0.92, needs_verification: true },
  { key: 'khammam', name: 'Khammam', state: 'TS', index: 0.93, needs_verification: true },
  { key: 'vijayawada', name: 'Vijayawada', state: 'AP', index: 0.98, needs_verification: true },
  { key: 'visakhapatnam', name: 'Visakhapatnam', state: 'AP', index: 1.02, needs_verification: true },
  { key: 'guntur', name: 'Guntur', state: 'AP', index: 0.96, needs_verification: true },
  { key: 'nellore', name: 'Nellore', state: 'AP', index: 0.95, needs_verification: true },
  { key: 'tirupati', name: 'Tirupati', state: 'AP', index: 0.97, needs_verification: true },
  { key: 'kurnool', name: 'Kurnool', state: 'AP', index: 0.92, needs_verification: true },
  { key: 'rajahmundry', name: 'Rajahmundry', state: 'AP', index: 0.95, needs_verification: true },
  { key: 'kakinada', name: 'Kakinada', state: 'AP', index: 0.96, needs_verification: true },
  { key: 'anantapur', name: 'Anantapur', state: 'AP', index: 0.92, needs_verification: true },
];

export const STATE_NAME: Record<StateCode, string> = { AP: 'Andhra Pradesh', TS: 'Telangana' };

export function cityByKey(key: string): CityRate {
  return CITIES.find((c) => c.key === key) ?? CITIES[0];
}
