# Storefront UI — scoring log

The target is 100. Each round scores the store against the eight dimensions below, fixes what the
score says is weakest, and re-scores. A dimension only earns full marks when there is nothing left
in it that a reviewer at Google or Apple would send back.

Scoring is deliberately harsh: a dimension loses marks for anything still wrong anywhere in the
app, not just on the pages that round happened to touch.

| # | Dimension | Weight |
|---|---|---|
| 1 | Content and voice — no filler, no emoji, nothing fabricated | 15 |
| 2 | Information architecture — what each page shows, in what order | 15 |
| 3 | Composition and formatting — spacing, rhythm, type, alignment | 15 |
| 4 | Iconography and marks | 10 |
| 5 | Motion and interactivity | 15 |
| 6 | Performance | 10 |
| 7 | Accessibility and contrast | 10 |
| 8 | System discipline — one vocabulary, no bypasses | 10 |

---

## Round 1 — 74 / 100

**Done**

- Every emoji removed from every user-facing surface: 28 in the specification sheet, plus the
  coin, cart, engine, mute, gear, camera and reticle glyphs in the header, wallet, account menu,
  cart, reward engine and AR chrome. Three remain in the repository, all inside code comments
  recording what was replaced.
- Deleted a fabricated block: the specification sheet advertised a TDS, an MSDS and a "BIS & MTC
  Quality Certificate" with invented file sizes, behind Download buttons wired to `window.print()`.
- A motion system in `theme.css`: four durations, three curves, and five named behaviours
  (`reveal`, `stagger`, `lift`, `sheen`, `pulse-dot`). Nothing may invent a fifth of anything.
- `Reveal` — one IntersectionObserver for the whole app, driven by a `data-reveal` attribute so
  server components need no client boundary. Failsafe proven: content is never trapped behind an
  observer that is not running.
- The home page's empty advertisement rectangle is now `PriceBoard` — real stock, rotating, with
  a dwell ring, pause on hover and focus, and reduced-motion respected.
- The specification sheet rewritten off ~60 Tailwind arbitrary-value utilities onto a stylesheet,
  with provenance made visible rather than hover-only.
- Footer rebuilt: four columns, duplicate links removed, `/api/health` removed, delivery and
  pricing facts stated.
- Category landing pages now show the items on the shelf instead of one tile in a 4-column grid.
- Counts corrected: the landing header counted the table's snapshot while the grid drew the search
  index — it read "ON THE SHELF 3" above four cards.
- `next/image` ladder fixed: `deviceSizes` and `imageSizes` overlapped, putting two literal
  duplicates in every tile's srcset.

**Scores** — content 11, IA 11, composition 9, icons 9, motion 11, performance 7, a11y 9,
discipline 7.

**Weakest, and therefore next**

1. Composition (9/15) — `BoCart`, `Gallery`, `BuyPanel` and the estimator still carry inline
   styles and Tailwind arbitrary values with hand-picked numbers.
2. Performance (7/10) — not yet measured; `RewardEngine` may still be static in every bundle.
3. Discipline (7/10) — same root cause as composition.
4. Content and IA (11/15 each) — the search, product, estimator and AR pages have not been read
   for copy yet.

---

## Round 2 — 85 / 100

**Done**

- **Corrected a false claim the store had been making everywhere.** Six surfaces said prices had
  "GST shown separately" / were quoted "before GST is added on top". They are not: `PriceBlock`
  prints "Inclusive of 28% GST" and the selling price is the tax-paid figure. The claim predated
  this work on the trust bar and the metadata; I had propagated it into the hero, the footer, the
  welcome marks and the price board before catching it. All now say the price includes GST and the
  rate is stated.
- **Deleted three unbacked policy claims from the checkout page** — "7-Day Return Policy",
  "100% Genuine Brands", "Fast AP & TS Delivery". A returns window the store has never published
  is the worst thing on the site to invent, and a cart is the worst page to invent it on.
- `BoCart` and `Gallery` — the two densest inline-style files, 51 and 50 occurrences — rebuilt onto
  `cart.css` and `gallery.css`. Six type sizes on the cart page (17, 14, 13.5, 12.5, 12, 11.5)
  became three from the ramp.
