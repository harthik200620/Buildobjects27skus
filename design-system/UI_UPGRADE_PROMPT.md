# Build Objects — storefront UI upgrade

Paste everything below the line into Claude Code, at the repo root.

---

You are rebuilding the visual layer of the Build Objects storefront in
`apps/web` + `packages/ui`. This is a complete restyle, not a polish pass. Read
this whole brief before touching a file.

## Preflight

Everything this brief refers to is already in the repo. Confirm it before you
start — if any of these is missing, stop and say so rather than improvising:

```
design-system/tokens.css
design-system/icons/icons.tsx
design-system/north-star/          Main Nav System Listing Product Estimator Coins
design-system/art/                 7 .webp plates + iso-house.svg + MANIFEST.md
```

## The reference

Four things in `design-system/` are the source of truth. Read all four before
you touch a file.

- **`design-system/north-star/`** — seven artboards showing the finished result:
  `Nav`, `Main` (home), `Listing`, `Product`, `Estimator`, `Coins`, `System`.
  Each exists twice: `<Name>.dc.html` is the editable source, `<Name>.html` is a
  standalone preview with the images inlined. Both render in a browser; open the
  `.html` ones, or `north-star/index.html` for the index. **Where this brief and
  an artboard disagree, the artboard wins.** Copy its exact values — do not round
  them to a 4/8px grid, and do not "improve" them.
- **`design-system/tokens.css`** — the new token layer. It replaces the
  `@theme static` block in `packages/ui/src/theme.css`. Its header comment
  explains every change and why; that reasoning is part of the spec.
- **`design-system/icons/icons.tsx`** — 93 custom icons, drop-in replacement
  for `apps/web/components/icons.tsx`. Every export name is identical.
- **`design-system/art/MANIFEST.md`** — the seven photographic backplates: which
  file belongs to which page, the scrim CSS they need, and two things that must
  be settled before any of it is customer-facing.

## What is already right, and must not change

The store scored 96/100 on its own rubric (`scratch/UI_SCORE.md`) and most of
that work stands. Do not undo it.

- **`--color-canvas: #06181D`.** The dark teal ground stays exactly as it is.
- **Audiowide as the wordmark**, and nothing else. It has no ₹ glyph.
- **Encode Sans for every figure.** Already subset to 216 KB, true ₹, correct
  tabular figures.
- **The copy.** It is honest, specific and unusually well written — "the price
  is the price", the provenance language, the GST disclosure. Restyle it, do
  not rewrite it. Where an artboard shows new copy, use the artboard's.
- **The three contrast gates** in `apps/web/scripts/`, the type audit, the font
  subsetting, the image ladder, zero emoji, zero broken links.

## Why the store currently reads cheap

So you fix the cause and not the symptoms:

1. **The type ramp is 12 → 24px.** A 2× range. Premium editorial runs 6–8×.
   When the headline and the caption are nearly the same size there is no
   drama on the page, and no amount of correctness compensates. This is the
   single biggest problem.
2. **The ink ladder is mush.** `ink-2 #b0c5c9` and `ink-3 #9bb1b5` are 8%
   apart in lightness. The page has one grey pretending to be three.
3. **The canvas is flat.** `#06181D` with nothing on it is a dark `<div>`.
4. **The icons are Lucide** — a stock pack, on millions of sites, and banned in
   as many words by the project's own brand rules.
5. **Two vocabularies.** `theme.css` speaks `--color-ink`/`--color-line`;
   `legacy.css` (31 KB) speaks `--ink`/`--accent`/`--radius-glass`, and the
   estimator, cart and several pages still use it.
6. **The header is two rows and 104px** because an Audiowide lockup and an
   860px search field cannot share one row.

## The work, in order

### 1. Fonts

Add through `next/font/google`, self-hosted, alongside the existing faces:

- **Instrument Serif** (400 + italic) → `--font-display-face`
- **Schibsted Grotesk** (variable 400–800) → `--font-ui-face`

Keep Audiowide and Encode Sans exactly as they are. Remove Arimo — nothing
should reference it when you are done. Re-run `pnpm fonts:subset` and confirm
`scripts/type-audit.mts` still passes on every route.

### 2. Tokens

Replace the `@theme static` block in `packages/ui/src/theme.css` with
`design-system/tokens.css`. Then update `apps/web/scripts/contrast.ts` to parse
the new names and add one rule it does not have: **`--ink-4` (3.6:1) is
decorative only — fail the build if it is set on any selector with a
`font-size` above 12px.**

The ambient field (`body::before` / `body::after` — bloom, warm wash, film
grain) is in the token file and is load-bearing. It is what turns the canvas
into a lit room. Do not drop it for a performance win; it is two composited
layers and ~400 bytes of inline SVG.

### 3. Icons

