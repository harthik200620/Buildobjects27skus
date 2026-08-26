/** The category shape the shell needs — a projection of `allCategories()` that is safe to hand to client components. */
export interface NavCategory {
  slug: string;
  name: string;
  nameTe: string | null;
  icon: string | null;
  department: string;
  status: 'live' | 'upcoming';
}
