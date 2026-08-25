'use client';

const COINS_KEY = 'bo_coins_balance';
const SPUN_KEY = 'bo_coins_spun';
const PROFILE_KEY = 'bo_profile_name';
const HISTORY_KEY = 'bo_coins_history';

export interface CoinActivity {
  id: string;
  type: 'spin_reward' | 'cart_redemption' | 'bonus';
  amount: number;
  description: string;
  timestamp: number;
}

/** Get current BO Coins balance */
export function getBoCoins(): number {
  if (typeof window === 'undefined') return 0;
  const val = localStorage.getItem(COINS_KEY);
  if (val === null) return 0;
  const num = parseInt(val, 10);
  return Number.isNaN(num) ? 0 : Math.max(0, num);
}

/** Get BO Coin Activity History */
export function getBoCoinHistory(): CoinActivity[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function logActivity(activity: Omit<CoinActivity, 'id' | 'timestamp'>) {
  if (typeof window === 'undefined') return;
  const history = getBoCoinHistory();
  const entry: CoinActivity = {
    id: `act_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
    ...activity,
  };
  const updated = [entry, ...history].slice(0, 10);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

/** Credit BO Coins to user account */
export function addBoCoins(amount: number, reason = 'BO Kinetic Wheel Reward'): number {
  if (typeof window === 'undefined') return 0;
  const current = getBoCoins();
  const next = current + Math.max(0, amount);
  localStorage.setItem(COINS_KEY, String(next));
  logActivity({ type: 'spin_reward', amount, description: reason });
  window.dispatchEvent(new CustomEvent('bo-coins-changed', { detail: { balance: next, change: amount } }));
  return next;
}

/** Redeem BO Coins (deduct from balance) */
export function redeemBoCoins(amount: number, reason = 'BO Cart Material Discount'): number {
  if (typeof window === 'undefined') return 0;
  const current = getBoCoins();
  const spend = Math.min(current, Math.max(0, amount));
  const next = current - spend;
  localStorage.setItem(COINS_KEY, String(next));
  logActivity({ type: 'cart_redemption', amount: -spend, description: reason });
  window.dispatchEvent(new CustomEvent('bo-coins-changed', { detail: { balance: next, change: -spend } }));
  return spend;
}

/** Check if user has already spun the welcome wheel */
export function hasSpunWheel(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SPUN_KEY) === 'true';
}

/** Mark the spin wheel as completed with the amount won */
export function markWheelSpun(won: number): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SPUN_KEY, 'true');
  addBoCoins(won, `Kinetic Turbine Sector Win (+${won} Coins)`);
}

/** Reset spin wheel status (for testing or re-spins) */
export function resetWheelStatus(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SPUN_KEY);
}

/** Get Profile Name */
export function getProfileName(fallbackPhone?: string): string {
  if (typeof window === 'undefined') return 'Builder / Contractor';
  const name = localStorage.getItem(PROFILE_KEY);
  if (name?.trim()) return name.trim();
  if (fallbackPhone) return `Builder (${fallbackPhone.slice(-4)})`;
  return 'Builder / Contractor';
}

/** Set Profile Name */
export function setProfileName(name: string): void {
  if (typeof window === 'undefined') return;
  const clean = name.trim();
  if (clean) {
    localStorage.setItem(PROFILE_KEY, clean);
    window.dispatchEvent(new CustomEvent('bo-profile-changed', { detail: { name: clean } }));
  }
}