- **Two CSS variables that are defined nowhere** (`--rule-hairline`, `--ink-1`) were being used in
  `Gallery`. An undefined custom property invalidates the whole declaration, so the 3D stage border
  and the two inactive tab borders had been rendering in the label's own ink.
- Breadcrumbs consolidated from four hand-written copies into one component, and the product page's
  trail now goes Home / Concreting / Cement / UltraTech instead of skipping the category.
- **Webfonts subset from evidence: 450 KB → 216 KB (−52%).** The faces shipped Google's full
  releases — Latin, Greek, Cyrillic, Vietnamese — to render a store written in English. A new
  `pnpm fonts:subset` derives the character set by scanning the app rather than guessing it, and
  every glyph the store needs was verified present afterwards.
- **A hole in the image ladder cost the home page most of its weight.** srcset ran 480 → 1080 with
  nothing between; a 254 px tile at devicePixelRatio 2 needs 508, so every tile loaded the 131 KB
  gallery rendition instead of the 46 KB card. Invisible at DPR 1, which is why it survived.
  Adding 800 fixed it — images 401 KB → 164 KB.
- **A broken link, traced to its root.** `/p/cem-amb-kawach50` 404'd from the home page, the
  Concreting page and search. The database holds 27 SKUs; the search index held 28. It was a stale
  index document with no product behind it — removed from the index, and the frozen snapshot now
  filters any SKU it cannot open, so the deployed store cannot advertise a page it does not have.

**Measured** — home page, production build, retina viewport, cold:
`648 KB total` (fonts 196, JS 240, images 164, HTML 25, CSS 24), down from ~1.5 MB.
90 pages crawled from the front door: **0 broken links**.

**Scores** — content 13, IA 13, composition 12, icons 10, motion 12, performance 9, a11y 9,
discipline 7.

**Weakest, and therefore next**

1. Discipline (7/10) — the estimator, the AR chrome and `FilterRail` still hold inline styles and
   arbitrary values.
2. Motion (12/15) — search, filters and the estimator have no choreography at all.
3. Content and IA (13/15) — the search page and the estimator have not been read for copy.

---

## Round 3 — 93 / 100

**Done**

- **The sort control on every listing page was invisible.** It carried `bg-white` — a Tailwind
  utility, which by this project's own layering rule beats every token in the theme — so the app's
  near-white ink sat on a white box: a measured **1.09:1**. It is now `.input input--sm` at
  **13.26:1**.
- **Closed the gap that let it through.** The contrast gate read stylesheets only, and a colour
  written as a class name in a component was outside it entirely. A third gate now scans every
  `.tsx` for Tailwind's named colour utilities and arbitrary colour values, and it was proved
  against a probe file before being trusted: it caught `bg-white`, `text-slate-500`,
  `border-[#ff0000]` and `text-red-600` and failed the build.
- **The gate's own coverage was a hardcoded list of six stylesheets** — so `cart.css`,
  `gallery.css` and `spec.css` were silently outside it the moment they were created. It walks the
  directory now. A guard whose coverage has to be remembered is a guard that shrinks.
- **A developer QA panel was shipping to customers.** A 23 px button at 25% black, "Toggle QA Test
  Panel", in the corner of a modal that opens itself for every first-time visitor — and behind it a
  FORCE ROOM row that mints BO Coins on demand. Gated to development and verified absent from the
  production bundle.
- **Seven of the thirty-five categories were named twice.** The tile said "Steel", the page it
  opened said "Steel & Reinforcement"; likewise Centering, Painting, Water Proofing, Lift
  Elevators, Communication & Furniture and Drafting & Measurement. The workbook is the authority,
  so the registry name now wins wherever a category is titled — while product rows, which are not
  in the registry, keep their own.
- Off-ramp type sizes removed: 12.5 px, 13.5 px and 10.5 px appeared nine times across the
  estimator, the filter rail and the buy panel. Every one is now a button size contract or a ramp
  class.
- Search page: "BO Store / All BO Products" and a line claiming "verified construction materials"
  — a claim the specification sheet contradicts one page later — replaced. The rail no longer shows
  the same nine category names twice in one 300 px column.
- Estimator and cart: two page titles that rendered as "… · Build Objects · Build Objects", a
  55-word marketing lede claiming rates "verified against live BO market rates" when several are
  `estimated`, "the most popular homeowner choice", and "verified dealer prices" — all corrected.
