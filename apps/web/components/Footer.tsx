import Link from 'next/link';
import { AR_DEMO_HREF, type NavCategory } from './header/types';
import { IconChevronUp } from './icons';
import Wordmark from './Wordmark';

/** "Back to top" on header-2, three columns (Shop / Tools / About) on the header colour, one bottom line. */
export default function Footer({ categories }: { categories: NavCategory[] }) {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <a href="#top" className="footer-top">
        <IconChevronUp size={16} /> Back to top
      </a>
      <div className="shell">
        <div className="footer-cols">
          <div className="footer-col">
            <h3>Shop</h3>
            {/* The nine that stock something. The other twenty-eight are in the "All" menu and
                the rail beside the results; a footer column of shelves with nothing on them
                is a longer footer and a worse one. */}
            <ul>
              {categories
                .filter((c) => c.status === 'live')
                .map((c) => (
                  <li key={c.slug}>
                    <Link href={`/c/${c.slug}`}>{c.name}</Link>
                  </li>
                ))}
              <li>
                <Link href="/search">All products</Link>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h3>Tools</h3>
            <ul>
              <li>
                <Link href="/estimate">BO Estimator</Link>
              </li>
              <li>
                <Link href={AR_DEMO_HREF}>View in your room</Link>
              </li>
              <li>
                <Link href="/search">Search the catalogue</Link>
              </li>
              <li>
                <Link href="/estimate">My estimates</Link>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h3>About</h3>
            <ul>
              <li>
                <Link href="/">Build Objects</Link>
              </li>
              <li>Every price is GST-stated per unit and carries its source and date</li>
              <li>Delivering today across Andhra Pradesh and Telangana</li>
              <li>
                <a href="/api/health">Service status</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span className="footer-brand">
            <Wordmark size={22} />
          </span>
          <span>© {year} Build Objects · Construction materials for India</span>
        </div>
      </div>
    </footer>
  );
}
