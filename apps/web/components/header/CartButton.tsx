'use client';

import Link from 'next/link';
import React from 'react';
import BoCoinWheel from '@/components/BoCoinWheel';
import BoCartMark from '@/components/cart/BoCartMark';
import { IconClose } from '@/components/icons';
import { useDismiss } from '@/components/useDismiss';
import { type CoinActivity, getBoCoinHistory, getBoCoins } from '@/lib/coins';
import { readPicks } from '@/lib/picks';

/** BO Cart & BO Coins Wallet popover action in header. */
export default function CartButton() {
  const [count, setCount] = React.useState(0);
  const [coins, setCoins] = React.useState(0);
  const [history, setHistory] = React.useState<CoinActivity[]>([]);
  const [walletOpen, setWalletOpen] = React.useState(false);
  const [wheelOpen, setWheelOpen] = React.useState(false);

  const walletRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const read = () => {
      setCount(readPicks().reduce((n, p) => n + p.qty, 0));
      setCoins(getBoCoins());
      setHistory(getBoCoinHistory());
    };
    read();
    window.addEventListener('bo-picks', read);
    window.addEventListener('bo-coins-changed', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('bo-picks', read);
      window.removeEventListener('bo-coins-changed', read);
      window.removeEventListener('storage', read);
    };
  }, []);

  useDismiss(walletOpen, () => setWalletOpen(false), { panel: walletRef });

  return (
    <>
      <div className="flex items-center gap-2" ref={walletRef} style={{ position: 'relative' }}>
        {/* BO Coins Balance Interactive Trigger */}
        <button
          type="button"
          onClick={() => setWalletOpen((o) => !o)}
          className="hidden md:flex items-center gap-1.5 text-[12px] font-bold text-[var(--color-coin-ink)] bg-[var(--color-coin-wash)] border border-[var(--color-coin-line)] px-3 py-1.5 rounded-full hover:bg-[var(--color-coin-wash-strong)] transition-all cursor-pointer shadow-sm"
          aria-expanded={walletOpen}
          aria-label={`BO Coins Balance: ${coins} coins`}
        >
          <span style={{ fontSize: '14px' }}>🪙</span>
          <span>{coins} Coins</span>
        </button>

        {/* BO Coins Wallet Popover */}
        {walletOpen && (
          <div
            className="popover fade-in"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: '0',
              width: '320px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-coin-line)',
              borderRadius: '18px',
              padding: '18px',
              boxShadow: '0 20px 40px var(--scrim-ink), 0 0 25px var(--color-coin-wash)',
              zIndex: 900,
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '18px' }}>🪙</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-ink)' }}>BO Coins Wallet</span>
              </div>
              <button
                type="button"
                onClick={() => setWalletOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--color-ink-3)', cursor: 'pointer', padding: '2px' }}
                aria-label="Close wallet"
              >
                <IconClose size={15} />
              </button>
            </div>

            {/* Balance Card */}
            <div
              style={{
                background: 'linear-gradient(145deg, var(--color-coin-wash-strong), var(--color-coin-wash))',
                border: '1px solid var(--color-coin-line)',
                borderRadius: '14px',
                padding: '14px',
                marginBottom: '14px',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--color-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Available Balance
              </div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-coin-ink)', marginTop: '2px' }}>🪙 {coins} BO Coins</div>
              <div style={{ fontSize: '12px', color: 'var(--color-ink-2)', marginTop: '3px' }}>
                Equivalent Value: <b>₹{coins} instant discount</b>
              </div>
            </div>

            {/* Explanatory Note */}
            <p style={{ fontSize: '12px', color: 'var(--color-ink-3)', lineHeight: '17px', marginBottom: '14px' }}>
              1 BO Coin = ₹1 cash discount. Check &quot;Redeem BO Coins&quot; in your BO Cart during checkout to apply savings.
            </p>

            {/* Activity History */}
            {history.length > 0 && (
              <div style={{ marginBottom: '14px', borderTop: '1px solid var(--color-line)', paddingTop: '10px' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--color-ink-3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: '8px',
                  }}
                >
                  Recent Transactions
                </div>
                <div style={{ maxHeight: '120px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {history.slice(0, 4).map((h) => (
                    <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                      <span style={{ color: 'var(--color-ink-2)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.description}
                      </span>
                      <span style={{ fontWeight: 700, color: h.amount > 0 ? 'var(--color-credit)' : 'var(--color-debit)' }}>
                        {h.amount > 0 ? `+${h.amount}` : h.amount}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <button
              type="button"
              className="btn-primary btn--block"
              style={{ height: '38px', fontSize: '12.5px' }}
              onClick={() => {
                setWalletOpen(false);
                setWheelOpen(true);
              }}
            >
              ⚡ Activate BO Engine
            </button>
          </div>
        )}

        {/* BO Cart Button */}
        <Link
          href="/cart"
          className="header-action header-action--cart"
          aria-label={count > 0 ? `BO Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'BO Cart'}
        >
          <span className="header-action-icon relative">
            {/* The count is the arrival trigger: add something and the trolley lands again. */}
            <BoCartMark size={24} arriveKey={count} />
            {count > 0 && (
              <span className="header-count" aria-hidden="true">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </span>
          <span className="header-action-label">BO Cart</span>
        </Link>
      </div>

      {/* Kinetic Wheel Popover */}
      {wheelOpen && <BoCoinWheel forceOpen onClose={() => setWheelOpen(false)} />}
    </>
  );
}