- Mobile tap targets: the price-board dots (3 px), the "All" catalogue button, the deliver-to strip
  and segmented controls all measured under 40 px on a 375 px viewport. All now clear 44 px.
- Scroll choreography extended to the product page, the cart and the search results.

**Scores** — content 14, IA 14, composition 14, icons 10, motion 13, performance 9, a11y 10,
discipline 9.

**Weakest, and therefore next**

1. Motion (13/15) — the estimator's numbers change without any transition; the AR chrome is static.
2. Performance (9/10) — 240 KB of JS is the largest remaining item.
3. Discipline (9/10) — the AR and reward-engine components still hold static inline styles among
   their dynamic ones.

---

## Round 4 — 96 / 100, and shipped

**Done**

- The last two synthesised-weight bugs, and a permanent gate for them.
  `scripts/type-audit.mts` drives a real browser over every route and fails on any computed
  (family, weight) with no font file behind it. Proved against a probe: it catches the Audiowide
  bug on 7 routes and exits non-zero.
- The estimator's grand total is keyed on its own value, so switching tier visibly moves the
  number instead of silently swapping it.
- Deployed. `dpl_BtGzXvDDAeg6dYQNxLsTBkURQR4B` READY and aliased.

**Verified on the live site**, not locally: 80 pages crawled from the front door, **0 broken
links, 0 pages containing an emoji**, 35 category tiles and 0 product cards on the home page.

**Scores** — content 15, IA 14, composition 14, icons 10, motion 14, performance 9, a11y 10,
discipline 10.

### What is still missing from 100, honestly

These are the four points, and none of them is a thing I can fix by editing code:

1. **Photography (−2, composition + IA).** All 35 category tiles use generated art, and 3 of them
   are still the weaker generations from before the Gemini quota ran out. Real product and site
   photography is what separates this from a very well-built template, and it cannot be written.
2. **The hero has no advertisement (−1).** The slot now carries live stock, which is a better
   default than an empty rectangle — but a real campaign creative would be better still.
3. **JS at 240 KB (−1, performance).** That is React plus the Next runtime plus the client
   components. Getting materially below it means removing features, not tuning.

Everything that was mine to fix, I fixed.

---

## Round 5 — 98 / 100 · the photography pass

**The block, stated first.** Regenerating category art is not slow, it is refused. Every image
model this project can address returns:

    429 RESOURCE_EXHAUSTED - "Your prepayment credits are depleted."

Verified against `gemini-3.1-flash-image-preview` and `gemini-2.5-flash-image` with a direct call,
so it is the account and not the tool. No retry schedule reaches through a billing state. Three of
the four picture problems turned out not to need generation.

**Fixed**

- **A card reading "Official image pending" was a product's face.** `CCT-DAH-HDW1200TRQP` ships
  five frames and position 1 — the hero, so the CCTV tile, every search hit and the top of its own
  page — is a drawn placeholder. Four real photographs sat behind it. `lib/hero-image.ts` now makes
  a placeholder ineligible to lead while a real frame exists, on the gallery and the card alike.
- Role order alone would have picked the **wrong camera**: this SKU is a turret, and of its five
  frames only the one labelled `detail` is one — the frame labelled `angle` is a bullet, a
  different body style, under alt text describing an eyeball. Replacing a placeholder with a
  photograph of the wrong product is worse than the placeholder, because it looks right. One
  documented override; the roles want fixing upstream in the pipeline.
- **A white rectangle among thirty-four dark photographs.** Drafting & Measurement borrowed Total
  Stations, a cut-out on pure white measuring 223 mean luminance against the set's median of 60.
  The rule preferred a product's frame over the category's own. Own art leads now — Water Proofing
  gained a roller laying membrane in place of epoxy tins.
- **Two blank tiles.** Excavation and Storage & Packaging were near-white rectangles with corner
  crop marks, the two aborted calls from the run that made the set.
  `category-art-fallback.mts` draws them in the store's own wash, grid and key light, with the
  category's Lucide mark at the height the photographs give their subjects.
- Housekeeping: 11 stale renditions pruned, thumbs derived so no tile 404s below 400 px, and the
  snapshot pointed at the new keys by hand — `export-catalogue.mts` imports the snapshot it is
  about to overwrite and bricks itself once it has deleted part of it.

