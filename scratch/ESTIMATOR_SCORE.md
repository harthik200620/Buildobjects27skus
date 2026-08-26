# BO Estimator — score

Same format as `UI_SCORE.md`. Scored against the rebuild brief's own rubric, honestly, because a
real 53 with a list of what the missing 47 need is worth more than a claimed 100.

## Round 1 — 53 / 100 · the engine is done, the instrument is a third built

**What this round actually did:** it built the *truth layer* the three lenses stand on, and two of
the three lenses on top of it. It did not build the 3D, the motion system, or the input rebuild.

| Band | Score | Why |
|---|---|---|
| The three lenses | 13 / 20 | TIME and TRUTH are complete and working. MATTER carries the whole information at true scale but as SVG, with no 3D, no disassembly choreography and no house to fly into. |
| Accuracy & engine truth | 13 / 14 | 87 tests green, every number traceable, every new rate carries a basis and `needs_verification`, the AI boundary is type-enforced and tested. −1: my change-cost thumb values have not been checked against a real contractor. |
| Motion system | 6 / 13 | Shared tokens, lens transitions, bar rise, curve draw-on, reduced-motion. No plotter entry, no travelling counter, no geometry interpolation, no scroll acts wired. |
| 3D craft | 2 / 12 | Untouched. The existing SVG house still expresses the buyer's storeys; nothing else in this band exists. |
| Page theme | 7 / 12 | Drafting field, vignette, sun-driven panel speculars, cyan/amber held absolutely. The sun is a constant, not yet written by a scene, and the old `.glass-card` panels are still cards. |
| Input UX & psychology | 5 / 12 | Sensitivity ordering, priced consequences, accuracy arc, next-best question. The form itself is unchanged: still twenty inputs, no spatial manipulation, no budget input. |
| India 1/2/3 | 3 / 8 | Three depths, detected, switchable, persisted, identical numbers. No Telugu strings, no measured 200KB tier. |
| AI, bounded | 3 / 6 | The boundary is the strongest thing here and it is done. No explanation path, no photographed-quote reader, no adjustment review panel. |
| Performance | 1 / 3 | Recompute is instant and client-side. Nothing measured on a device profile; no Lighthouse run. |
| **Total** | **53 / 100** | |

### What got built, and why it is the right third

**The engine, extended and tested.** Five new pure modules, 29 new tests, 87 green in total and
every pre-existing test untouched.

- `materials.ts` — real densities and Indian trade sizes, so `EstimateResult` becomes physical
  objects. 6,300 kg of TMT is 0.802 m³, a cube 0.93 m on a side. 2,160 cft of sand is 7.2 lorry
  loads at the AP/TS 300 cft tipper. Both directions of surprise are the point.
- `schedule.ts` — the calendar, the cash flow, and **the regret curve**. This is the piece nobody
  has built and it works end to end: adding a floor to the reference house costs ₹16.73L on paper,
  ₹19.62L at the footing, ₹23.76L at the first-floor slab, ₹28.34L in finishing — with the band
  widening from ₹18.8–20.5L to ₹24.9–31.8L, because the later you decide, the less anybody can
  tell you exactly what it will cost.
- `sensitivity.ts` — the question order, computed by running the engine at each input's extremes
  rather than written down, so it cannot go stale when a rate moves.
- `quote.ts` — the matcher, including the trade words a contractor actually writes: *centering*,
  *jelly*, *rods*, *mestri*, *isuka*.
- `ai-boundary.ts` — a type in which a total is unrepresentable.

**Two of the three lenses, complete.** TIME and TRUTH are not sketches. TRUTH reads a pasted quote,
places every line against a three-tier range, cites the rate pack version and city index, flags an
under-quote harder than an over-quote and in a different colour, lists what it cannot place, and
says on the page that the document never leaves the browser.

### The four defects this round produced and fixed

Worth writing down, because three of the four were found by a gate rather than by looking.

1. **`ret` matched inside "retainer".** Substring matching on a three-letter trade word (रेत, sand)
   put a consultancy fee into the sand line. Word-boundary matching, with prefix matching only for
   words of four characters or more — which is what still lets "brickwork" find `brick`.
2. **The page painted 18 type sizes against a budget of 15.** My three components each introduced
   their own figure size and their own heading step. Collapsed onto sizes the page already paints:
   one figure size across the whole instrument, one section-heading size. Back to 15/15.
3. **The whole estimator scrolled sideways.** The drafting field is `inset: -60px` so the parallax
   has somewhere to travel, and that bleed was 60px of page overflow less the gutter — which
   measured as exactly 12px at 1440 and exactly 40px at 390. `overflow-x: clip`, not `hidden`:
   `hidden` would have made the estimator a scroll container and every sticky panel inside it would
   have stopped sticking.
4. **A grid item that could not shrink.** `.est-full` inherited its content's minimum width from a
   true-scale SVG routinely 1,500px wide. `min-width: 0`, and the stage scrolls inside its own box.

Also fixed in passing: `.tier-strip` was `repeat(3, 1fr)` and had been pushing every phone 14px
sideways for as long as it has existed.

### What the missing 47 needs, in the order it is worth doing

1. **The 3D scene (12 points, and it unlocks 6 more).** A real sun by latitude and orientation,
   the plot at true dimensions with setback bands, a section cut, the human figure, three quality
   tiers. It is also what makes the page theme's central claim true — the sun is currently a
   constant in CSS rather than a value the scene writes.
2. **MATTER in three dimensions (7 points).** Instanced meshes, the disassembly choreography, the
   ghost house solidifying. The information is already computed and tested; this is presentation.
3. **The input rebuild (7 points).** Three decisions at a time, collapsed groups showing what they
   hold, direct manipulation of the plot, budget as an input with two ledgers. The ordering and the
   priced consequences already exist and are wired — the form itself has not been rewritten.
4. **The motion system (7 points).** The plotter entry, the travelling counter, geometry
   interpolation, the scroll acts. The CSS for the acts is written; the `IntersectionObserver` that
   drives `data-in` is not.
5. **Telugu, and a measured India-3 tier (5 points).** The depth model routes to it; there are no
   strings behind it and the bundle has not been measured.

### The single change that would move it most

**Build the 3D scene and let it write `--sun-x` / `--sun-y`.** It is 12 points on its own, it is
the precondition for MATTER's 7, and it is the one thing that turns the page's central theme claim
— one light source shared by the scene and every panel edge — from a nice constant into a fact.

---

`pnpm check` green · type audit clean on nine routes · scale audit green on six routes and fifteen
widths, `/estimate` back to 15/15 type sizes · chrome audit green · zero side-scroll at 1440, 768
and 390 · sticky verified intact at 74px after the overflow fix.
