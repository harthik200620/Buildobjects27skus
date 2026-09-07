# The upgrade — what is actually wrong, and what is being done about it

Written 2026-09-08, from measurement rather than impression. Every defect below was reproduced
before it was listed; anything I could not reproduce is in "Not found" at the foot.

## The stack, honestly

The request was to "completely change the workflow and codebase to the frameworks people use in
real scalable applications". The codebase is already on them:

| Concern | In use | Verdict |
|---|---|---|
| Framework | Next.js 16 App Router, React 19 | current |
| Language | TypeScript 5.9, strict | current |
| Styling | Tailwind 4 + a token layer in `packages/ui` | current |
| Data | Drizzle ORM, Postgres + MySQL drivers | current |
| Validation | Zod 4 | current |
| Monorepo | pnpm workspaces + Turborepo | current |
| Lint/format | Biome 2 | current |
| Tests | Vitest (303) + Playwright gates (6) | current |

Replacing any of these would be churn, not an upgrade, and would put 303 passing tests and six
design gates at risk for no user-visible gain. **So the stack stays and the defects get fixed.**
Where the architecture genuinely does not scale, it is named in §5 with the actual fix.

---

## 1. The catalogue shows a product list where it should show categories

**Reproduced.** `/search` — the page the header's "Catalogue" link points at — renders all 28
products in a flat grid with a plain text sidebar. The home page correctly shows categories; the
catalogue does not.

**Fix.** `/search` with no query and no filters becomes the **category directory**: the 9 stocked
categories as full tiles with live counts, the 27 upcoming beneath them at list weight. A query,
a category or any filter still renders products exactly as today, and an explicit
"See all 27 items" link keeps the flat view one click away. Nothing is removed.

## 2. The mark is too small to read

**Reproduced.** `.header-logo` sets `--wm-size: 34px`. The mark is a thin-stroked keystoned "b" in
teal on a near-black bar; at 34 px the strokes fall below the width at which they hold.

**Fix.** Raise the lockup and give the mark enough weight to survive the bar.

## 3. Product photography — one blank hero, and no consistent treatment

**Reproduced by measurement**, not by eye. Probing all 140 card frames with `sharp().stats()`:

```
TIL-SOM-T31F119001859102   frames 1,2,3,4  stdev 0.08   ← solid colour, no image
                           frame  5        real
TIL-JOH-YK1FLCR000000PJ    frames 3,4      stdev ~0.5   ← solid colour (gallery only)
```

Frame 1 is the hero. So **Somany's Duragres tile shows an empty box** on the flooring category
page, in every search result, and at the top of its own product page. `lib/hero-image.ts` already
refuses to lead with a frame flagged `placeholder` — these are not flagged, they are simply empty,
so the rule never fires.

**Fix.** Two parts, because one alone would be a patch:
- a build-time check that fails when any hero frame is visually flat, so this cannot return;
- the storefront rule widened from "not a placeholder" to "has actual image content".

Card image treatment is also inconsistent — cut-outs on white, cut-outs on dark, and full-bleed
building photographs all sit in the same grid. One ground for all of them.

## 4. Formatting

Reproduced by measurement:
- **category tile names sat on the photographs.** Sampling the rendered grid with the words
  hidden, 8 of 36 tiles failed even the 3:1 large-text bar against their own art, worst 1.62:1 —
  and the eight were the *stocked* categories. Fixed by moving the caption below the picture:
  0 failures, 35 of 36 now at 11.16:1.
- the front door devotes 27 of 36 tiles to shelves that are empty (kept — an empty shelf a buyer
  can see is a promise; hiding it would be the dishonest fix);
- `/c/flooring` dead space measured **130 px**, not the ~600 px an early eyeball estimate
  suggested. `/search` was 260 px and is now 196 px. Nothing here was a crisis.

## 5. Security — the real gaps

| Check | State | Action |
|---|---|---|
| Session | HS256 JWT, httpOnly, edge-verified, no DB on the request path | keep |
| Route gate | `proxy.ts` allowlist, 401 for API, redirect for pages | keep |
| AI-route throttling | in-memory sliding window | keep, note the limit |
| **Response headers** | **none** — no CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors | **add** |
| **Auth throttling** | **none** on `/api/auth/otp` or `/api/auth/login` | **add** |

