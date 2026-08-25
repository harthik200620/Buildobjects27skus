'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import BoCoinWheel from '@/components/BoCoinWheel';
import { IconCheck, IconEstimate, IconLogout, IconUser } from '@/components/icons';
import { useDismiss } from '@/components/useDismiss';
import { getBoCoins, getProfileName, setProfileName as saveProfileName } from '@/lib/coins';

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
          <div className="popover menu fade-in" role="menu" aria-label="BO Account" style={{ minWidth: '280px', padding: '16px 14px' }}>
            {/* 1. Profile Name & Edit */}
            <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--rule-soft)' }}>
              {!editing ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>{profileName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--ink-2)', marginTop: '2px' }}>{prettyPhone}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    style={{ fontSize: '11.5px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSaveName} style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    className="field text-[12.5px] h-8 px-2"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Your Name / Company"
                  />
                  <button type="submit" className="btn-primary h-8 px-3 text-[12px]">
                    <IconCheck size={14} />
                  </button>
                </form>
              )}
            </div>

            {/* 2. BO Coins Balance Card */}
            <div
              style={{
                background: 'var(--color-coin-wash)',
                border: '1px solid var(--color-coin-line)',
                borderRadius: '10px',
                padding: '10px 12px',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  BO Coins Balance
                </div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-coin)', marginTop: '2px' }}>🪙 {coins} Coins</div>
                <div style={{ fontSize: '11px', color: 'var(--ink-3)' }}>Worth ₹{coins} off in BO Cart</div>
              </div>
              <button
                type="button"
                className="chip"
                style={{
                  fontSize: '11.5px',
                  background: 'var(--color-engine-from)',
                  color: 'var(--color-engine-ink)',
                  fontWeight: 700,
                  padding: '5px 10px',
                  border: '1px solid var(--color-engine-line)',
                }}
                onClick={() => {
                  setOpen(false);
                  setShowWheel(true);
                }}
              >
                ⚡ BO Engine
              </button>
            </div>

            {/* 3. Navigation Links */}
            <Link href="/cart" className="menu-row" role="menuitem" onClick={() => setOpen(false)}>
              🛒 BO Cart & Discounts
            </Link>
            <Link href="/estimate" className="menu-row" role="menuitem" onClick={() => setOpen(false)}>
              <IconEstimate size={18} /> BO Cost Calculator
            </Link>
            <button type="button" className="menu-row" role="menuitem" onClick={logout} style={{ marginTop: '4px', color: 'var(--ink-2)' }}>
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