**A rule that lived on one of two paths.** The lead-with-a-real-photograph fix went into the MySQL
loader. Every machine with the pipeline has MySQL; no deployment does. It verified clean locally
and production still opened on "Official image pending". Found by checking the live site, then
re-verified by running `next start` against dead database ports — the path Vercel executes.

**Verified live** — 80 pages crawled, 0 broken links, 0 emoji, 35 tiles with art, 0 using the
white cut-out, 0 product pages whose lead frame is a placeholder.

**Scores** — content 15, IA 15, composition 15, icons 10, motion 14, performance 9, a11y 10,
discipline 10.

### The last two points, and what they need

1. **Two of thirty-five tiles are drawn, not photographed (−1).** They are deliberate and in the
   palette, and they are not photographs. One command fixes it the day the Gemini account has
   credit:

       npx tsx services/pipeline/tools/category-art-gen.mts --only excavation,storage-packaging --force
       npx tsx services/pipeline/tools/category-art-thumbs.mts

   Then re-point the snapshot at the new keys. Top up at https://ai.studio/projects.

2. **JS at 240 KB (−1).** React plus the Next runtime plus the client components. Below that means
   removing features, not tuning.

Both are outside what editing this repository can reach.

## Round 6 — 96 / 100 · the north star

**The bar moved, and that is why the number went down.** Rounds 1–5 scored the store against its
own v1 design and finished at 98. This round scores it against `design-system/` — seven artboards,
a new token layer and a 93-glyph icon set — which is a harder brief than the one the store was
passing. Most of what round 5 shipped survives; what changed is what "good" was being measured
against.

### What the round actually fixed

**The type ramp was the whole problem.** 12 → 24px is a 2× range and it is the ramp of a commodity
marketplace: when the headline is nearly the size of the caption there is no drama on the page, and
no amount of correctness compensates. Measured on the rendered home page now: **92px against a 17px
lede, 5.4×**. Category and search pages went from a 24px bold over a 14px sub to a 44px serif over
13.5px — 3.3×. Instrument Serif carries it; Schibsted Grotesk replaced Arimo, which was in the
store to be neutral and succeeded. Four faces, 192 KB subset, down from 216 KB for three.

**Section rhythm went 48px → 128px** and the home page became eight moves instead of four: hero,
rate ticker, the three counters, the categories, the shelf, the promises, the invitation, footer.

**The header lost 68px and the mark gained a third.** Two rows and 104px plus a 40px category strip
became one 76px bar that condenses to 62. The arithmetic that forced the old shape — an Audiowide
lockup and an 860px search field cannot share a row — was settled by moving search into a ⌘K
palette, which gives it the viewport instead of the leftovers of a header row.

**Four surfaces stand on photographs now** — home, category, search, cart — derived at stage time
into a 640/1280/2560 ladder so a phone fetches 18 KB where it would have fetched 766.

**Three defects in the supplied design system, each caught by measuring rather than by reading:**

1. `--ink-3` at the specified `#8fa9ae` measured **4.19 on `--surf-4`** — below AA, on a token used
   for the secondary labels that sit on pressed buttons and progress tracks. Shipped at `#96afb4`.
2. Every glass surface in the store was rendering **unblurred**. Lightning CSS keeps both
   `backdrop-filter` and `-webkit-backdrop-filter` when the value is a literal and drops the
   standard one when it is a `var()` — so the tokenised way of writing it emitted only a prefixed
   alias this engine does not implement. Nothing hand-writes the prefix now.
3. The icon set was advertised as a drop-in replacement and was **missing four exports** that eight
   call sites use to render a mark from a database string. It would have compiled everywhere except
   the eight places it mattered.

**And one in the artwork.** `MANIFEST.md` flags two plates as carrying fabricated UltraTech, ACC and
Kajaria trade dress and calls its own fix "a mitigation, not a fix". Checked at native resolution:
`site-materials` is clean; `catalogue-aisle` was not — the mid-ground stacks read "… Cement" down
the pile, and that plate was about to become the backplate on all 35 category pages and on search.
Cropped to its upper 46%, which loses nothing and is the better plate anyway at 3.90:1.

