# Cement — brand and SKU selection

Category `cement` (code `CEM`). Three brands, one flagship 50 kg bag each. Researched 2026-08-22.
Governing standards for this category: **IS 269** (OPC 33/43/53, unified 2015), **IS 1489 Part 1**
(fly-ash Portland Pozzolana Cement), **IS 455** (Portland slag cement). All three flagships are PPC
to IS 1489 (Part 1) — PPC is the mainstream retail bag across Andhra Pradesh and Telangana.

---

## UltraTech — `CEM-ULT-PPC50`

**Official Indian domain:** `ultratechcement.com` — confirmed manufacturer. UltraTech Cement Limited
is the Aditya Birla Group cement company (Grasim Industries holds 56.11%), 152.70 MTPA installed
capacity, the largest cement manufacturer in India. The site is a first-party brand site, not a
marketplace: it carries the company's own product overviews, dealer locator and investor filings.

**SKU chosen:** UltraTech Portland Pozzolana Cement (PPC), 50 kg bag
**URL:** https://www.ultratechcement.com/for-homebuilders/products/overview/ppc

**Why this is the flagship:** it is the product UltraTech lists first under its home-builder cement
range and the highest-volume retail bag in South India. It is also the best-documented of the three:
the brand page states the manufacturing route (clinker inter-ground with high-reactive-silica fly ash
and high-purity gypsum) and the application set, and a B2B listing on L&T-SuFin publishes an actual
mill-test spec sheet for it (28-day 58 MPa, 3-day 28.6 MPa, initial set 150 min, final set 225 min,
insoluble residue 22.80%, chloride 0.035%) against `IS:1489-1991`. That gives seven independently
read numeric values rather than marketing copy.

**Secondary source used:** https://lntsufin.com/product/ultratech-ppc-cement-is-1489-1991/16034-148
(L&T-SuFin B2B marketplace listing — used for the IS reference and the mill-test values).

---

## ACC — `CEM-ACC-SP50`

**Official Indian domain:** `acclimited.com` (corporate) and `acchelp.in` (ACC's own home-builder
product portal). Confirmed manufacturer: ACC Limited, founded 1 August 1936, now a subsidiary of
Ambuja Cements within the Adani Group (Adani acquired Holcim's stake in ACC and Ambuja on
15 May 2022; ~56.69% held as of 2025). `acchelp.in` is operated by ACC Limited itself — it carries
the ACC product range, the ACC dealer locator and the ACC customer helpline (1800 103 3444) — so it
is a first-party source, not a reseller. The corporate site's `/products/*` paths returned 404 during
this research; the live product pages are on `acchelp.in`.

**SKU chosen:** ACC Suraksha Power Cement, 50 kg bag (PPC)
**URL:** https://www.acchelp.in/all-products/cement/acc-suraksha-power-cement

**Why this is the flagship:** ACC Suraksha Power is ACC's mainstream retail PPC — the bag an
individual house-builder in AP/Telangana actually buys, positioned by ACC around "strength
multipliers", optimised particle size distribution and corrosion protection. It is the only ACC
cement with a full product page carrying feature detail, application list and five brand-CDN
product images.

**Secondary source used:** https://www.indiamart.com/proddetail/acc-ppc-suraksha-power-cement-10831109997.html
(read for pack size 50 kg, PP sack packaging, cement type PPC and a real listed price of ₹437/bag).

---

## Ambuja — `CEM-AMB-PLUS50`

**Official Indian domain:** `ambujacement.com` (corporate) and `ambujahelp.in` (Ambuja's own
home-builder product portal). Confirmed manufacturer: Ambuja Cements Limited, founded 1983,
Adani Group holds 63.2% since the 15 May 2022 Holcim transaction; the group's cement arm also
controls ACC, Penna, Sanghi, Orient and Jaypee Cement. `ambujahelp.in` is Ambuja's first-party
consumer site (product range, dealer locator, cost calculator), not a marketplace. The corporate
site's `/products` path returned 404 during this research.

**SKU chosen:** Ambuja Plus, 50 kg bag (PPC)
**URL:** https://www.ambujahelp.in/all-products/ambuja-plus

**Why this is the flagship:** Ambuja Plus is the brand's headline retail PPC, sold on SPE
(Special Performance Enhancer) technology and marketed specifically for roof slabs in
high-rainfall regions. Its product page is the most complete of Ambuja's range — it names the
cement type explicitly as PPC, lists four performance claims and five application areas, and
serves five checkable brand-CDN images.

---

## Notes and gaps

- **No product datasheet or brochure PDF could be verified for any of the three brands.** Every
  candidate URL (`ambujacement.com/ambujaplus/download/Ambuja-Plus-Leaflet.pdf`,
  `acchelp.in/Upload/PDF/acc-suraksha-power-dpd-product-brochures.pdf` and its `-plus-` variant,
  the `ambujahelp.in/-/media/.../Brouchers/Ambuja Plus` link) resolved to HTTP 404 or to an HTML
  error page under HEAD check. All three `documents` arrays are therefore empty rather than
  populated with dead links.
- Brand product pages publish almost no numeric specification. Compressive strengths, setting
  times, fineness, chemical limits and soundness are consequently `ai_filled` against the IS 1489
  (Part 1) requirement envelope and typical Indian PPC mill values, at confidence ≤ 0.7 — except
  for UltraTech, where the L&T-SuFin listing supplied seven real read values.
- Prices: only ACC has a `fetched` price (₹437/bag, IndiaMART listing, Uttarakhand seller).
  UltraTech and Ambuja are `estimated` at typical Hyderabad/Vijayawada dealer rates for
  August 2026 with a note.
- **GST discrepancy flagged:** `categories.json` and the research brief both specify 28% for
  HSN 2523. All three files carry `gst_rate: 28` for consistency with the contract, plus
  `gst_needs_verification: true`, because the September 2025 GST rate revision is understood to
  have moved cement to 18%. This needs a human decision before the catalogue goes live.
- No ACC logo URL resolved; `logo_url` is `null` for ACC. UltraTech and Ambuja logos verified
  HTTP 200 `image/png`.
