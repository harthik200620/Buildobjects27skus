/** The category shape the shell needs — a projection of `allCategories()` that is safe to hand to client components. */
export interface NavCategory {
  slug: string;
  name: string;
  nameTe: string | null;
  icon: string | null;
  department: string;
  status: 'live' | 'upcoming';
}

/**
 * "View in your room" needs a product to open on. Every SKU has a room view, so the nav and
 * footer point at the cement bag the demo scripts also use; the AR page 404s honestly if it is
 * not ingested. Replace with a catalogue-driven pick once the home loader exposes one.
 */
export const AR_DEMO_HREF = '/ar/cem-ult-ppc50';