Replace `apps/web/components/icons.tsx` wholesale with the new file, then
`pnpm remove lucide-react`. Every export name matches, so the compiler is the
migration test: if it builds, the swap is complete. Add to the stylesheet:

```css
.ic-a { color: var(--icon-accent, currentColor); }
```

### 4. Kill `legacy.css`

Delete the `@import "./legacy.css"` and move every surviving rule onto the new
tokens, into `store.css` or the relevant `styles/*.css`. The classes still in
use are `glass-card`, `display`, `kicker`, `prov`, `facet`, `wizard`,
`hero-figure`, `derived`, `from-drawing`. Nothing may reference `--accent`,
`--rule-soft`, `--radius-glass`, `--ink`, or `--ink-2` (the unprefixed forms)
when you are done. Grep for them as the check.

### 5. The header — `Nav.dc.html`

- One row, **76px**, condensing to **62px** on scroll (height, radius 18→14,
  blur 24→40px, background alpha .82→.94, all on `--dur-3`).
- It is a **floating glass bar** inset 20px from the top edge, not flush
  chrome. `--glass` + `--glass-blur` + `--specular-strong`.
- **Logo at `--wm-size: 44px`** — a third larger than today. This is only
  possible because search moves out of the row.
- **Search becomes a ⌘K overlay.** The bar shows a 250px affordance with the
  keycaps; focus opens a full command palette with a scrim and category-scoped
  results. This is what frees the 28px and the logo size.
- **Mega menu**: full-width glass panel, three columns by construction stage
  (Structure / Finishes / Services) with live SKU counts, plus a featured
  live-priced item on the right.
- Nav links get an underline that scales in from the left on `--dur-3` with
  `--ease-glide`.

### 6. The cart rig — `Nav.dc.html`, artboard section 03

This replaces `components/cart/BoCartMark.tsx`. A porter pushing the BuildO
mark on a trolley. The sequence, on mount and on every change to the item count:

| Phase  | Duration | What moves |
|--------|----------|------------|
| drop   | 420ms    | `translateY(-150%) → 0`, opacity 0 → 1, `--ease-glide` |
| land   | 120ms    | `scaleY(.9) scaleX(1.08)` → `scale(1)` |
| push   | 720ms    | `translateX: -26% → +16% → -6% → 0` |
| settle | —        | rests |

The wheels rotate **off the same timeline** (`0 → -150deg → +110deg → -40deg →
0`) so the rig rolls rather than slides, and the porter's legs step with it.
The whole thing is off under `prefers-reduced-motion`, rendering at the settled
frame. The count badge sits top-right with a 2px ring in the bar's own colour.

### 7. Home — `Main.dc.html`

Sections in order: hero → live rate ticker → the spine (Design/Buy/Build) →
categories → on the shelf → promises → CTA band → footer. Section rhythm is
`--s-10` (128px), not the current 48px.

The hero backplate is now three layers, back to front:

1. **`art/home-hero.webp`** — the photograph, `object-fit: cover`,
   `object-position: 50% 62%`, under the two-layer scrim from `art/MANIFEST.md`.
2. **The drafting grid** at 80px, radially masked.
3. **`art/iso-house.svg`** at 30% opacity, drifting on a 26s loop.

The artboard shows a *drawn* dusk skyline in layer 1 because it was built before
the photograph existed. **Use the photograph.** Keep the drawn skyline in the
repo as the fallback for any page that has no plate yet — it is inline SVG in
`Main.dc.html` and it is good enough to ship on its own.

The rate ticker is real: pull today's prices for the six highest-volume SKUs
and marquee them with the up/down delta. It is the cheapest possible proof the
store is alive.

### 8. Listing and the product card — `Listing.dc.html`

The card carries seven decisions; the artboard's anatomy panel names all seven.
The ones that change from today:

- Media goes **4:3.3, not 1:1**, on a plate with a soft floor shadow.
- Brand becomes a **tracked micro eyebrow**, never part of the title.
- Title gets a **44px min-height** so a two-line name does not shift the price.
- A **34px teal rule draws in on hover** — one accent gesture, not five.
- **Actions take zero height at rest** and appear on hover/focus, so a 60-card
  grid stays calm.
- Certification is a badge on the media; stock is coloured text, never a badge.

### 9. Product page — `Product.dc.html`

Two columns: a **gallery stage** (tabs: Photographs / 3D model / In your room /
Zoom, product on a lit plate with a real floor reflection, thumbnails below) and
a **sticky glass buy column**. Then the specification as a **designed
two-column document** with per-row provenance chips, then a plain-language
"what this actually is" paragraph, then a full-bleed "See it in the room" band
with a pulsing reticle.

### 10. The estimator — `Estimator.dc.html`

The biggest change. Rebuild `components/estimate/Estimator.tsx` as a split
canvas: a control column on the left, and on the right a **sticky machine** —