`/api/auth/otp` writes a database row per call with no throttle and no dedupe: 100k requests are
100k rows, and on the day real SMS is wired in it becomes an SMS-bombing endpoint. `/api/auth/login`
is likewise unthrottled and therefore brute-forceable.

## 5b. Performance — measured, and the one real defect

Lighthouse against a production build, before and after:

| | before | after |
|---|---|---|
| home | perf **74**, CLS **0.529**, LCP 1319 ms | perf **96**, CLS **0**, LCP 1252 ms |
| category | perf **75**, CLS **0.529** | perf **97**, CLS **0** |
| product | perf 95 | perf **97** |

One defect caused all of it. Every page under `(app)` sits behind a loading boundary — deliberate,
and what makes the first byte fast — and its fallback rendered **nothing**. So on a cold route
`<main>` had no height, the footer painted directly under the header at y 177, and was shoved
500 px down when the page arrived: a single layout shift of **0.529**, five times the threshold
for "poor". Nobody ever saw it, because the splash is opaque for exactly that interval. The
browser measured it, Lighthouse scored it, and Search ranks on it.

Fixed by having the fallback reserve the height a page will have (`.page-pending`).

Also found and fixed: `<meta name="description">` was streamed into the **body** on category and
product pages, so a link pasted into WhatsApp previewed with no description. `htmlLimitedBots`
now serves blocking metadata to the crawlers that cannot run JavaScript.

## 6. Scale — what "1 lakh users at once" actually needs

Honest position, since production currently runs with **no database at all** (`lib/static-catalogue.ts`
is the live catalogue):

- **Already fine:** the catalogue is static and CDN-cached; the session is stateless and verified
  at the edge with no DB round trip; media is immutable and served by the CDN; pages are ISR.
- **Does not scale horizontally today:** the rate limiter is per-process in memory, so N instances
  give N times the limit. Redis is the fix and it is a swap behind the existing interface.
- **Named, not hidden:** the OTP row-per-call above is the one write path a traffic spike touches.

---

## Not found

Things I looked for and could not reproduce, listed so they are not silently ignored:

- **"Cheap, AI-made icons."** The icon set (`components/icons.tsx`, 90 glyphs) is bespoke and
  internally consistent — 24px grid, 1.75 stroke, one accent per glyph, optical size compensation.
  What does read as AI-made is the **category artwork** — the floating shovel, the grey box for
  scaffolding, the wireframe cube for storage. That is generated imagery, and it is treated as an
  imagery problem in §3 rather than an icon problem.
- A first pass suggested the whole page below the hero had collapsed to zero height. That was a
  measurement artifact — the browser pane was hidden, so nothing was being laid out. Not a bug.

## Verification — the state at the end

Against a production build on port 3006:

| gate | result |
|---|---|
| `pnpm check` (lint · types · tests · contrast · validate) | **0 errors**, 340 tests pass (was 303) |
| `shots:strict` | **118/118** |
| `chrome:audit` · `scale:audit` · `type:audit` | pass |
| `sweep` | **nothing found** across 9 surfaces × 2 viewports (was 5 findings) |
| `contrast` | 64/64 pairs; no untokenised colour |
| `css:snapshot --check` | identical to the re-recorded baseline |
| `lighthouse` | perf ≥ 96, a11y **100** on all three surfaces |
| `images:audit --strict` | pass — no product has a blank hero with no real frame |

Two gates needed changing, and both changes are recorded in the diff with the reason:

- **`scale:audit`** — `/search` is now two pages (the directory, and the results grid at
  `?all=1`), so it has two budget entries instead of one. The directory failed the old
  results-page budget on arrival for carrying the headings a directory has.
- **The Playwright harness** — `waitForFunction` was passed a *string*, which Playwright evaluates
  with `eval`. The new CSP has no `'unsafe-eval'`, so the gate reported a defect in the page that
  was really a defect in the gate. Passing a function fixes it — and the gate now proves the store
  itself needs no eval.

A new gate was added: **`images:audit`**, which measures pixels rather than reading metadata,
because the defect it catches is invisible to everything else.
