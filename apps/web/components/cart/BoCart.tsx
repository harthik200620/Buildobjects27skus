'use client';

import type { CatalogPrices } from '@buildobjects/estimator';
import Link from 'next/link';
import React from 'react';
import { IconArrow, IconClose, IconEstimate, IconMinus, IconPlus, IconReturn, IconShield, IconTruck } from '@/components/icons';
import { getBoCoins, redeemBoCoins } from '@/lib/coins';
import { inr } from '@/lib/media';
import { clearPicks, type PickItem, readPicks, removePick, setPickQty } from '@/lib/picks';

export default function BoCart({ initialCatalog }: { initialCatalog: CatalogPrices }) {
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
      <div className="glass-card text-center py-12 px-6 max-w-[540px] mx-auto my-10" style={{ borderRadius: '24px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>BO Order Confirmed!</h2>
        <p style={{ color: 'var(--ink-2)', fontSize: '14px', lineHeight: '22px', marginBottom: '24px' }}>
          Thank you for choosing Build Objects. Your order has been placed with verified dealer inventory and scheduled for prompt delivery.
          {appliedCoins > 0 && ` You saved ₹${appliedCoins} using your BO Coins!`}
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/" className="btn-primary h-11 px-6 text-[13.5px]">
            Back to BO Home
          </Link>
          <Link href="/estimate" className="btn-ghost h-11 px-6 text-[13.5px]">
            Open BO Estimator
          </Link>
        </div>
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <div className="glass-card text-center py-16 px-6 max-w-[520px] mx-auto my-10" style={{ borderRadius: '24px' }}>
        <div style={{ fontSize: '42px', marginBottom: '14px' }}>🛒</div>
        <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px' }}>Your BO Cart is Empty</h2>
        <p style={{ color: 'var(--ink-2)', fontSize: '13.5px', marginBottom: '24px' }}>
          Browse our 27 flagship products in the BO Store or view products in 3D AR before adding to your cart.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/search" className="btn-primary h-11 px-6 text-[13px]">
            Explore BO Store
          </Link>
          <Link href="/estimate" className="btn-ghost h-11 px-6 text-[13px]">
            BO Estimator
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 my-6">
      {/* Products Column */}
      <div className="lg:col-span-2 space-y-4">
        <div className="glass-card" style={{ borderRadius: 'var(--radius-glass)', padding: '20px' }}>
          <div className="flex items-center justify-between pb-4 border-b border-[var(--rule-soft)]">
            <h2 className="text-[17px] font-semibold">BO Cart Items ({picks.reduce((n, p) => n + p.qty, 0)})</h2>
            <button type="button" onClick={() => clearPicks()} className="text-[12px] text-[var(--ink-3)] hover:text-[var(--accent)]">
              Clear all
            </button>
          </div>

          <div className="divide-y divide-[var(--rule-soft)]">
            {picks.map((p) => {
              const s = catalog[p.sku_code];
              const price = s?.selling_price ?? 0;
              const lineTotal = price * p.qty;

              return (
                <div key={p.sku_code} className="py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/p/${p.sku_code.toLowerCase()}`}
                      className="text-[14px] font-medium text-[var(--ink)] hover:text-[var(--accent)] block truncate"
                    >
                      {s ? `${s.brand} ${s.name}` : p.sku_code}
                    </Link>
                    <div className="text-[12px] text-[var(--ink-2)] mt-0.5">
                      Exact Price: <span className="fig font-semibold text-[var(--ink)]">{inr(price, { decimals: true })}</span> per {s?.unit ?? 'unit'} (incl.
                      GST)
                    </div>
                  </div>

                  {/* Quantity Stepper */}
                  <div className="qty" role="group" aria-label={`Quantity of ${p.sku_code}`}>
                    <button type="button" onClick={() => setPickQty(p.sku_code, p.qty - 1)} aria-label="Decrease">
                      <IconMinus size={14} />
                    </button>
                    <span className="qty-val fig font-semibold">{p.qty}</span>
                    <button type="button" onClick={() => setPickQty(p.sku_code, p.qty + 1)} aria-label="Increase">
                      <IconPlus size={14} />
                    </button>
                  </div>

                  {/* Line Total */}
                  <div className="fig font-semibold text-[14px] min-w-[80px] text-right">{inr(lineTotal, { decimals: true })}</div>

                  {/* Remove Button */}
                  <button type="button" className="icon-btn" onClick={() => removePick(p.sku_code)} aria-label="Remove item">
                    <IconClose size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Assurance Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="glass-card text-center p-3 text-[12px]" style={{ borderRadius: '12px' }}>
            <IconTruck size={18} className="mx-auto mb-1 text-[var(--accent)]" />
            <span>Fast AP & TS Delivery</span>
          </div>
          <div className="glass-card text-center p-3 text-[12px]" style={{ borderRadius: '12px' }}>
            <IconReturn size={18} className="mx-auto mb-1 text-[var(--accent)]" />
            <span>7-Day Return Policy</span>
          </div>
          <div className="glass-card text-center p-3 text-[12px]" style={{ borderRadius: '12px' }}>
            <IconShield size={18} className="mx-auto mb-1 text-[var(--accent)]" />
            <span>100% Genuine Brands</span>
          </div>
        </div>
      </div>

      {/* Order Summary & BO Coins Redemption Column */}
      <div className="space-y-4">
        <div className="glass-card p-6" style={{ borderRadius: 'var(--radius-glass)' }}>
          <h2 className="text-[17px] font-semibold mb-4">BO Order Summary</h2>

          {/* BO Coins Redemption Box */}
          <div
            style={{
              background: 'var(--color-coin-wash)',
              border: '1px solid var(--color-coin-line)',
              borderRadius: '14px',
              padding: '14px',
              marginBottom: '16px',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 font-semibold text-[13px] text-[var(--color-coin-ink)]">
                <span>🪙</span> BO Coins
              </div>
              <span className="text-[12px] fig text-[var(--ink-2)]">{coins} available</span>
            </div>

            {coins > 0 ? (
              <label className="flex items-start gap-2 cursor-pointer text-[12.5px] mt-1">
                <input type="checkbox" className="check mt-0.5" checked={useCoins} onChange={(e) => setUseCoins(e.target.checked)} />
                <span>
                  Redeem <b>{maxRedeemableCoins} BO Coins</b> for an instant <b>₹{maxRedeemableCoins}</b> discount (1 Coin = ₹1)
                </span>
              </label>
            ) : (
              <p className="text-[12px] text-[var(--ink-2)]">You have 0 BO Coins. Spin the wheel in your BO Account to earn welcome coins!</p>
            )}
          </div>

          {/* Totals Breakdown */}
          <div className="space-y-2 text-[13.5px] pb-4 border-b border-[var(--rule-soft)]">
            <div className="flex justify-between">
              <span className="text-[var(--ink-2)]">Item Subtotal</span>
              <span className="fig font-semibold">{inr(subtotal, { decimals: true })}</span>
            </div>
            {appliedCoins > 0 && (
              <div className="flex justify-between text-[var(--color-credit)]">
                <span>BO Coins Discount</span>
                <span className="fig font-semibold">− {inr(appliedCoins, { decimals: true })}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[var(--ink-2)]">Delivery Fee</span>
              <span className="text-[var(--color-credit)] font-semibold">FREE</span>
            </div>
          </div>

          {/* Net Total Payable */}
          <div className="flex justify-between items-baseline pt-4 pb-6">
            <div>
              <div className="text-[15px] font-bold">Total Amount</div>
              <div className="text-[11.5px] text-[var(--ink-3)]">Exact store price incl. GST</div>
            </div>
            <div className="text-right">
              <div className="hero-figure text-[26px]">
                {netTotal === 0 && subtotal > 0 ? (
                  <span className="text-[var(--color-credit)] font-extrabold">
                    ₹0 <span className="text-[13px] bg-[var(--color-credit)]/15 text-[var(--color-credit)] px-2 py-0.5 rounded-full uppercase ml-1">FREE</span>
                  </span>
                ) : (
                  inr(netTotal, { decimals: true })
                )}
              </div>
              {netTotal === 0 && subtotal > 0 && <div className="text-[11.5px] font-semibold text-[var(--color-credit)] mt-0.5">100% covered by BO Coins!</div>}
            </div>
          </div>

          {/* Primary Action Button */}
          <button
            type="button"
            className="btn-primary w-full h-12 text-[14.5px] font-semibold shadow-xl rounded-xl flex items-center justify-center gap-2"
            onClick={handleCheckout}
          >
            Place BO Order <IconArrow size={16} />
          </button>

          <Link href="/estimate" className="btn-ghost w-full h-11 text-[13px] mt-2 flex items-center justify-center gap-2">
            <IconEstimate size={16} /> Send items to BO Estimator
          </Link>
        </div>
      </div>
    </div>
  );
}
