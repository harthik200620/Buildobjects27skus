'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import BoCoinWheel from '@/components/BoCoinWheel';
import { IconCart, IconCheck, IconCoin, IconEngine, IconEstimate, IconLogout, IconUser } from '@/components/icons';
import { useDismiss } from '@/components/useDismiss';
import { getBoCoins, getProfileName, setProfileName as saveProfileName } from '@/lib/coins';
import { inr } from '@/lib/media';

/** BO Account Menu: Profile Name, Mobile Number, BO Coins Balance, BO Cart, and Logout. */
export default function AccountMenu({ phone }: { phone: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [coins, setCoins] = React.useState(0);
  const [profileName, setProfile] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [nameInput, setNameInput] = React.useState('');
  const [showWheel, setShowWheel] = React.useState(false);

  const wrap = React.useRef<HTMLDivElement | null>(null);
  const btn = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    const sync = () => {
      setCoins(getBoCoins());
      const pName = getProfileName(phone);
      setProfile(pName);
      setNameInput(pName);
    };
    sync();
    window.addEventListener('bo-coins-changed', sync);
    window.addEventListener('bo-profile-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('bo-coins-changed', sync);
      window.removeEventListener('bo-profile-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, [phone]);

  useDismiss(open, () => setOpen(false), { panel: wrap, trigger: btn });

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) {
      saveProfileName(nameInput.trim());
      setProfile(nameInput.trim());
      setEditing(false);
    }
  };

  async function logout() {
    setOpen(false);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/welcome');
    router.refresh();
  }

  const prettyPhone = `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`;

  return (
    <>
      <div className="account-wrap" ref={wrap}>
        <button
          ref={btn}
          type="button"
          className="header-action"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="BO Account"
        >
          <span className="header-action-icon">
            <IconUser size={22} />
          </span>
          <span className="header-action-label">BO Account</span>
        </button>
        {open && (
          <div className="popover menu account-menu fade-in" role="menu" aria-label="BO Account">
            {/* 1. Who is signed in, and the one thing they can change about it. */}
            <div className="account-who">
              {!editing ? (
                <div className="account-who-row">
                  <div className="account-who-id">
                    <p className="account-who-name">{profileName}</p>
                    <p className="account-who-phone fig">{prettyPhone}</p>
                  </div>
                  <button type="button" onClick={() => setEditing(true)} className="account-edit">
                    Edit
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSaveName} className="account-edit-form">
                  <input
                    type="text"
                    className="input input--sm"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Your name or firm"
                    aria-label="Your name or firm"
                  />
                  <button type="submit" className="btn btn-primary btn--sm btn--icon" aria-label="Save name">
                    <IconCheck size={14} />
                  </button>
                </form>
              )}
            </div>

            {/* 2. What the account is worth today. */}
            <div className="menu-coins">
              <div>
                <p className="menu-coins-label">BO Coins</p>
                <p className="menu-coins-figure fig">
                  <IconCoin size={15} /> {coins}
                </p>
                <p className="menu-coins-worth">Worth {inr(coins)} in the cart</p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn--sm"
                onClick={() => {
                  setOpen(false);
                  setShowWheel(true);
                }}
              >
                <IconEngine size={14} /> Earn more
              </button>
            </div>

            {/* 3. Navigation Links */}
            <Link href="/cart" className="menu-row" role="menuitem" onClick={() => setOpen(false)}>
              <IconCart size={18} /> BO Cart
            </Link>
            <Link href="/estimate" className="menu-row" role="menuitem" onClick={() => setOpen(false)}>
              <IconEstimate size={18} /> BO Estimator
            </Link>
            <button type="button" className="menu-row account-logout" role="menuitem" onClick={logout}>
              <IconLogout size={18} /> Log out
            </button>
          </div>
        )}
      </div>

      {/* Spin to Win Wheel Pop-up */}
      {showWheel && <BoCoinWheel forceOpen onClose={() => setShowWheel(false)} />}
    </>
  );
}
