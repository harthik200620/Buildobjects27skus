# Where this project is

Short on purpose. If it grows past two screens it has stopped being read.

Last updated **26 Aug 2026**, after the north-star UI rebuild and the front-door subtraction.

## What this is

An e-commerce storefront for construction materials in Andhra Pradesh and Telangana. Thirty-five
categories from `WHOLE_PRODUCT_LIST_BO_PRODUCT_CALENDAR.xlsx` — the workbook is the authority, one
sheet per category — of which nine are stocked, holding 27 SKUs. Every price is the tax-paid price
per unit with its GST rate stated, every specification row says where its value came from, every
product can be stood in your own room at true size, and an estimator costs a whole house.

## Current phase

**Shipping the v2 visual layer.** The catalogue, the pipeline, the estimator and AR are built and
working; this phase is the storefront's surface, and it is now on the `design-system/` north star.

## Done

- **Catalogue** — 27 SKUs across 9 live categories, ingested from brand sites with recorded
  provenance per value. `services/pipeline`.
- **Search** — Meilisearch when it answers, a frozen JSON snapshot otherwise. The snapshot is what
  production actually runs on: Vercel has no database and no Meili.
- **Estimator** — `packages/estimator`, pure and versioned, 24 unit tests pinning the reference
  case. Publishes a ±12% accuracy band the UI now draws.
- **AR** — one engine, three tiers by capability: WebXR hit-test → iOS Quick Look → Photo Mode.
- **3D** — a GLB per SKU; real models drop in by filename.
- **The v2 visual layer** — four type faces, a new token layer, 93 custom icons, a one-row header
  with a ⌘K palette, photographic backplates on four surfaces. See `DECISIONS.md` for the
  irreversible choices and `scratch/UI_SCORE.md` Round 6 for what is and is not finished.
- **The front door is categories and nothing else** — no shelf, no promises, no closing band, and
  no prices anywhere on it. Round 7.

## Next, in order

1. **A portrait category rendition.** The home page's 35 tiles crop 16:9 art into a 1:1.06 box, so
   on a Retina desktop they cost 1.5 MB. A rendition cut to the tile's own aspect fixes both the
   weight and the softness. Pipeline work, not stylesheet work.
2. **The estimator's machine** — the stage scrubber, the two gauged ledgers, and `iso-house.svg`
   animating group by group. §10 of `design-system/UI_UPGRADE_PROMPT.md`.
3. **`/coins`** — the Vault page. The 3D coin exists; the page does not. §11 of the same brief.
4. **Two category tiles are drawn, not photographed** — `excavation` and `storage-packaging`.
   Blocked on Gemini credit; the two commands that fix it are in `scratch/UI_SCORE.md` Round 5.

## Things that will bite you

- **`export-catalogue.mts` cannot be re-run.** It imports the snapshot it is about to overwrite, so
  it bricks itself part-way through and takes the catalogue with it. Restore from git and patch the
  JSON by hand until its import ordering is fixed.
- **Two data paths, and every dev machine only exercises one.** Loaders try MySQL and fall back to
  the snapshot. Every machine with the pipeline has MySQL; no deployment does. A rule added to the
  live path only will verify clean locally and be absent in production — this has happened once.
  Test with `next start` against dead database ports.
- **Turbopack's dev server does not reliably recompile imported CSS.** A stylesheet edit can appear
  to have no effect for several minutes. `rm -rf apps/web/.next` and restart before concluding a
  rule does not work; three separate "bugs" this round were stale CSS.
- **Never hand-write `-webkit-backdrop-filter`.** Lightning CSS drops the standard property when
  both are present and the value is a `var()`. Write the standard one and let the toolchain prefix.
- **Nothing in the header bar may shrink.** Every child is `flex: none`; the spacer takes the
  slack and breakpoints change what is in the row. A flex item narrower than its content does not
  wrap or clip — it overflows onto its neighbour, which is how "See in room" ended up running
  through the search field on every 1440px laptop.
- **The Render API key in `.env` was pasted in plaintext and should be rotated.**

## The gates

`pnpm check` runs lint, typecheck, tests, the contrast gate and the pipeline validator. Two more
are worth running by hand after any visual change:

    pnpm --filter @buildobjects/web type:audit     # no synthesised font weights on any route
    pnpm --filter @buildobjects/web scale:audit    # radius / type-size budgets, and the header
                                                   # bar checked at 15 real viewport widths
    pnpm --filter @buildobjects/web build          # the production build is the only honest one

Both audits drive a real browser against `localhost:3001`, which means they check whatever that
server last built. Run `build` first or they will cheerfully pass against a stale one — that is
how the type audit was reported clean before it was.

The contrast gate is four gates in one file: every colour pair measured, `--ink-4` rejected on
anything above 12px, no untokenised colour in any stylesheet, and no Tailwind colour utility in any
component. Each one exists because of a specific bug that shipped.
