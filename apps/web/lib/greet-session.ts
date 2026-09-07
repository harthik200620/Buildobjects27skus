/**
 * "Somebody just signed in." One flag, armed by the front door and spent by the greeting.
 *
 * WHY sessionStorage AND NOT THE URL. The greeting belongs to the act of signing in, not to a
 * page: `?welcome=1` would survive a copied link, a bookmark and a refresh, so a shopper would be
 * greeted for arriving at a page they had open yesterday. sessionStorage is scoped to the tab and
 * to this visit, which is exactly the life of the thing it describes.
 *
 * WHY IT IS SPENT, NOT READ. `consume` clears before it returns, so the greeting cannot play twice
 * — not on a refresh, not when React mounts an effect twice in development, and not when a second
 * component asks. The flag is a ticket.
 */
const KEY = 'bo_greet';

/** Called the moment the session cookie is set, before the router leaves /welcome. */
export function armGreeting(regionId: string): void {
  try {
    sessionStorage.setItem(KEY, regionId);
  } catch {
    /* A browser with storage off simply does not get greeted. */
  }
}

/** The region to greet, once. Returns null on every call after the first. */
export function consumeGreeting(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) sessionStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}
