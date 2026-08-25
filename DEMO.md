# Walkthrough — one continuous run on localhost

Demo login: any 10-digit Indian mobile, OTP **000000**, pincode 500001 (Hyderabad). Everything below
runs without API keys (curated fixtures, on-device scene read, overlay composite); each key is named where it changes the behaviour.

## 0 · Bring it up (≈ 2 min, first time ≈ 12 min)

```bash
pnpm install
pnpm infra:up                # MySQL 8.4 · Meilisearch · Redis  →  pnpm infra:status
pnpm db:migrate && pnpm db:seed
pnpm registry:seed           # specification workbook → nine registries (509 attributes) + 37 categories
pnpm pipeline run            # 27 SKUs: fetch → extract → verify → fill → images → brochures → describe (≈ 5 min)
pnpm pipeline art:categories # one 16:9 tile per category
pnpm pipeline derive         # spec_json · key specs · facets · Meilisearch
pnpm assets:3d               # 27 placeholder GLBs at true dimensions + manifest
pnpm dev                     # http://localhost:3000
```

`pnpm pipeline report` prints the coverage table. Every SKU now fills 100 % of the attributes its category
declares, because the workbook only declares what at least one brand actually has: 27 SKUs · 1,498 values ·
fetched 631 / verified 76 / ai_filled 779 / derived 12 · brochures 15/27 · prices fetched for 14, estimated for 13.

## 1 · Front door → home (Phase 1)

1. `/welcome` — the stitched "b" mark animates, region + pincode, phone + OTP.
2. Home: thirty-seven categories in thirteen departments — the nine that stock something first with their brand and product counts, the rest grouped under their department and marked as arriving. No prices on a tile.

## 2 · The store (Phase 3)

3. Type **cemet** in the app bar → dropdown resolves to Cement SKUs, the category and the three brands in < 100 ms.
4. Type **సిమెంట్** (Telugu) → same result. Try `hikvison`, `bulp`, `fire cylinder`, `leakage`, `टाइल्स`.
5. `/c/bulbs` → filter rail is *computed* from live data: Lumens, Energy rating, Life, Shape (+ Brand / Price / Availability); struck-through values have no product behind them. Toggle a facet — counts live-update from Meilisearch, URL stays shareable.
6. `/c/cctv` — a category ingested later with **zero UI changes**: Camera type, Body shape, Resolution, Night vision, IR range… all from the registry + data rule.
7. Open `/p/bul-hav-ledplus9wb22` — gallery (swipe, dots, hover lens, click-to-lightbox on the 2048 px asset), buy panel with GST-stated price + provenance ("Fetched · havells.com · date"), Key details (8 rows), Description, Brochure viewer + Download, **Show more** (every populated calendar-sheet group in importance order), brand strip (`brands.intel`), Compare with other brands.
8. `/p/tst-lei-ts07-2-r500` — the same page for a ₹4.7 L total station: datasheets inline, 56/58 attributes.

## 3 · Cost Calculator (Phase 4)

9. `/estimate?city=vijayawada&l=30&w=40&floors=1&tier=medium` → **Vijayawada · 30 × 40 ft · G+1 · Medium = ₹33.95 L (₹1,886/sqft)**. Structure ₹25.58 L and Interior ₹8.37 L ledgered separately; labour 41 % of civil shown.
10. Tap **Basic / Premium** on the tier strip: ₹27.48 L → ₹44.19 L. The donut sweeps; the legend is the line-item table (qty × rate, seed rate vs store price, provenance badges, links into the store).
11. Tick **Solar rooftop** → panels sized from the store's Adani 575 Wp module (9 panels for 5 kW at Premium); **CCTV** and **Fire safety** price from Hikvision / Ceasefire store SKUs.
12. Drop a floor-plan image on **Upload a design** → prefilled values are highlighted *"from your drawing — tap to correct"*; the total is a *preview* until **Values are right** is tapped (mock reader without `ANTHROPIC_API_KEY`; Claude vision with it).
13. **Save estimate** → `/estimate?e=<id>` shareable link; **Print** → print stylesheet.

## 4 · AR — view in your room (Phase 5)

14. `/ar/bul-hav-ledplus9wb22` — tier routing: Android Chrome → *Open live AR* (WebXR hit-test, tap to place at 60 × 113 mm, drag, two-finger rotate); iPhone → *AR Quick Look* (USDZ exported on the phone); everything else → Photo mode.
15. Photo mode: upload a room photo → on-device scene read → pick the room type → the bulb is placed on the **ceiling** at true scale (HUD: *Scale: typical room — calibrate for accuracy*). **Calibrate scale**: tap the top and bottom of a door. Drag it; rotate 15°.
16. **Make it real** → 0.6 s overlay composite with contact shadow and light tint (labelled *mock*; with `GEMINI_API_KEY` the generative pass runs under the fidelity law and regenerates if the product drifts). Save / Share / Try another spot.
17. **The gate**: `/ar/bul-hav-ledplus9wb22?as=bathtub` → same living-room photo → *"⌖ Point at a bathroom floor against a wall to place this · A bathtub does not belong in a living room"*. Change room type to Bathroom → it places.

## 5 · Scale proof (Phase 6)

```bash
pnpm scale:seed --yes --count 400000     # synthetic SKUs (SYN-…), realistic distributions, reused imagery, Meilisearch docs
pnpm pipeline facets                     # filters recompute from 400k rows of data
pnpm --filter @buildobjects/web build && pnpm --filter @buildobjects/web start   # measure the production server
pnpm scale:test                          # PLP API · search · PDP · facet recompute · queue drain → storage/reports/scale-latest.json
pnpm --filter @buildobjects/web lighthouse
pnpm scale:seed --clear                  # back to the curated 27
```

**Measured 2026-08-23** (400,028 SKUs, production server, one Node process on a laptop alongside MySQL / Meilisearch / Redis; `storage/reports/scale-400k-conc10.json`, `scale-400k-conc4.json`, `lighthouse-latest.json`):

| Budget | conc 10 | conc 4 |
|---|---|---|
| PLP API p95 < 150 ms | **64 ms** ✓ | 30 ms ✓ |
| search p95 < 80 ms | **32 ms** ✓ | 29 ms ✓ |
| PDP render p95 < 200 ms | 233 ms ✗ (p50 134) | **68 ms** ✓ |
| filter recompute < 60 s | **42.5 s** (all 9 categories; largest 6 s) ✓ | — |
| queue drain ≥ 50 SKUs/min | **11,215 SKUs/min** ✓ | — |
| Lighthouse ≥ 95 perf / a11y (home · PLP · PDP) | **99/100 · 98/100 · 98/100** ✓ | |

The PDP miss at concurrency 10 is CPU-bound server rendering in a single process sharing the laptop; it scales horizontally (and the 60 s per-code cache makes repeat views free).

## 6 · The 28th SKU — zero-touch proof

```bash
# a new curated file is the only input: services/pipeline/data/curated/cement/CEM-AMB-KAWACH50.json
pnpm pipeline run --category cement --sku CEM-AMB-KAWACH50 && pnpm assets:3d
```

Reload `/c/cement`: the new card, its facet counts, its PDP (key details, full sheet, brand strip), its search entry and its
*View in your room* page all appear — no frontend file was touched.