### Verified, not assumed

    103 pages crawled  ·  0 broken links  ·  0 emoji  ·  47 carrying a plate
    lint · typecheck · tests · contrast (64 pairs) · type audit — all green
    production build: 30 routes, no warnings
    mobile 375px: 0px horizontal overflow, header fits, grids reflow to 2 / 1

**The type audit was reported clean once before it was.** It runs against `localhost:3001` — the
production server — and that server was serving a build made before the font swap, so it was
checking Arimo's four static cuts and passing. Run against the real build it reported twenty-seven
synthesised weights, all of them false: it read `document.fonts`, parsed each face's weight with
`parseInt`, and the UI face is one variable file declared `400 800`, which parses to 400. Every
500, 600 and 700 in the store looked synthesised.

The gate understands ranges now — a weight matches if it falls inside any range its family
declares, and a static cut is the degenerate case where min equals max. Proved by probe before
being trusted: `font-weight: 700` on Instrument Serif (one cut, 400) and `900` on Schibsted
(400–800) were both caught, and both disappeared when the probe was removed. A gate that cries
wolf gets switched off, which is worse than not having one.

The CTA-collapse states were verified by driving the grid directly, because this browser pane has
`document.hasFocus() === false` and cannot produce hover or focus styling: **0px at rest, 84px
open**. That is a limitation of the harness, and it is why the two states were measured separately
rather than by hovering.

### Scores

content 15 · IA 15 · composition 15 · icons 10 · motion 14 · performance 8 · a11y 10 · discipline 9

### The four points, and what each one is

**1. Images on a Retina desktop (−2).** Honest numbers, production build, cold:

    1440px, dpr 1   images  391 KB      ← the common case
    1440px, dpr 2   images 1560 KB      ← a Retina laptop
     390px, dpr 2   images  388 KB
    js 227 KB gzipped · css 28 KB · fonts 172 KB · document 24 KB

The DPR-2 desktop figure is the honest headline and it is 35 photographic tiles taking the 800px
rendition. There is no clever fix available in this repository: the tile is 318 × 337 and crops
16:9 art with `object-fit: cover`, so it needs about 1,200 device pixels and is *already*
under-fetching at 800. Dropping a rung makes them softer; adding one makes the page heavier. The
real fix is a **portrait category rendition** cut by the pipeline to the tile's own aspect, which
is a pipeline run and not a stylesheet change.

**2. The estimator is restyled, not rebuilt (−1).** §10 of the brief asks for a stage scrubber that
filters the breakdown and highlights the matching part of the house, two ledgers each gauged
against its own entered budget with a "fit to my budget" action, and the addressable `iso-house.svg`
animating group by group as questions are answered. What shipped is the total as an 80px display
figure, the ±12% the model has always published drawn as a range bar, and the grand panel pinned.
The rest is feature work, and the brief's own constraint is "do not add features. This is a
restyle."

**3. BO Coins has no page (−1).** §11 asks for `/coins`, "The Vault" — the coin as a hero object,
the earn ladder, the engine track, the statement. What shipped is the coin itself: a real CSS 3D
object with two faces, a milled conic rim on a `translateZ(-7px)` layer and a glint on the turn,
spinning on a curve that **dwells face-on** at 0° and 180° instead of rotating linearly. It lives
in the wallet. The page is a new route, which is the same "do not add features" call as above.

One smaller thing, inside the scores above rather than beside them: the home hero has the
photograph and the drafting grid but not the third layer — `iso-house.svg` drifting at 30% behind
them.

The catalogue menu did make it. It was a 340px solid popover with a 10px radius hanging off an
18px glass bar — one control drawn by two hands — and it is now 760px of the bar's own glass at the
bar's own radius, in two columns. Not §5's three columns by construction stage with a featured
live-priced item, which needs the component rewritten; the same markup on the same tokens, which is
what a restyle is.

### Three plates are unused, and one of them permanently

`construct-frame.webp` and `interior-warm.webp` have no page to live on — there is no Construct
route and no interiors route, and adding one is a feature.

`pdp-stage.webp` cannot be used at all, and this is measured rather than assumed: it is an empty
lit plinth meant to have the product standing on it, and **0 of 28 SKUs have an alpha cut-out**
(`cutout_key` is null on every row). Every product photograph in this catalogue is shot on white,
so mounting one on a dark plinth shows a white rectangle floating on a photograph. The product page
uses a lit CSS mount instead — `--plate-stage`, brightest at 50% 34%, which is where the key light
falls in every photograph the pipeline commissions, with a floor shadow under the object.

