'use client';

import { formatNumber } from '@buildobjects/catalog';
import {
  type CatalogPrices,
  CITIES,
  type Decision,
  type DrawingExtraction,
  type EstimateInputs,
  type EstimateResult,
  estimate,
  inputsToQuery,
  isPlotByDims,
  LEDGER_LABEL,
  type LineItem,
  type StateCode,
  standardDecisions,
  TIER_LABEL,
  TIERS,
  type Tier,
} from '@buildobjects/estimator';
import Link from 'next/link';
import React from 'react';
import {
  IconArrow,
  IconCheck,
  IconChevronDown,
  IconClose,
  IconInfo,
  IconMinus,
  IconPlus,
  IconPrint,
  IconRefresh,
  IconSave,
  IconShare,
} from '@/components/icons';
import { productTitle } from '@/lib/label';
import { inr } from '@/lib/media';
import { readPicks, removePick, setPickQty } from '@/lib/picks';
import CostRange from './CostRange';
import Donut, { seriesColor } from './Donut';
import DrawingUpload from './DrawingUpload';
import HouseRender from './HouseRender';
import Time from './lenses/Time';
import Truth from './lenses/Truth';
import RulerInput from './RulerInput';

type Field = 'plot' | 'floors' | 'bua' | 'type';
const STATES: { code: StateCode; name: string }[] = [
  { code: 'TS', name: 'Telangana' },
  { code: 'AP', name: 'Andhra Pradesh' },
];
const FLOORS = [0, 1, 2, 3, 4];
const fmtQty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: n < 10 ? 2 : 1 });
const fmtSqft = (n: number) => formatNumber(Math.round(n));

/**
 * BO Estimator — the page body. Three plain questions on the left, a house that builds itself
 * and the running total on the right. Every number on screen is estimate(inputs, catalog);
 * LivingHouse is driven by the same object, so the picture can never disagree with the figure.
 */
