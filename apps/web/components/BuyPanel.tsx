'use client';

import Link from 'next/link';
import React from 'react';
import type { SkuPageData } from '@/lib/catalog';
import { inr, pctOff } from '@/lib/media';
import { addPick, readPicks } from '@/lib/picks';
import { IconCheck, IconInfo, IconMinus, IconPlus, IconReturn, IconRoom, IconShield, IconTruck } from './icons';

/**
 * Sticky buy panel: brand + name (name in Encode Sans — Audiowide never sets a line that could
 * hold a digit or ₹), the honest price block, pincode serviceability,
 * quantity stepper, Add to Estimate + View in your room, delivery / returns / warranty line.
 */
export default function BuyPanel({ data, pincode }: { data: SkuPageData; pincode: string }) {
  const { sku, product, brand, category } = data;
  const off = pctOff(sku.mrp, sku.price);
  const [qty, setQty] = React.useState(1);
  const [pin, setPin] = React.useState(pincode);
  const [svc, setSvc] = React.useState<{ serviceable: boolean; note: string } | null>(null);
  const [added, setAdded] = React.useState<number | null>(null);
  const [checking, setChecking] = React.useState(false);

  /*
   * `check` was a plain function declaration, so it had a fresh identity on every render and the
   * effect below re-fired each time — one /api/serviceability request per render. It closes over
   * nothing but state setters, whose identity React guarantees, so an empty dep list is correct.
   */
  const check = React.useCallback(async (p: string) => {
    if (!/^\d{6}$/.test(p)) {
      setSvc(null);
      return;
    }
    setChecking(true);
    try {
      const r = await fetch(`/api/serviceability?pincode=${p}`);
      setSvc(await r.json());
    } catch {
      setSvc(null);
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    check(pincode);
  }, [pincode, check]);

  function add() {
    addPick({ sku_code: sku.code, qty });
    setAdded(readPicks().reduce((n, p) => n + p.qty, 0));
    setTimeout(() => setAdded(null), 2400);
  }
  const dated = sku.priceFetchedAt ? new Date(sku.priceFetchedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const warrantyRow = sku.keySpecs.find((k) => /warranty/i.test(k.label));

  return (
    /* .buy-panel owns its own glass now — radius, blur, edge and shadow together, in
       store.css. The inline radius here was overriding it from a stylesheet nobody
       would think to look in, which is the reason inline styles for anything the theme
       already names are a rule this project keeps. */
    <div className="buy-panel">
      <p className="buy-brand">{brand.name}</p>
      <h1 className="buy-name fig font-semibold">{product.name}</h1>
      {sku.variant && (
        <p className="buy-variant">
          {sku.variant}
          {product.modelNo ? (
            <>
              {' '}
              · Model <span className="fig">{product.modelNo}</span>
            </>
          ) : null}
        </p>
      )}
      {/*
        No stars until there are orders behind them. This drew ★★★★☆ 4.3 from
        `skus.rating_placeholder`, a column whose default is 4.3 and whose name says what it
        is; the word "placeholder" beside it did not undo four gold stars at a glance. A store
        with no reviews saying so is worth more than a rating nobody gave.
      */}
      <p className="rating-none">No ratings yet — they appear as customers order and review</p>

      <div className="price-block">
        <div className="price-main">
          <span className="hero-figure">{inr(sku.price, { decimals: true })}</span>
          {off !== null && sku.mrp !== null && (
            <span className="price-mrp">
              M.R.P. <s>{inr(sku.mrp)}</s> <span className="price-off">({off}% off)</span>
            </span>
          )}
        </div>
        <p className="price-meta">
          Incl. <span className="fig">{sku.gstRate}%</span> GST{sku.gstNeedsVerification ? ' (rate to be re-verified)' : ''} · per {sku.unit}
          {sku.packQty > 1 ? (
            <>
              {' '}
              · pack of <span className="fig">{sku.packQty}</span>
            </>
          ) : null}
        </p>
        <p className="provenance-line">
          {sku.priceProvenance === 'estimated' ? (
            <>
              <span className="prov prov-typical">Estimated</span>
              <span>{sku.priceNote ?? 'Typical AP / TS dealer rate — not a quoted price'}</span>
            </>
          ) : (
            <>
              <span className="prov">{sku.priceProvenance === 'verified' ? 'Verified' : 'Fetched'}</span>
              <span>
                {sku.priceSourceUrl ? (
                  <a href={sku.priceSourceUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">
                    {new URL(sku.priceSourceUrl).hostname.replace(/^www\./, '')}
                  </a>
                ) : (
                  brand.name
                )}
                {dated ? ` · ${dated}` : ''}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="pin-check">
        <input
          className="field fig px-3"
          inputMode="numeric"
          value={pin}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6);
            setPin(v);
            if (v.length === 6) check(v);
          }}
          aria-label="Delivery pincode"
          placeholder="Pincode"
        />
        <button type="button" className="btn btn-secondary btn--md" onClick={() => check(pin)} disabled={checking}>
          {checking ? 'Checking…' : 'Check'}
        </button>
      </div>
      {svc && (
        <p className="pin-result flex items-center gap-1.5">
          {svc.serviceable ? <IconCheck size={14} style={{ color: 'var(--ok)' }} /> : <IconInfo size={14} style={{ color: 'var(--color-brand)' }} />}
          {svc.note}
        </p>
      )}

      <div className="buy-actions">
        <div className="qty" role="group" aria-label="Quantity">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease">
            <IconMinus size={16} />
          </button>
          <span className="qty-val fig">
            {qty} {sku.unit}
            {qty > 1 && !/s$/.test(sku.unit) ? 's' : ''}
          </span>
          <button type="button" onClick={() => setQty((q) => Math.min(999, q + 1))} aria-label="Increase">
            <IconPlus size={16} />
          </button>
        </div>
        <button type="button" className="btn-primary" onClick={add}>
          {added !== null ? `Added · ${added} in BO Cart` : 'Add to BO Cart'}
        </button>
      </div>
      <div className="buy-ghost-row">
        <Link
          href={`/ar/${sku.code.toLowerCase()}`}
          className="btn btn-secondary btn--block"
          style={{ border: '1px solid var(--color-brand)', color: 'var(--color-brand)' }}
        >
          <IconRoom size={18} /> View in your room (Live AR)
        </Link>
      </div>
      {qty > 1 && sku.price !== null && (
        <p className="text-[12px] mt-3" style={{ color: 'var(--ink-2)' }}>
          Line total{' '}
          <span className="fig" style={{ color: 'var(--ink-1)' }}>
            {inr(sku.price * qty, { decimals: true })}
          </span>{' '}
          for {qty} {sku.unit}
          {qty > 1 ? 's' : ''}
        </p>
      )}

      <div className="assurance">
        <div className="assurance-item">
          <IconTruck size={18} />
          <span>{svc?.serviceable ? svc.note.replace(/^Delivers (to|across) /, '') : 'AP & TS delivery'}</span>
        </div>
        <div className="assurance-item">
          <IconReturn size={18} />
          <span>7-day returns on sealed goods</span>
        </div>
        <div className="assurance-item">
          <IconShield size={18} />
          <span>{warrantyRow ? `Warranty ${warrantyRow.value}` : `${brand.name} warranty`}</span>
        </div>
      </div>
      <p className="caption mt-4">
        {category.name} · SKU <span className="fig">{sku.code}</span>
        {sku.officialUrl ? (
          <>
            {' '}
            ·{' '}
            <a href={sku.officialUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">
              official page
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
