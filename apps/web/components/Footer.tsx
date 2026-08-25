import { categoryName, categoryOf } from '@buildobjects/catalog';
import Link from 'next/link';
import { AR_DEMO_HREF, type NavCategory } from './header/types';
import { IconChevronUp, IconClockCheck, IconPin, IconRoom, IconShield } from './icons';
import Wordmark from './Wordmark';

/**
 * The foot of every page: what we sell, what the tools are, how the prices work, and where the
 * lorry goes.
 *
 * Four things were wrong with the version this replaces and all four were structural rather than
 * cosmetic. The Tools column pointed at /estimate twice under two names and at /search twice more,
 * so half of it was the same three pages wearing different hats. The About column was an unordered
 * list mixing links with sentences, so two of its four bullets could not be clicked. It ended on a
 * link to /api/health captioned "Service status" — a JSON endpoint aimed at a shopper. And nowhere
 * in it did the store say the two things a buyer actually wants confirmed at the bottom of a page:
 * how a price is arrived at, and whether the lorry comes to them.
 *
 * Nothing here is invented. There is no phone number, address or support hour in this footer,
 * because the store does not have them yet, and a plausible-looking contact block that nobody
 * answers is worse than no contact block.
 */
export default function Footer({ categories }: { categories: NavCategory[] }) {
  const year = new Date().getFullYear();
  const stocked = [...new Set(categories.filter((c) => c.status === 'live').map((c) => categoryOf(c.slug)))];

  return (
    <footer className="footer">
      <a href="#top" className="footer-top">
        <IconChevronUp size={16} /> Back to top
      </a>
      <div className="shell">
        <div className="footer-cols">
          <nav className="footer-col" aria-labelledby="foot-shop" data-reveal>
            <h3 id="foot-shop">Shop</h3>
            {/* The categories that stock something — Concreting, not Cement. The other twenty-six
                are in the "All" menu and the rail beside the results; a footer column of shelves
                with nothing on them is a longer footer and a worse one. */}
            <ul>
              {stocked.map((slug) => (
                <li key={slug}>
                  <Link href={`/c/${slug}`}>{categoryName(slug)}</Link>
                </li>
              ))}
              <li>
                <Link href="/search">Everything in the catalogue</Link>
              </li>
            </ul>
          </nav>

          <nav className="footer-col" aria-labelledby="foot-tools" data-reveal>
            <h3 id="foot-tools">Before you order</h3>
            <ul>
              <li>
                <Link href="/estimate">Cost your whole house</Link>
              </li>
              <li>
                <Link href={AR_DEMO_HREF}>See an item in your room</Link>
              </li>
              <li>
                <Link href="/cart">Your cart and BO Coins</Link>
              </li>
            </ul>
          </nav>

          <div className="footer-col" data-reveal>
            <h3>How our prices work</h3>
            <ul className="footer-facts">
              <li>
                <IconShield size={15} />
                <span>Priced per unit, GST included, with the rate stated beside every figure.</span>
              </li>
              <li>
                <IconClockCheck size={15} />
                <span>Every figure carries the date it was read and the source it came from.</span>
              </li>
              <li>
                <IconRoom size={15} />
                <span>Stocked items can be viewed at true size in your own room first.</span>
              </li>
            </ul>
          </div>

          <div className="footer-col" data-reveal>
            <h3>Where we deliver</h3>
            <ul className="footer-facts">
              <li>
                <IconPin size={15} />
                <span>
                  Andhra Pradesh and Telangana — pincodes <span className="fig">500001</span> to <span className="fig">539999</span>.
                </span>
              </li>
            </ul>
            <p className="footer-note">
              Hyderabad, Vijayawada, Visakhapatnam, Warangal, Guntur and Tirupati are on the daily run. Set your pincode in the header and every price on the
              site becomes the landed one.
            </p>
          </div>
        </div>

        <div className="footer-bottom">
          <span className="footer-brand">
            <Wordmark size={22} />
          </span>
          <span className="footer-live">
            <span className="pulse-dot" aria-hidden />
            Catalogue live
          </span>
          <span className="footer-legal">© {year} Build Objects · Construction materials for India</span>
        </div>
      </div>
    </footer>
  );
}