## Round 7 — the front door, subtracted

Not a rescore. One instruction, acted on: *show only the categories, nothing after them, no prices
on the home page, and make the cart cleaner.*

### What came off the front door

Eight product cards, four promise columns, a closing call-to-action band, a rate ticker and a
rotating stock panel. The page is a hero, the three counters a project passes through, and
thirty-five categories — and then it stops.

**It stops on purpose.** A front door is a place you pass through. A page that keeps talking after
it has shown you the doors does not trust them, and every one of those five sections was the store
explaining itself to somebody who had already been given the thirty-five things they came for. The
promises were already on the product pages, where they answer a question somebody is actually
asking. The shelf is search, one click away and better presented there.

**And no prices, anywhere on it.** Not on a tile, not in the hero, not in a strip. "from ₹410"
under a category commits the store to a number before the visitor has chosen anything and answers
a question nobody asks at that level. Verified rather than asserted: **zero ₹ characters in the
rendered page.** `fromPrice` is gone from `CategoryGroup` and `minPrice()` is deleted, so there is
no path by which one comes back.

    home page   5 sections → 3      images 391 KB → 302 KB      document 175 KB → 112 KB
                364 lines of CSS deleted with the sections they styled

### The cart

**The trolley carries the mark and nothing else.** A pushing figure had been drawn beside it, and
at 28px it was four strokes of grey attached to the logo — the busiest element in the chrome, on
the second-most-used control in the store.

**And it rolls in.** It used to drop from above, squash, then get shoved left and right before
settling: four movements in 1260ms in a 28px box. Each was defensible and together they were
fidgeting. A trolley is a thing you push, so it arrives from the side, once, decelerating — and the
wheels turn **742°**, which is the distance divided by the circumference and not a round number,
because the arithmetic does not produce one. That is the whole difference between rolling and
sliding, and the eye reads the mismatch long before it can say what is wrong.

**The cart lines have the product in them.** It was a list of names, quantities and figures, which
is a receipt. Each line now carries the same picture the product page shows, on the same silver
plate a card, a search row and the gallery mount it on — through `next/image`, so a 72px slot gets
the 240px thumb rather than the 480px card it would have taken from a bare `src`.

### The sprawl, counted and gated

"It looks cheap" is the hardest complaint to act on because nobody points at a radius. Measured on
the rendered home page: **seven distinct corner radii and seventeen distinct type sizes**, against
a scale offering six and eleven. The strays were 5px and 9px corners and 10.5, 12.5 and 13.5px
type — none of them a token, every one of them a single increment from one.

`--t-cap` (13) and `--t-fine` (12) are real tokens now, because fifty-odd declarations across nine
stylesheets were already using those sizes without naming them. `--t-meta` was 13.5 — half a pixel
from 13, which is the same mush the ink ladder was retuned to remove — and is the same size now
with its own looser line height. `--r-3` was 14, which nothing used: every card in the store
hardcoded 16 and the token disagreed with all of them.

132 declarations snapped to the scale. **Home: 7 radii and 17 sizes → 5 and 14.**

`scripts/scale-audit.mts` is new and holds it. It counts distinct radii and type sizes on the real
DOM of six routes and fails over budget, and the budgets are what each page measures today plus
one — plus one and no more, because a budget with slack in it is a note rather than a gate.

    ✓ /                  5/6 radii   14/15 sizes
    ✓ /search            6/7          10/11
    ✓ /c/bulbs           6/7          11/12
    ✓ /p/cem-ult-ppc50   7/8          13/14
    ✓ /cart              6/7          10/11
    ✓ /estimate          6/7          14/15

`pnpm check` green · type audit clean on nine routes · 103 pages crawled, 0 broken links, 0 emoji.

## Round 8 — the bar was broken on a 1440 laptop, and nothing was watching

Reported from a screenshot, not from a gate: "See in room" running through the search field's
magnifier, "BO Cart" wrapped onto two lines under its trolley, and the deliver-to strip tucked
under the bar's bottom edge. Three separate faults in the three centimetres a visitor looks at
first.

### Why it happened, and why nothing caught it