- **The live isometric house.** `design-system/art/iso-house.svg` has
  addressable groups: `#iso-plinth`, `#iso-g0`, `#iso-g1`, `#iso-parapet`,
  `#iso-mumty`, `#iso-portico`, `#iso-wall-front`, `#iso-chajja-g`,
  `#iso-chajja-1`, `#iso-dims`. Answering a question animates the affected
  group in. Changing G → G+1 draws `#iso-g1` and lifts the parapet and mumty.
  Toggling the compound wall extrudes `#iso-wall-front`. This is not a picture
  of a house; it is the model being costed.
- **A stage scrubber** — Footing / Plinth / Slabs / Brickwork / Finishes —
  which filters the breakdown *and* highlights that stage on the house.
- **Two ledgers**, construction and interiors, each with its own gauge against
  its own entered budget, per §3.5 of the project instructions. Over-budget
  turns the gauge amber and offers "fit to my budget".
- **Floor / now / ceiling** as a single gradient range bar under the total, so
  the honest span is always visible.
- **Every figure rolls.** Odometer on `--dur-6`, never a snap.

The breakdown table keeps a provenance chip per line. The estimator must never
present an `estimated` price as a read one.

### 11. BO Coins — `Coins.dc.html`

Promote the wheel modal to a real `/coins` page, "The Vault".

- The hero coin is a **real CSS 3D object**: two faces, a `conic-gradient`
  milled rim on a `translateZ(-7px)` layer, and a travelling glint. The spin
  **dwells face-on at 0° and 180°** and transits the edge quickly — a linear
  360° loop spends half its time showing a gold sliver.
- Balance as a hero figure in amber with an odometer roll.
- **Amber is the coin's and only the coin's.** Nothing else in the store may
  use it except warnings.
- The earn ladder, the engine track (the token travels the construction
  sequence and stops at a stage), and the statement.
- The engine's outcome is decided **before** the animation starts. The
  animation shows a result; it never decides one.

### 12. Motion

Four durations and five curves in the token file. Nothing may invent a sixth.
`--ease-glide` is the premium one — long tail, things come to rest rather than
stop. Entrances use `--ease-out`, exits use `--ease-exit`; swapping them is the
most common motion bug there is. `prefers-reduced-motion` turns motion **off**,
including the ambient field and the grain — not "fast".

## Imagery

`design-system/art/` holds the plates. **Read `art/MANIFEST.md` first** — it
names every file, the page it belongs to, the exact scrim CSS, and two things
that must be settled before any of it goes customer-facing.

Seven photographic backplates are done: identified, renamed, graded to the
canvas and optimised to WebP. They are ready to use as they are.

| File | Slot |
|---|---|
| `home-hero.webp` | home, behind the headline |
| `catalogue-aisle.webp` | category and search |
| `site-materials.webp` | home, materials band |
| `construct-frame.webp` | Construct |
| `cart-yard.webp` | cart and checkout |
| `interior-warm.webp` | interiors and lifestyle |
| `pdp-stage.webp` | product detail — the gallery stage |

Every one is a backplate: full-bleed behind the opening section, under the
two-layer scrim in the manifest, copy on top. None is ever shown at full
brightness, and none is a foreground image.

`_source/` holds the ungraded originals for re-grading. **Never ship from
`_source/`.**

**Do not replace `art/iso-house.svg`, the drafting field or the BO coin with
photographs.** All three are better as vector and CSS — the iso house especially,
since it animates and is the estimator's actual model. `PROMPT_PACK.md` §1 has
the reasoning.

**Two open items, both in the manifest:** the fabricated brand packaging in
`site-materials` and `catalogue-aisle` (mitigated, not fixed), and the 35
category tiles, which are not generated yet and matter more than any single
plate.

## Constraints

- Every colour comes from a token. The contrast gate must stay green,
  including the third gate that scans `.tsx` for Tailwind colour utilities.
- Lighthouse ≥ 90 on the storefront. The new fonts are two more faces — subset
  them and check the number rather than assuming.
- The Studio editor holds 60fps for a G+2 house.
- Do not add features. This is a restyle. If you think a section is missing,
  finish the restyle and say so at the end instead of adding it.

## When you are done

Log the irreversible choices in `DECISIONS.md` — the two new faces, the token
replacement, removing `lucide-react`, and deleting `legacy.css` — each with its
one-line rationale and today's date.

Add a **Round 5** entry to `scratch/UI_SCORE.md`, scored against the same eight
dimensions and the same harsh standard as Rounds 1–4. Round 4 closed at 96/100
with four points explicitly left open, two of them photography. Say honestly
which of those this round closed and which it did not.

This repo has no `PROJECT_STATE.md` — the project convention calls for one at
the repo root. Create it: current phase, what is done, what is next. Keep it
short enough that the next session actually reads it.
