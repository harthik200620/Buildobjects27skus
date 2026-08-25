/** "Add to Estimate" — the buyer's picks, kept on this device. Read by the calculator page. */
export interface Pick {
  sku_code: string;
  qty: number;
}
const KEY = 'bo_estimate_picks';

export function readPicks(): Pick[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((p) => p && typeof p.sku_code === 'string' && p.qty > 0) : [];
  } catch {
    return [];
  }
}
export function writePicks(picks: Pick[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(picks));
    window.dispatchEvent(new Event('bo-picks'));
  } catch {}
}
export function addPick(p: Pick) {
  const picks = readPicks();
  const hit = picks.find((x) => x.sku_code === p.sku_code);
  if (hit) hit.qty = Math.min(999, hit.qty + p.qty);
  else picks.push({ ...p });
  writePicks(picks);
}
export function setPickQty(sku_code: string, qty: number) {
  const picks = readPicks()
    .map((x) => (x.sku_code === sku_code ? { ...x, qty } : x))
    .filter((x) => x.qty > 0);
  writePicks(picks);
}
export function removePick(sku_code: string) {
  writePicks(readPicks().filter((x) => x.sku_code !== sku_code));
}
export function clearPicks() {
  writePicks([]);
}
export type PickItem = Pick;