**The bar needed 1559px of viewport.** Below that `.header-nav` was the only thing allowed to
shrink, so it was squeezed narrower than its own labels. A flex item narrower than its content
does not wrap and does not clip — it OVERFLOWS, onto whatever is beside it. Everything the store
measured read one viewport width, and 1440 was not it.

**`.header-action` had no rule at all.** It was lost when the two-row header was rewritten, so the
cart and account buttons fell back to `display: block` and their glyph and label became inline
content that wrapped wherever the box ran out — which is why "BO Cart" broke onto two lines and
the account sat nine pixels higher than the cart beside it.

**The floating bar's 20px inset was a sticky `top` and nothing else.** `top` reserves no space in
the flow, so the bar painted from 20 to 96 while the next element in the document started at 76.
The deliver strip was rendering eight pixels underneath it. It is a `margin-top` now.

### "See in room" is a product's link, and it is only on products now

It needs a SKU to stand in the room, and the chrome has no SKU — so the nav link, the footer link
and the catalogue-menu link all pointed at one hardcoded cement bag. Offering to show a visitor
"your room" and landing them on somebody else's cement is a demo wired into the masthead. All
three are gone and `AR_DEMO_HREF` with them; every remaining entry point is `/ar/${sku}` on a
card, a gallery, a buy panel or the product page's own band.

### The ladder, and the gate that now holds it

Nothing in the bar shrinks any more — every child is `flex: none` and the spacer takes the slack,
so the row either fits or a breakpoint changes what is in it:

    < 1500  the lockup steps to 34px and the coin pill drops the word "Coins"
    < 1400  the cart and account drop their labels — this is where 1366 lives
    < 1200  the nav keeps its glyphs and drops its words, the cue narrows
    <  900  the mark loses its name: the lockup is 284px, 42% of a 768px row
    <  430  gaps and padding tighten; it is all that is left to give

**The first version of the gate would not have caught the bug it was written for.** Comparing the
bar's children's boxes finds nothing when a box SHRINKS: the nav's box sat politely beside the
search cue and only its text spilled. Proved by probe — with the shrink restored the gate reported
a clean tick at 1440 while the bar was visibly broken. It measures `scrollWidth > clientWidth` on
every element in the bar as well now, which is the direct question, and with the probe in place it
names the fault at eleven widths including 1440.

    1920 164px   1680 164   1600 108   1512  20   1440  69
    1366 189px   1280 103   1180 266   1024 123    900  71
     768 199px    600 193    430  31    390  33    360   3

`pnpm check` green · type audit clean on nine routes · scale audit green on six routes and
fifteen widths.

## Round 9 — the bar comes down flush, and gets out of the way

Reported: *"The navigation bar should be on top and complete screen should be taken by the nav
bar and when I scroll down it should vanish and it should come back when I come up. The estimated
cost card is moving when I am scrolling down."*

### The bar was an instrument hovering over the page

It was capped at 1560px, an 18px radius, inset 20px from the top and from each side. That is a
control panel laid ON the storefront, and it cost real room: **the gutter was paid twice**, once
outside the bar and once inside it, so at 1512px the row had 20px of slack for six controls and at
360px it had three.

Flush, the bar's padding IS the page's gutter, and the mark stands exactly above the first
character of the page beneath it — the breadcrumb, the deliver-to line and the page plate all
start on the same vertical. Slack, before and after:

    1512   20px → 78px      1440   ~0 → 127px      1366  247px      360   3px → 45px

Every route also dropped a radius from its shape budget, because the one 18px corner in the store
was this bar's.

### It leaves on the way down

A reader going down a spec sheet is reading; the bar is 76px of screen they are not reading with.
It leaves on the way down and it is back on the first notch up, which is when a person wants it —
they are going back for something.

`translate3d`, not `top`: on a sticky element `top` IS the sticky offset, so animating it fights
the scroll rather than riding it. The at-rest state is `transform: none` on purpose (see below).
It is the same single rAF-coalesced listener that already wrote `data-scrolled`, so no new work
happens per frame and React never renders on scroll.

Three things hold it still when it should be still: a **240px floor** (chrome that flinches at the
first flick of the wheel reads as broken), an **8px-down / 4px-up deadband** (a trackpad emits
sub-pixel deltas in both directions during one flick, and momentum rubber-bands at the end of
every gesture — without a deadband this is the jitteriest thing on a page), and a hold while any
scroll lock is on, so a bar cannot disappear because a modal opened and be missing when it closes.
`focusin` inside the header brings it back, or a keyboard reader pressing Shift+Tab lands focus on
a control drawn off the top of the screen.

