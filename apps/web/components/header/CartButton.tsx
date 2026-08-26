'use client';

import Link from 'next/link';
import React from 'react';
import BoCoinWheel from '@/components/BoCoinWheel';
import BoCartMark from '@/components/cart/BoCartMark';
import { IconClose, IconCoin, IconEngine } from '@/components/icons';
import { useDismiss } from '@/components/useDismiss';
import { type CoinActivity, getBoCoinHistory, getBoCoins } from '@/lib/coins';
import { inr } from '@/lib/media';
import { readPicks } from '@/lib/picks';

/**
 * The two things on the right of the header: the coin balance, and the cart.
 *
 * Everything visible here used to be written inline — a 320 px popover with an 18 px radius, a
 * 145deg gradient, a 12.5 px button and a 🪙 in three places. It is now `.wallet-*` in store.css,
 * on the token scale, with the coin drawn rather than typed. Behaviour is unchanged.
 */
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
      <div className="header-right" ref={walletRef}>
        <button
          type="button"
          onClick={() => setWalletOpen((o) => !o)}
          className="coin-pill"
          aria-expanded={walletOpen}
          aria-label={`BO Coins balance: ${coins} coins`}
        >
          <IconCoin size={15} />
          <span className="fig">{coins}</span>
          <span className="coin-pill-word">Coins</span>
        </button>

        {walletOpen && (
          <div className="wallet fade-in" role="dialog" aria-label="BO Coins wallet">
            <div className="wallet-head">
              <h2 className="wallet-title">
                <IconCoin size={17} /> BO Coins
              </h2>
              <button type="button" onClick={() => setWalletOpen(false)} className="wallet-close" aria-label="Close wallet">
                <IconClose size={15} />
              </button>
            </div>

            <div className="wallet-balance">
              <p className="wallet-balance-label">Balance</p>
              <p className="wallet-balance-figure fig">
                {coins} <span>{coins === 1 ? 'coin' : 'coins'}</span>
              </p>
              <p className="wallet-balance-worth">
                Worth <b className="fig">{inr(coins)}</b> off your next order
              </p>
            </div>

            <p className="wallet-note">One coin is one rupee off. Redeem them in the cart before you check out; they never expire.</p>

            {history.length > 0 && (
              <div className="wallet-history">
                <h3 className="wallet-history-h">Recent</h3>
                <ul className="wallet-history-list">
                  {history.slice(0, 4).map((h) => (
                    <li key={h.id}>
                      <span className="wallet-history-what">{h.description}</span>
                      <span className={`fig wallet-history-amt ${h.amount > 0 ? 'is-credit' : 'is-debit'}`}>{h.amount > 0 ? `+${h.amount}` : h.amount}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary btn--sm btn--block"
              onClick={() => {
                setWalletOpen(false);
                setWheelOpen(true);
              }}
            >
              <IconEngine size={15} /> Spin the BO Engine
            </button>
          </div>
        )}

        <Link
          href="/cart"
          className="header-action header-action--cart"
          aria-label={count > 0 ? `BO Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'BO Cart'}
        >
          <span className="header-action-icon relative">
            {/* The count is the arrival trigger: add something and the trolley lands again.
                The porter is on at 30px — he was off at 24 because he was illegible there, and
                the one-row header gave the rig the six pixels that changes. */}
            <BoCartMark size={30} arriveKey={count} driver />
            {count > 0 && (
              <span className="header-count" aria-hidden="true">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </span>
          <span className="header-action-label">BO Cart</span>
        </Link>
      </div>

      {wheelOpen && <BoCoinWheel forceOpen onClose={() => setWheelOpen(false)} />}
    </>
  );
}
