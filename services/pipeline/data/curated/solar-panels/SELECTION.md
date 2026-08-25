# Solar panels (SOL) — brand and SKU selection

Category slug `solar-panels`, code `SOL`. Registry: `services/pipeline/registry/solar-panels.json`
(60 attributes, 8 key specs, 3 card chips, 10 filters). Selected 2026-08-22.

Governing standards for the category: **IEC 61215** (design qualification), **IEC 61730**
(safety qualification), **IS 14286** (BIS registration for crystalline silicon terrestrial PV
modules) and **ALMM** listing under MNRE — the last of these decides whether a module is
eligible for PM Surya Ghar / government-supported rooftop schemes in Andhra Pradesh and
Telangana, which is the first thing a local buyer asks about.

---

## 1. Waaree — `waaree.com`

**Manufacturer confirmed.** `waaree.com` carries the Waaree Energies Ltd. corporate site
(JSON-LD `legalName: "Waaree Energies Ltd."`, `foundingDate: 1989`, founder Hitesh Doshi);
`shop.waaree.com` is Waaree's own direct-to-customer store on the same brand domain, not a
marketplace. Datasheets are served from `waaree.com/upload/media/`.

- **SKU chosen:** `SOL-WAA-BI55-545` — WAAREE **Bi-55-545**, 545 Wp, 144-cell, framed
  dual-glass Mono PERC bifacial module (AHNAY Series).
- **Product URL:** https://shop.waaree.com/waaree-545wp-144cells-framed-dual-glass-mono-perc-bifacial-solar-module/
- **Datasheet:** https://www.waaree.com/upload/media/datasheet_bi_55_520_550_12_03012025_1768193543.pdf
  (doc ref WEL/E&PD/520-550/144/MPB/HC/12/03.01.2025)
- **Why this one:** it sits in the middle of the Bi-55-520 → Bi-55-550 family that Waaree
  actually lists and prices for single-panel retail sale on its own shop (₹11,499 against an
  MRP of ₹14,907.11), which makes it the only one of the three with a manufacturer-published
  Indian price. The datasheet gives a per-model electrical table, so every STC and NOCT figure
  for exactly 545 Wp is a read value rather than an interpolation.

## 2. Adani Solar — `adanisolar.com`

**Manufacturer confirmed.** `adanisolar.com` is the site of Adani Group's solar PV
manufacturing arm at Mundra (Mundra Solar PV Ltd / MSEL); the about page describes it as
"India's 1st and largest vertically integrated solar PV manufacturer", 4 GW cell and module
capacity, 2 GW ingot and wafer capacity. Datasheets are hosted on the same host under
`/-/media/Project/AdaniSolar/Downloads/`.

- **SKU chosen:** `SOL-ADA-ASB-M10-144-575` — Adani Solar **ELAN SHINE TOPCon Gen-II
  ASB-M10-144-575**, 575 Wp, 144 half-cut n-type bifacial dual-glass module.
- **Product URL:** https://www.adanisolar.com/product-topcon-shine-series
- **Datasheet:** https://www.adanisolar.com/-/media/Project/AdaniSolar/Downloads/pdf/newdatasheet1/Shine-TOPCon-G2G-modules-Gen-II.pdf
  (doc ref MSEL/MDL/PM/Gen-II/Rev00)
- **Why this one:** 575 Wp is the top of the ASB-M10-144-550…575 ladder and the model Adani
  press-launched as its flagship n-type module; it is the best-documented entry in the
  Gen-II datasheet (full STC table, bifacial-gain table, temperature coefficients, mechanical
  data, and an explicit approvals list naming IEC 61215, IEC 61730, UL 61730, BIS, IEC 61853-1/2,
  IEC 62782, IEC 61701, IEC 60068-2-68 and IEC 62716). It is also the highest-efficiency module
  of the three at 22.3%.

## 3. Vikram Solar — `vikramsolar.com`

**Manufacturer confirmed.** `vikramsolar.com/company/` states Vikram Solar Ltd, CIN
L18100WB2005PLC106448, registered office Kolkata, MD Gyanesh Chaudhary, presence across 39
countries and 10 GW of modules shipped. Datasheets are hosted on `vikramsolar.com/wp-content/uploads/`.

- **SKU chosen:** `SOL-VIK-PARADEA-550` — Vikram Solar **PARADEA VSMDH.72.550.05**, 550 Wp,
  144 half-cut Mono PERC bifacial glass-glass module.
- **Product URL:** https://www.vikramsolar.com/pv-modules/paradea/paradea-540-565w-144-cell/
- **Datasheet:** https://www.vikramsolar.com/wp-content/uploads/2022/10/PARADEA-M10-540-565W-144-CELLS.pdf
  (doc ref VSL/ENG/SC/328-V00/STD, Paradea-144-GG-2025-V00)
- **Why this one:** the Paradea 540-565 W 144-cell page is one of only three module pages
  Vikram exposes in its own sitemap, and 550 Wp is the mid-point of that datasheet's per-model
  table. It is the only one of the three datasheets that prints its Indian standard explicitly
  (**IS 14286:2010 / IEC 61215:2005** and **IS/IEC 61730 Parts 1 & 2**), states a measured hail
  result (45 mm hailstone at up to 27 m/s, third-party lab), and gives full packaging data
  (36 modules per pallet, 720 per 40 ft HC container). A DCR-content variant is offered, which
  matters for subsidy-linked rooftop work in AP/Telangana.

---

## Notes on the three files

- **GST.** `registry/categories.json` sets `gst_rate: 5` for this category, which matches the
  post-GST-2.0 rate for renewable-energy devices under HSN 8541. The agent brief text says 12%
  (the pre-September-2025 rate). All three SKUs carry `gst_rate: 5` with
  `gst_needs_verification: true` so the pipeline flags it for a human check.
- **Prices.** Only Waaree publishes an Indian retail price on its own site, so only
  `SOL-WAA-BI55-545` has `price.provenance: "fetched"`. Adani and Vikram do not publish MRP;
  their prices are `estimated` from the ₹21/Wp band that Waaree's own listing implies, with the
  basis recorded in `price.note`.
- **ALMM.** All three manufacturers are on MNRE's ALMM List-I, but no per-model registration
  number was read on any page, so `almm_listed` is `ai_filled` (confidence 0.7) on all three and
  no registration number is recorded anywhere.
- **Pack images.** No official pallet / packaging / dimension-drawing image was found on the
  Adani or Vikram sites, so `images[4].source_url` is `null` on those two SKUs.