Under `prefers-reduced-motion` it does not leave at all. Reduced motion does not mean the same
slide, faster.

### The cost card had three faults, all of which read as "it moves"

Measured on `/estimate` at 1440×820 before touching it: pinned at `top: 112px`, held — and then at
`y: 2400` its top read **19px**. It releases at the end of its column, which is correct and
unavoidable, and slid straight up *through the 82%-opaque floating bar*.

1. **112px against a 62px bar.** Fifty pixels of nothing between the chrome and the answer. There
   were four of these offsets — filter rail 92, buy column 112, cart total 92, estimator total 88
   — so four panels that are all "just under the bar" stopped at four different heights, and
   moving between two pages moved the line they hang from. `--sticky-top` is one token, measured
   off the CONDENSED bar because nothing is pinned until the page has scrolled, and deliberately
   constant: a sticky `top` that changes with scroll state makes the panel itself move, which is
   the complaint.
2. **No elevation at all.** An opaque panel with no shadow on a page its own colour: two thousand
   pixels of breakdown slid underneath with nothing to say they were going under. Figures
   vanished at a hairline.
3. **The release went behind glass.** With the bar flush and gone-on-the-way-down, the release is
   into clear space at the top of the screen, which is what a release should look like.

It now pins for **1650px of scroll** and only pins where it FITS — below 620px of viewport height
it scrolls with the page, because pinning a panel whose bottom half can never be reached is worse
than not pinning it.

### Two shipped bugs found by measuring rather than looking

**The ⌘K palette did not cover the screen.** It is `position: fixed; inset: 0` and it lived inside
the header — and a `backdrop-filter` makes an element a containing block for fixed descendants
exactly the way a `transform` does. Measured at 1024×680: the overlay laid out at **1009×143** and
its scrim at **1009×61**. The panel overflowed its box and drew in roughly the right place, so it
looked correct; pressing the dimmed page below it did nothing, because there was no scrim down
there to press. The catalogue menu was laid out against the same wrong box. Both are portalled to
`<body>` now — which also unclamps them: `.header` is `z-index: 40` and therefore a stacking
context, so the palette's 90 and the menu's 70 were both pinned to 40, under the filter sheet's 60.

**The deliver-to strip paid the gutter twice** — its own `padding: 0 var(--gutter)` plus the
`.shell` inside it, which is the element that carries the gutter. "Deliver to Hyderabad 500001"
started at 96px on a page whose every other element starts at 48.

### The gate, and the five probes it was made to fail

`scripts/chrome-audit.mts` drives a **real wheel** — `scrollTo()` produces one clean jump that any
implementation survives — and checks the four things that only exist in motion. Its first version
measured `.header`'s own box, which is block-level and therefore full width whatever the design is
doing; it would have passed the floating bar. It finds whichever element actually PAINTS the fill
and measures that.

Every check was proved by restoring its defect:

    the bar floats again          → 9 widths, naming "fill 48→1392 of 1440 at y 20, radius 18"
    the away transform removed    → "leaves on the way down   top 0 of 62"
    one panel back at header + 16 → "/cart   OFF: cart-side at 92"
    the palette un-portalled      → "palette 1024×143   scrim 1024×75   screen 1024×680"
    the cost card unpinned        → "0px of scroll   fits false   elevated false"

That last probe also caught a check that could not fail: `/cart` reported "0 pinned panel(s)"
because the audit's cart was empty. A route with nothing pinned on it is not a pass, it is a check
that did not run — it seeds the cart and fails on zero now.

**And the numbers missed one thing the screenshot caught.** `align-self: start` is the reflex for
a sticky item; `.out` is a flex COLUMN, so align-self runs across the row — it did not prevent a
vertical stretch that never happens, it shrank the card to 466px inside a 764px column, narrower
than the table directly beneath it. Every measurement in the gate still passed. The gate compares
the card's width to its column now.

`pnpm check` green · type audit clean on nine routes · scale audit green on six routes and fifteen
widths · chrome audit green on nine widths, four routes and both overlays.
