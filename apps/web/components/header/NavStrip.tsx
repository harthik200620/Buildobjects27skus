import CategoryMenu from './CategoryMenu';
import NavLinks from './NavLinks';
import type { NavCategory } from './types';

/**
 * The 40 px strip under the header on --color-header-2: "≡ All" opens the whole catalogue tree,
 * then the departments that stock something (each dropping its categories), and on the right the
 * two tools. Not sticky — it scrolls away with the page; on a phone it scrolls sideways.
 */
export default function NavStrip({ categories, arHref }: { categories: NavCategory[]; arHref?: string }) {
  return (
    <nav className="nav" aria-label="Shop by category">
      <div className="nav-in shell">
        <CategoryMenu categories={categories} variant="all" />
        <NavLinks categories={categories} arHref={arHref} />
      </div>
    </nav>
  );
}
