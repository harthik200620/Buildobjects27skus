'use client';

import type { CatalogPrices } from '@buildobjects/estimator';
import Image from 'next/image';
import Link from 'next/link';
import React from 'react';
import { IconArrow, IconCart, IconCheckCircle, IconClose, IconCoin, IconEstimate, IconShield, IconStorefront, IconTruck } from '@/components/icons';
import QtyStepper from '@/components/QtyStepper';
import { getBoCoins, redeemBoCoins } from '@/lib/coins';
import { skuTitle } from '@/lib/label';
import { inr } from '@/lib/media';
import { clearPicks, type PickItem, readPicks, removePick, setPickQty } from '@/lib/picks';

export default function BoCart({ initialCatalog, images = {} }: { initialCatalog: CatalogPrices; images?: Record<string, string | null> }) {
  const [picks, setPicks] = React.useState<PickItem[]>([]);
  const catalog = initialCatalog;
  const [coins, setCoins] = React.useState(0);
  const [useCoins, setUseCoins] = React.useState(true);
  const [ordered, setOrdered] = React.useState(false);

  React.useEffect(() => {
    const sync = () => {
      const items = readPicks();
      setPicks(items);
      setCoins(getBoCoins());
    };
    sync();
    window.addEventListener('bo-picks', sync);
    window.addEventListener('bo-coins-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('bo-picks', sync);
      window.removeEventListener('bo-coins-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const subtotal = React.useMemo(() => {
    return picks.reduce((sum, p) => {
      const s = catalog[p.sku_code];
      const price = s?.selling_price ?? 0;
      return sum + price * p.qty;
    }, 0);
  }, [picks, catalog]);

  const maxRedeemableCoins = Math.min(coins, Math.floor(subtotal));
  const appliedCoins = useCoins ? maxRedeemableCoins : 0;
  const netTotal = Math.max(0, subtotal - appliedCoins);

  const handleCheckout = () => {
    if (appliedCoins > 0) {
      redeemBoCoins(appliedCoins);
    }
    clearPicks();
    setOrdered(true);
  };

  if (ordered) {
    return (
      <div className="cart-state">
        <span className="cart-state-mark cart-state-mark--ok">
          <IconCheckCircle size={30} />
        </span>
        <h2 className="cart-state-h">Order placed</h2>
        <p className="cart-state-p">
          Your order is with us. We call to confirm the load and the delivery slot before anything leaves the yard — nothing is dispatched until you have agreed
          both.
          {appliedCoins > 0 && (
            <>
              {' '}
              <b>{inr(appliedCoins)}</b> of BO Coins came off this order.
            </>
          )}
        </p>
        <div className="cart-state-cta">
          <Link href="/search" className="btn btn-primary btn--lg">
            Keep shopping
          </Link>
          <Link href="/estimate" className="btn btn-secondary btn--lg">
            <IconEstimate size={16} /> Open the estimator
          </Link>
        </div>
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <div className="cart-state">
        <span className="cart-state-mark">
          <IconCart size={28} />
        </span>
        <h2 className="cart-state-h">Nothing in the cart yet</h2>
        <p className="cart-state-p">
          Every product page carries the price per unit, the GST on it, and a view of the item standing in your own room at its true size. Start there.
        </p>
        <div className="cart-state-cta">
          <Link href="/search" className="btn btn-primary btn--lg">
            <IconStorefront size={16} /> Browse the catalogue
          </Link>
          <Link href="/estimate" className="btn btn-secondary btn--lg">
            <IconEstimate size={16} /> Estimate a house
          </Link>
        </div>
      </div>
    );
  }

  const lines = picks.reduce((n, p) => n + p.qty, 0);

  return (
    <div className="cart">
      {/* ------------------------------------------------------------------ the lines */}
      <div className="cart-main">
        <section className="cart-panel" aria-labelledby="cart-h" data-reveal>
          <div className="cart-panel-head">
            <h2 id="cart-h" className="cart-panel-title">
              Your cart
              <span className="cart-count fig">{lines}</span>
            </h2>
            <button type="button" onClick={() => clearPicks()} className="cart-clear">
              Empty the cart
            </button>
          </div>

          <ul className="cart-lines">
            {picks.map((p) => {
              const sku = catalog[p.sku_code];
              const price = sku?.selling_price ?? 0;
              return (
                <li key={p.sku_code} className="cart-line">
                  {/* The same picture the product page shows, on the same plate. A cart of names
                      and figures is a receipt; a cart with the things in it is a cart.

                      next/image rather than a bare <img> so lib/image-loader.ts picks a
                      rendition: a 72px slot at 2× needs 144px and gets the 240px thumb, where a
                      raw src would have served the 480px card — four times the pixels for a
                      thumbnail, on every line of every cart. */}
                  <Link href={`/p/${p.sku_code.toLowerCase()}`} className="cart-line-shot" tabIndex={-1} aria-hidden="true">
                    {images[p.sku_code] ? <Image src={images[p.sku_code] as string} alt="" width={72} height={72} sizes="72px" /> : null}
                  </Link>
                  <div className="cart-line-what">
                    <Link href={`/p/${p.sku_code.toLowerCase()}`} className="cart-line-name">
                      {sku ? skuTitle(sku.name, sku.brand) : p.sku_code}
                    </Link>
                    <p className="cart-line-unit">
                      {sku?.brand ? `${sku.brand} · ` : ''}
                      <span className="fig">{inr(price, { decimals: true })}</span> per {sku?.unit ?? 'unit'}, GST included
                    </p>
                  </div>

                  <QtyStepper code={p.sku_code} qty={p.qty} onChange={(q) => setPickQty(p.sku_code, q)} />

                  <span className="cart-line-total fig">{inr(price * p.qty, { decimals: true })}</span>

                  <button
                    type="button"
                    className="icon-btn cart-line-x"
                    onClick={() => removePick(p.sku_code)}
                    aria-label={`Remove ${sku?.name ?? p.sku_code}`}
                  >
                    <IconClose size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/*
         * What the store will actually do for this order.
         *
         * Three cards stood here reading "Fast AP & TS Delivery", "7-Day Return Policy" and
         * "100% Genuine Brands". The first is not a commitment, the second is a policy the store
         * has never published anywhere, and the third is the kind of claim that means nothing
         * precisely because no seller would ever print its opposite. Inventing a returns window
         * on a checkout page is the worst place in the whole store to invent something.
         *
         * What is here instead is what the code and the catalogue can stand behind.
         */}
        <ul className="cart-assure" data-reveal>
          <li>
            <IconTruck size={17} />
            <span>Delivered across Andhra Pradesh and Telangana, to the pincode set in the header.</span>
          </li>
          <li>
            <IconShield size={17} />
            <span>Every line is the brand and pack you picked, at the price shown on its product page.</span>
          </li>
          <li>
            <IconEstimate size={17} />
            <span>We call to confirm the load and the slot before anything is dispatched.</span>
          </li>
        </ul>
      </div>

      {/* ---------------------------------------------------------------- the total */}
      <div className="cart-side">
        <section className="cart-panel cart-summary" aria-labelledby="sum-h" data-reveal="left">
          <h2 id="sum-h" className="cart-panel-title">
            Order summary
          </h2>

          <div className="cart-coins">
            <div className="cart-coins-head">
              <span className="cart-coins-label">
                <IconCoin size={15} /> BO Coins
              </span>
              <span className="fig cart-coins-have">{coins} available</span>
            </div>
            {coins > 0 ? (
              <label className="cart-coins-opt">
                <input type="checkbox" className="check" checked={useCoins} onChange={(e) => setUseCoins(e.target.checked)} />
                <span>
                  Put <b className="fig">{maxRedeemableCoins}</b> of them against this order and take <b className="fig">{inr(maxRedeemableCoins)}</b> off. One
                  coin is one rupee.
                </span>
              </label>
            ) : (
              <p className="cart-coins-none">No coins yet. The BO Engine in your account hands them out; they never expire.</p>
            )}
          </div>

          <dl className="cart-totals">
            <div>
              <dt>Subtotal</dt>
              <dd className="fig">{inr(subtotal, { decimals: true })}</dd>
            </div>
            {appliedCoins > 0 && (
              <div className="is-credit">
                <dt>BO Coins</dt>
                <dd className="fig">− {inr(appliedCoins, { decimals: true })}</dd>
              </div>
            )}
            <div>
              <dt>Delivery</dt>
              <dd className="cart-free">Included</dd>
            </div>
          </dl>

          <div className="cart-net">
            <div>
              <p className="cart-net-label">To pay</p>
              <p className="cart-net-note">GST included</p>
            </div>
            <p className={`cart-net-figure fig${netTotal === 0 && subtotal > 0 ? ' is-covered' : ''}`}>{inr(netTotal, { decimals: true })}</p>
          </div>
          {netTotal === 0 && subtotal > 0 && <p className="cart-covered">Covered in full by your BO Coins.</p>}

          <button type="button" className="btn btn-primary btn--lg btn--block" onClick={handleCheckout}>
            Place the order <IconArrow size={16} />
          </button>
          <Link href="/estimate" className="btn btn-secondary btn--block cart-to-estimate">
            <IconEstimate size={16} /> Send these to the estimator
          </Link>
        </section>
      </div>
    </div>
  );
}