export default function Estimator({
  initialInputs,
  catalog: initialCatalog,
  shareId,
}: {
  initialInputs: EstimateInputs;
  catalog: CatalogPrices;
  shareId: string | null;
}) {
  const [inputs, setInputs] = React.useState<EstimateInputs>(initialInputs);
  const [catalog, setCatalog] = React.useState<CatalogPrices>(initialCatalog);
  const [plotMode, setPlotMode] = React.useState<'dims' | 'area'>(isPlotByDims(initialInputs.plot) ? 'dims' : 'area');
  const [drawing, setDrawing] = React.useState<{ reading: DrawingExtraction; name: string; fields: Field[]; confirmed: boolean } | null>(null);
  const [active, setActive] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [allLines, setAllLines] = React.useState(false);
  const [saved, setSaved] = React.useState<{ id: string; url: string } | null>(shareId ? { id: shareId, url: `/estimate?e=${shareId}` } : null);
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [showFlags, setShowFlags] = React.useState(false);

  const set = React.useCallback((patch: Partial<EstimateInputs>) => {
    setInputs((i) => ({ ...i, ...patch }));
    setSaved(null);
  }, []);
  const result: EstimateResult = React.useMemo(() => estimate(inputs, catalog), [inputs, catalog]);
  const unconfirmed = !!drawing && !drawing.confirmed;

  /* picks from the store ("Add to Estimate") live on this device — merge their prices into the snapshot */
  React.useEffect(() => {
    let alive = true;
    const sync = async () => {
      const picks = readPicks();
      const missing = picks.map((p) => p.sku_code).filter((c) => !catalog[c]);
      if (missing.length) {
        try {
          const r = await fetch(`/api/estimate/catalog?codes=${encodeURIComponent(missing.join(','))}`);
          if (r.ok) {
            const j = await r.json();
            if (alive) setCatalog((c) => ({ ...c, ...j }));
          }
        } catch {
          /* seed rates still apply */
        }
      }
      if (alive) setInputs((i) => (JSON.stringify(i.picks ?? []) === JSON.stringify(picks) ? i : { ...i, picks }));
    };
    sync();
    window.addEventListener('bo-picks', sync);
    return () => {
      alive = false;
      window.removeEventListener('bo-picks', sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  /* shareable URL state, back-button safe */
  React.useEffect(() => {
    const t = setTimeout(() => {
      if (!saved) window.history.replaceState(null, '', `/estimate?${inputsToQuery(inputs)}`);
    }, 300);
    return () => clearTimeout(t);
  }, [inputs, saved]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function onReading(reading: DrawingExtraction, name: string) {
    const fields: Field[] = [];
    const patch: Partial<EstimateInputs> = {};
    if (reading.plotLengthFt && reading.plotWidthFt) {
      patch.plot = { lengthFt: Math.round(reading.plotLengthFt), widthFt: Math.round(reading.plotWidthFt) };
      setPlotMode('dims');
      fields.push('plot');
    }
    if (reading.floors !== null) {
      patch.floors = reading.floors;
      fields.push('floors');
    }
    if (reading.builtUpSqft) {
      patch.builtUpOverrideSqft = Math.round(reading.builtUpSqft);
      fields.push('bua');
    }
    if (reading.constructionType) {
      patch.constructionType = reading.constructionType;
      fields.push('type');
    }
    set(patch);
    setDrawing({ reading, name, fields, confirmed: false });
  }
  const from = (f: Field) => drawing?.fields.includes(f) && !drawing.confirmed;

  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/estimates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputs }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not save');
      setSaved({ id: j.id, url: j.url });
      window.history.replaceState(null, '', j.url);
      setToast('Saved — the link is yours to share');
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function share() {
    const url = `${window.location.origin}${saved?.url ?? `/estimate?${inputsToQuery(inputs)}`}`;
    const text = `House estimate · ${result.derived.cityName} · ${result.derived.floorsLabel} · ${fmtSqft(result.derived.builtUpSqft)} sqft · ${inr(result.grandTotal)} (${TIER_LABEL[inputs.tier]})`;
    try {
      if (navigator.share) await navigator.share({ title: 'Build Objects estimate', text, url });
      else {
        await navigator.clipboard.writeText(url);
        setToast('Link copied');
      }
    } catch {
      /* dismissed */
    }
  }

  const city = CITIES.find((c) => c.key === inputs.city) ?? CITIES[0];
  const citiesInState = CITIES.filter((c) => c.state === inputs.state);
  const linesByGroup = React.useMemo(() => {
    const m = new Map<string, LineItem[]>();
    for (const l of result.lines) (m.get(l.group) ?? m.set(l.group, []).get(l.group)!).push(l);
    return m;
  }, [result]);
  const picks = inputs.picks ?? [];

  /*
   * What the timeline offers to price.
   *
   * These four were object literals right here, and one of them was wrong in a way a component is
   * the wrong place to catch: "Add a bedroom" incremented a room counter without making the house
   * any bigger, and — because handing the engine explicit room counts switches it out of its
   * derived-from-area mode — priced out at MINUS 780 rupees. Adding a bedroom appeared to save
   * money.
   *
   * Deciding what a change physically IS is a modelling question. It lives in the engine now,
   * beside the rate card it has to agree with, where a test can hold it to costing more than
   * nothing. See standardDecisions in packages/estimator/src/schedule.ts.
   */
  const decisions: Decision[] = React.useMemo(() => standardDecisions(result), [result]);

  return (
    <div className="est">
      {/* ── the wizard ───────────────────────────────────────────────────── */}
      {/*
       * THE LEFT COLUMN IS FOUR CARDS, NOT ONE CARD WITH FOUR STEPS INSIDE IT.
       * It was a single 1,100px panel against seven stacked cards on the right, which reads as
       * a form with a report bolted beside it rather than as two halves of one instrument.
       * `.wizard` is a plain column now and `.wz-step` carries the card — see estimator.css.
       */}
      <section className="wizard no-print" aria-label="Estimate inputs">
        {drawing && (
          <div className="derived" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, borderLeft: '2px solid var(--color-brand)' }}>
            <span style={{ color: 'var(--ink-1)' }}>
              {drawing.confirmed ? 'Drawing values confirmed' : 'Prefilled from your drawing'} · <span className="fig">{drawing.name}</span>
            </span>
            {!drawing.confirmed && (
              <span>
                The highlighted values came from the reader (
                {drawing.reading.provider === 'mock'
                  ? 'mock — set ANTHROPIC_API_KEY for a real reading'
                  : `confidence ${Math.round(drawing.reading.confidence * 100)}%`}
                ). Check them, correct what is wrong, then confirm.
              </span>
            )}
            {!drawing.confirmed && (
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary btn--sm" onClick={() => setDrawing({ ...drawing, confirmed: true })}>
                  <IconCheck size={14} /> Values are right
                </button>
                <button
                  type="button"
                  className="btn-ghost h-9 px-4 text-[12.5px]"
                  onClick={() => {
                    set({ builtUpOverrideSqft: null });
                    setDrawing(null);
                  }}
                >
                  Discard the reading
                </button>
              </div>
            )}
          </div>
        )}

        {/* step 1 — location */}
        <div className="wz-step">
          <div className="wz-head">
            <span className="wz-title">Location</span>
          </div>
          <div className="seg" role="group" aria-label="State">
            {STATES.map((s) => (
              <button
                key={s.code}
                type="button"
                aria-pressed={inputs.state === s.code}
                onClick={() => {
                  const first = CITIES.find((c) => c.state === s.code)!;
                  set({ state: s.code, city: first.key });
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="wz-row">
            <label>
              <span className="wz-label">City</span>
              <select className="field" value={inputs.city} onChange={(e) => set({ city: e.target.value })} aria-label="City">
                {citiesInState.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="wz-label">
                Pincode <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </span>
              <input
                className="field fig"
                inputMode="numeric"
                placeholder="500001"
                value={inputs.pincode ?? ''}
                onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) || null })}
              />
            </label>
          </div>
          <p className="wz-hint">
            Cost index <span className="fig">{city.index.toFixed(2)}</span> vs Hyderabad
            {city.needs_verification ? ' · thumb value, flagged for verification' : ''}
          </p>
        </div>

        {/* step 2 — the building */}
        <div className="wz-step">
          <div className="wz-head">
            <span className="wz-title">The building</span>
          </div>
          <div className="seg" role="group" aria-label="Plot input">
            <button
              type="button"
              aria-pressed={plotMode === 'dims'}
              onClick={() => {
                setPlotMode('dims');
                if (!isPlotByDims(inputs.plot)) {
                  const s = Math.round(Math.sqrt(inputs.plot.areaSqft));
                  set({ plot: { lengthFt: s, widthFt: s } });
                }
              }}
            >
              Length × width
            </button>
            <button
              type="button"
              aria-pressed={plotMode === 'area'}
              onClick={() => {
                setPlotMode('area');
                if (isPlotByDims(inputs.plot)) set({ plot: { areaSqft: inputs.plot.lengthFt * inputs.plot.widthFt } });
              }}
            >
              Plot area
            </button>
          </div>
          {plotMode === 'dims' && isPlotByDims(inputs.plot) ? (
            /* TWO MEASURING TAPES, NOT TWO NUMBER FIELDS.
               A plot is a measurement and almost nobody types one: they know it as "about thirty
               by forty" and want to feel the difference between 30 and 32. The tape runs 5 to
               100 ft, which covers every residential plot in the two states this prices, and the
               figure above each one is still an input for anyone who does know their number. */
            <div className="wz-rulers">
              <RulerInput
                label={<>Length {from('plot') && <span className="from-drawing">from your drawing — scroll to correct</span>}</>}
                value={inputs.plot.lengthFt}
                onChange={(v) => set({ plot: { lengthFt: v, widthFt: (inputs.plot as { widthFt: number }).widthFt } })}
              />
              <RulerInput
                label="Width"
                value={inputs.plot.widthFt}
                onChange={(v) => set({ plot: { lengthFt: (inputs.plot as { lengthFt: number }).lengthFt, widthFt: v } })}
              />
            </div>
          ) : (
            <label>
              <span className="wz-label">Plot area (sqft)</span>
              <input
                className="field fig"
                type="number"
                min={200}
                max={200000}
                value={!isPlotByDims(inputs.plot) ? inputs.plot.areaSqft : ''}
                onChange={(e) => set({ plot: { areaSqft: Number(e.target.value) || 0 } })}
              />
            </label>
          )}
          <div>
            <span className="wz-label">Floors {from('floors') && <span className="from-drawing">from your drawing — tap to correct</span>}</span>
            <div className="seg" role="group" aria-label="Floors">
              {FLOORS.map((f) => (
                <button key={f} type="button" aria-pressed={inputs.floors === f} onClick={() => set({ floors: f })} className="fig">
                  {f === 0 ? 'G' : `G+${f}`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="wz-label">
              Ground coverage · <span className="fig">{Math.round(inputs.coverage * 100)}%</span> of the plot
            </span>
            <input
              className="slider"
              type="range"
              min={40}
              max={100}
              step={1}
              value={Math.round(inputs.coverage * 100)}
              onChange={(e) => set({ coverage: Number(e.target.value) / 100 })}
              aria-label="Ground coverage percent"
            />
          </div>
          <div>
            <span className="wz-label">Construction {from('type') && <span className="from-drawing">from your drawing — tap to correct</span>}</span>
            <div className="seg" role="group" aria-label="Construction type">
              <button type="button" aria-pressed={inputs.constructionType === 'rcc_framed'} onClick={() => set({ constructionType: 'rcc_framed' })}>
                RCC framed
              </button>
              <button type="button" aria-pressed={inputs.constructionType === 'load_bearing'} onClick={() => set({ constructionType: 'load_bearing' })}>
                Load bearing
              </button>
            </div>
          </div>
          {/* The same list the add-ons use one card down. Two priced options styled one way here
              and another way there is the kind of thing that reads as unconsidered. */}
          <div className="addons">
            <label className="check-row">
              <input type="checkbox" className="check" checked={inputs.parking} onChange={(e) => set({ parking: e.target.checked })} /> Car parking porch
            </label>
            <label className="check-row">
              <input type="checkbox" className="check" checked={inputs.compoundWall} onChange={(e) => set({ compoundWall: e.target.checked })} /> Compound wall
            </label>
          </div>
          <div className="derived">
            <span>
              Built-up area
              {result.derived.fromDrawing ? (
                <>
                  {' '}
                  · <span className="from-drawing">from your drawing</span>
                </>
              ) : (
                <>
                  {' '}
                  · {fmtSqft(result.derived.footprintSqft)} sqft × {result.derived.floorsLabel === 'G' ? 1 : inputs.floors + 1} floors
                </>
              )}
            </span>
            <span className="fig">{fmtSqft(result.derived.builtUpSqft)} sqft</span>
          </div>
          {result.derived.fromDrawing && (
            <div className="wz-row">
              <label>
                <span className="wz-label">Built-up area (sqft) {from('bua') && <span className="from-drawing">from your drawing — tap to correct</span>}</span>
                <input
                  className="field fig"
                  type="number"
                  min={100}
                  value={inputs.builtUpOverrideSqft ?? ''}
                  onChange={(e) => set({ builtUpOverrideSqft: Number(e.target.value) || null })}
                />
              </label>
              <button type="button" className="btn btn-secondary self-end" onClick={() => set({ builtUpOverrideSqft: null })}>
                Use plot × coverage instead
              </button>
            </div>
          )}
        </div>

        {/* step 3 — quality tier + add-ons */}
        <div className="wz-step">
          <div className="wz-head">
            <span className="wz-title">Quality tier</span>
          </div>
          {/* The plain three-way segment used to live here and the priced comparison lived in
              the output column, which is one control drawn twice: the same three buttons, one
              of them knowing what it costs. This is that one, moved across — it is an INPUT and
              it belongs with the inputs. */}
          <div className="tier-strip" role="group" aria-label="Quality tier">
            {TIERS.map((t: Tier) => (
              <button key={t} type="button" className="tier" aria-pressed={inputs.tier === t} onClick={() => set({ tier: t })}>
                <span className="tier-k">{TIER_LABEL[t]}</span>
                <span className="tier-v fig block">{inr(result.tiers[t])}</span>
                <span className="legend-sub">{inr(Math.round(result.tiers[t] / Math.max(1, result.derived.builtUpSqft)))}/sqft</span>
              </button>
            ))}
          </div>
          <p className="wz-hint">
            {/* What each tier actually specifies. The medium one used to end "the most popular
                homeowner choice" — a sales fact nobody here has ever measured, sitting inside a
                list of things that are all verifiable. */}
            {inputs.tier === 'basic'
              ? 'PPC cement, fly-ash bricks, ceramic tiles, flush doors, washable acrylic emulsion.'
              : inputs.tier === 'medium'
                ? 'Premium PPC cement, table-moulded red bricks, 600×600 GVT vitrified tiles, laminated doors, weatherproof exterior paint, partial false ceiling.'
                : 'OPC 53-grade cement, wire-cut bricks, 600×1200 PGVT tiles, teak-finish doors, high-performance architectural glass, full modular interiors.'}
          </p>
          {/* Three of them in a two-column grid orphaned the third and wrapped the other two
              onto second lines. One column, one hairline between each — see estimator.css. */}
          <div className="addons">
            <label className="check-row">
              <input
                type="checkbox"
                className="check"
                checked={inputs.addons.solar}
                onChange={(e) => set({ addons: { ...inputs.addons, solar: e.target.checked } })}
              />
              Solar rooftop system
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                className="check"
                checked={inputs.addons.cctv}
                onChange={(e) => set({ addons: { ...inputs.addons, cctv: e.target.checked } })}
              />
              HD CCTV security package
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                className="check"
                checked={inputs.addons.fireSafety}
                onChange={(e) => set({ addons: { ...inputs.addons, fireSafety: e.target.checked } })}
              />
              Fire safety &amp; extinguishers
            </label>
          </div>
        </div>

        {/* ── the drawing ──────────────────────────────────────────────────
            It was the last thing inside the tier card: a dashed box under a list of
            checkboxes under a price comparison, which is three unrelated jobs in one panel.
            It is a card of its own now, the same shell as every other card on the page. */}
        <div className="wz-step">
          <div className="wz-head">
            <span className="wz-title">Your drawing</span>
            <span className="wz-note">optional</span>
          </div>
          <DrawingUpload onReading={onReading} />
        </div>

        {/* store picks */}
        {picks.length > 0 && (
          <div className="wz-step">
            <div className="wz-head">
              <span className="wz-title">Your store picks</span>
              <span className="wz-note">priced from the shelf</span>
            </div>
            <div className="addons">
              {picks.map((p) => {
                const s = catalog[p.sku_code];
                return (
                  <div key={p.sku_code} className="pick-row">
                    <Link href={`/p/${p.sku_code.toLowerCase()}`} className="pick-name">
                      {s ? productTitle(s.brand, s.name) : p.sku_code}
                    </Link>
                    <div className="qty" role="group" aria-label={`Quantity of ${p.sku_code}`}>
                      <button type="button" onClick={() => setPickQty(p.sku_code, p.qty - 1)} aria-label="Decrease">
                        <IconMinus size={14} />
                      </button>
                      <span className="qty-val fig">{p.qty}</span>
                      <button type="button" onClick={() => setPickQty(p.sku_code, p.qty + 1)} aria-label="Increase">
                        <IconPlus size={14} />
                      </button>
                    </div>
                    <span className="fig pick-amt">{s?.selling_price ? inr(s.selling_price * p.qty) : '—'}</span>
                    <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Remove" onClick={() => removePick(p.sku_code)}>
                      <IconClose size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── the output ───────────────────────────────────────────────────── */}
      <section className="out" aria-live="polite" aria-label="Estimate">
        {/*
         * The house comes before the number. Someone building one house in their life does not
         * read "₹42,80,000 · 1,850 sqft built-up" and picture anything; they see a G+1 with a
         * plastered finish and know immediately whether it is what they meant. The render is
         * chosen by the same `result` that produces the total, so it cannot disagree with the
         * figure under it, and it changes the moment the storeys or the finish change.
         */}
        <HouseRender result={result} highlight={active} />
        {unconfirmed && (
          <div className="derived no-print" style={{ borderLeft: '2px solid var(--color-brand)', color: 'var(--ink-2)' }}>
            <span>
              <IconInfo size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 6, color: 'var(--color-brand)' }} />
              Drawing values not confirmed yet — this total is a preview, not an estimate.
            </span>
          </div>
        )}
        <div className="glass-card grand" style={{ borderRadius: 'var(--r-2)' }}>
          <div className="grand-total">
            <p className="grand-label">
              {unconfirmed ? 'Preview total' : 'Estimated cost'} · {TIER_LABEL[inputs.tier]}
            </p>
            {/* Keyed on the value, so React replaces the node whenever the figure changes and the
                arrival animation runs again. Switching Basic → Medium → Premium moves ₹7 lakh;
                without this the number silently swaps and the eye can miss that it moved at all. */}
            <p className="hero-figure grand-figure" key={result.grandTotal}>
              {inr(result.grandTotal)}
            </p>
            <p className="grand-sub">
              <span className="fig">{inr(Math.round(result.perSqft))}</span> per sqft · <span className="fig">{fmtSqft(result.derived.builtUpSqft)}</span> sqft
              built-up · {result.derived.floorsLabel} · {result.derived.cityName}
            </p>
            {/* The ±12% the note has always stated, drawn. See components/estimate/CostRange.tsx. */}
            <CostRange total={result.grandTotal} pct={result.accuracy.pct} />
          </div>
          {/*
           * ONE TABLE, NOT TWO HALF-CARDS.
           * The two ledgers had different anatomy — structure got a two-row breakdown, interior
           * got a sentence — and both subtotals sat left-aligned on lines of their own while
           * their parts were right-aligned underneath. So ₹26,00,577 and ₹18,34,125 shared no
           * edge, and nothing on the card could be read against anything else on it.
           *
           * Every amount is a row of one table now. Labels in the left track, money in the
           * right, tabular, subtotal and part alike — which is the whole of what "structured"
           * means for a ledger. The grid is in estimator.css.
           */}
          <dl className="grand-ledger">
            <div className="gl-row gl-row--sum">
              <dt>{LEDGER_LABEL.structure}</dt>
              <dd className="fig">{inr(result.ledgers.structure.subtotal)}</dd>
            </div>
            <div className="gl-row">
              <dt>Material</dt>
              <dd className="fig">{inr(result.ledgers.structure.material)}</dd>
            </div>
            <div className="gl-row">
              <dt>
                Labour <span className="gl-note">{Math.round(result.ledgers.structure.labourShare * 100)}% of civil</span>
              </dt>
              <dd className="fig">{inr(result.ledgers.structure.labour)}</dd>
            </div>
            <div className="gl-row gl-row--sum">
              <dt>{LEDGER_LABEL.interior}</dt>
              <dd className="fig">{inr(result.ledgers.interior.subtotal)}</dd>
              <dd className="gl-cover">
                doors, tiles, paint, fittings, bulbs{inputs.tier !== 'basic' ? ', false ceiling' : ''}, modular{picks.length ? ', your picks' : ''}
              </dd>
            </div>
          </dl>
        </div>

        <div className="glass-card donut-wrap" style={{ borderRadius: 'var(--r-2)' }}>
          <Donut groups={result.groups} total={result.grandTotal} active={active} onActive={setActive} />
          <div>
            <div className="sec-head" style={{ marginBottom: 8 }}>
              <h2 className="sec-title">Where the money goes</h2>
              <button type="button" className="sec-more" onClick={() => setAllLines((v) => !v)}>
                {allLines ? 'Collapse' : 'All line items'}
              </button>
            </div>
            <table className="legend-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th className="r">Share</th>
                  <th className="r">Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.groups.map((g, i) => {
                  const isOpen = allLines || !!open[g.key];
                  return (
                    <React.Fragment key={g.key}>
                      <tr
                        onMouseEnter={() => setActive(g.key)}
                        onMouseLeave={() => setActive(null)}
                        style={{ cursor: 'pointer', background: active === g.key ? 'var(--surf-3)' : undefined }}
                        onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
                      >
                        <td>
                          <span className="swatch" style={{ background: seriesColor(i) }} />
                          {g.label}{' '}
                          <IconChevronDown
                            size={12}
                            style={{
                              display: 'inline',
                              verticalAlign: -1,
                              marginLeft: 4,
                              color: 'var(--ink-3)',
                              transform: isOpen ? 'rotate(180deg)' : undefined,
                            }}
                          />
                        </td>
                        <td className="r fig">{Math.round(g.share * 100)}%</td>
                        <td className="r fig">{inr(g.amount)}</td>
                      </tr>
                      {isOpen &&
                        (linesByGroup.get(g.key) ?? []).map((l) => (
                          <tr key={l.key} style={{ background: 'var(--surf-3)' }}>
                            <td colSpan={2} style={{ paddingLeft: 26 }}>
                              <div>
                                {l.label}
                                {l.sku_code && (
                                  <Link href={`/p/${l.sku_code.toLowerCase()}`} className="ml-2" style={{ color: 'var(--color-brand)' }}>
                                    store <IconArrow size={11} style={{ display: 'inline', verticalAlign: -1 }} />
                                  </Link>
                                )}
                              </div>
                              <div className="legend-sub">
                                <span className="fig">{fmtQty(l.qty)}</span> {l.unit} × <span className="fig">{inr(l.rate, { decimals: true })}</span>
                                {l.rateSource === 'store' ? (
                                  <span className={`prov ml-2 ${l.priceProvenance === 'estimated' ? 'prov-typical' : ''}`}>
                                    {l.priceProvenance === 'estimated' ? 'store estimate' : 'store price'}
                                  </span>
                                ) : (
                                  <span className="prov prov-derived ml-2">seed rate</span>
                                )}
                                {l.note ? ` · ${l.note}` : ''}
                              </div>
                            </td>
                            <td className="r fig" style={{ verticalAlign: 'top' }}>
                              {inr(l.amount)}
                            </td>
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/*
       * ── FULL WIDTH, UNDER BOTH COLUMNS ────────────────────────────────────
       * A thirteen-month bar chart and a line-by-line quote comparison are wide things. Put
       * them in the 7fr column and they wrap themselves into 850px of stack, which is both
       * ugly and the reason the right column ran three times the height of the left. Below
       * the fold of the two columns they are half as tall and twice as readable, and the two
       * columns above them finally balance.
       */}
      <div className="est-wide">
        {/*
         * TIME. The phases this replaces listed the same six stages and stopped there; this puts
         * them on a calendar, says what leaves the bank in each month, and prices what changing
         * a decision costs once the work it touches has been done.
         */}
        <section className="glass-card est-sec" aria-labelledby="time-h">
          <div className="sec-head">
            <h2 id="time-h" className="sec-title">
              When the money leaves
            </h2>
            <span className="legend-sub">and what changing your mind costs</span>
          </div>
          <Time result={result} decisions={decisions} />
        </section>

        {/* TRUTH. */}
        <section className="glass-card est-sec" aria-labelledby="truth-h">
          <div className="sec-head">
            <h2 id="truth-h" className="sec-title">
              Check a quote
            </h2>
            <span className="legend-sub">against this rate card</span>
          </div>
          <Truth result={result} catalog={catalog} />
        </section>

        {result.storeLinks.length > 0 && (
          <div className="glass-card" style={{ borderRadius: 'var(--r-2)', padding: 'var(--s-5)' }}>
            <div className="sec-head" style={{ marginBottom: 8 }}>
              <h2 className="sec-title">Priced from the store</h2>
              <span className="legend-sub">one price truth</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Array.from(new Map(result.storeLinks.map((s) => [s.sku_code, s])).values()).map((s) => (
                <Link key={s.sku_code} href={`/p/${s.sku_code.toLowerCase()}`} className="chip">
                  {s.name}
                  {s.provenance === 'estimated' ? ' · est.' : ''}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button type="button" className="btn-primary h-11 px-5 text-[13px]" onClick={save} disabled={saving || unconfirmed}>
            <IconSave size={16} /> {saving ? 'Saving…' : saved ? 'Saved' : 'Save estimate'}
          </button>
          <button type="button" className="btn-ghost h-11 px-5 text-[13px] flex items-center gap-2" onClick={share}>
            <IconShare size={16} /> Share link
          </button>
          <button type="button" className="btn-ghost h-11 px-5 text-[13px] flex items-center gap-2" onClick={() => window.print()}>
            <IconPrint size={16} /> Print
          </button>
          <Link
            href="/estimate"
            className="btn-ghost h-11 px-5 text-[13px] flex items-center gap-2"
            onClick={() => {
              setSaved(null);
            }}
          >
            <IconRefresh size={16} /> Start over
          </Link>
          {saved && (
            <span className="legend-sub">
              Link:{' '}
              <span className="fig" style={{ color: 'var(--ink-1)' }}>
                /estimate?e={saved.id}
              </span>
            </span>
          )}
        </div>

        <p className="note">
          Rate card <span className="fig">v{result.version}</span> · estimate ±{Math.round((100 - result.accuracy.pct) / 4)}% · every line says whether its
          price was read from the brand or estimated for the class. Quantities are published thumb rules; store-priced lines carry the store&rsquo;s own
          provenance.
        </p>
        <details className="note no-print" open={showFlags} onToggle={(e) => setShowFlags((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: 'pointer' }}>{result.needsVerification.length} rates flagged for verification</summary>
          <ul style={{ paddingLeft: '1.2em', marginTop: 6 }}>
            {result.needsVerification.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      </div>
      {toast && (
        <div className="toast glass-strong fade-up" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
