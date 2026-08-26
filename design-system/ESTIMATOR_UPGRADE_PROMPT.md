# BO Estimator — rebuild to 100

Paste everything below the line into Claude Code, at the repo root.
Paste it only after the storefront UI upgrade has finished and been committed.

---

You are rebuilding the BO Estimator into the single best construction cost
estimator that exists in any market. Not the best in India — the best. This is
the product the company is known for. Everything else on the site is downstream
of someone using this once and telling three people about it.

Scope is the estimator and only the estimator. Do not touch the storefront, the
catalogue, the cart, or the coins page except where the estimator links into
them.

Read this entire brief before you write a line.

## Read first

```
packages/estimator/src/estimate.ts        the engine — 30KB, works, tested
packages/estimator/src/types.ts           EstimateResult, LineItem, Adjustment
packages/estimator/src/inputs.ts          the input schema + normalizeInputs
packages/estimator/rates/2026-08/         the versioned rate pack
packages/estimator/test/                  ~44KB of tests. They must stay green.
packages/llm/src/                         generate, guard, judge, cost, models
apps/web/components/estimate/             the current UI — this is what changes
design-system/north-star/Estimator.dc.html   the visual target
design-system/art/iso-house.svg           addressable isometric groups
design-system/tokens.css                  the token layer
```

## What is already right — extend it, do not rewrite it

The engine is good. `EstimateResult` already carries two ledgers, all three
tier prices, per-group and per-phase splits, `accuracy.pct`, `needsVerification[]`,
`storeLinks[]` into real SKUs, and an `Adjustment` type with
`provenance: 'ai_suggested' | 'user'`, a `source_url`, and a ±35% clamp
(`ADJUSTMENT_CLAMP`). That clamp is the reason an AI can touch this engine
safely. Drawing extraction (`DrawingExtraction`, `applyDrawing`) exists.

Rewriting any of that would trade tested accuracy for churn. Extend the engine
where this brief asks for something it cannot yet express — new line keys, new
input fields, a schedule model, a change-cost model — and add tests alongside.
Every existing test stays green. If you believe a test encodes a wrong
assumption, say so and stop; do not edit a test to make new code pass.

## What is actually broken

The UI. Not partially — structurally.

1. **It is a form, and forms are for governments.** A person building their
   first house is doing the most expensive thing they will ever do. The current
   page asks them to fill fields and press a button. Nothing happens while they
   think. Nothing responds to them.
2. **The number arrives too late and means too little.** A total in rupees is
   abstract. The engine already computes the quantities; the UI throws them away.
3. **Everything is equally loud.** Twenty inputs at one visual weight means the
   user has to decide what matters. That is the product's job, not theirs.
4. **The honesty is invisible.** `accuracy.pct`, `needsVerification[]`,
   `rateSource: 'seed' | 'store'` — the engine knows exactly how much it is
   guessing, and the UI never says. Nobody in Indian construction tells a
   customer the honest range. Doing it is the whole trust moat.
5. **The page has no theme and no motion.** It is components on a background.
   It should be an instrument.

## THE INNOVATION — three lenses on one house

This is the part nobody has built, and it is why someone will screenshot this
page and send it to their family. The same 3D house, three lenses, one toggle.
Each lens answers a question the industry has never answered on screen.

Build all three. They share the model, the camera, and the estimate — only the
representation changes, and switching between them is a continuous animated
transform, never a page swap.

### Lens 1 — MATTER: "what your money physically is"

A total in rupees is an abstraction. A lorry of sand is not.

Toggle MATTER and the house becomes a translucent ghost of itself. Every
material in `EstimateResult.lines` that has a physical quantity materialises
beside it **at true scale, on the same ground plane**: the cement bags stacked
in a real grid, the steel as a bundle of the actual bar diameters, the bricks
as a stack, the sand and aggregate as tipper-load heaps, the tile as stacked
boxes, the paint as drums.

Then, on a 4-second choreography, they disassemble into their constituent
pieces and fly into the house — bricks into walls, steel into columns, cement
dissolving into the slabs — and the ghost solidifies as they land.

Rules that make this work:

- **True scale, always. Never exaggerate for drama.** Compute volume from real
  material densities and standard Indian unit sizes: cement bag 50 kg,
  ~0.035 m³; standard brick 230 × 110 × 70 mm; TMT steel 7,850 kg/m³; river
  sand ~1,600 kg/m³ bulk. Some quantities will be startlingly large — the sand
  is several tipper loads. Some will be startlingly small — twelve tonnes of
  steel is a cube roughly 1.2 m per side. **Both directions are the point.**
  The truth is more interesting than any exaggeration, and a customer who later
  sees the real delivery must find it matches.
- Use instanced meshes. Sixty thousand bricks is one draw call, not sixty
  thousand.
- A human figure at 5' 6" stands on the plot for scale in this lens, always.
  Without a body reference the scale means nothing.
- Hovering any pile shows its line item, quantity, rate and amount. Hovering a
  line item in the table lights its pile.
- On the reduced tier, this is a 2D true-scale silhouette comparison instead of
  a 3D scene — same information, no WebGL.

### Lens 2 — TIME: "when the money leaves, and what changing your mind costs"

Two things at once, on one timeline.

**The build.** Scrub the fourteen months and the house assembles in real phase
order — footing, plinth, slabs, brickwork, services, finishing — driven by
`EstimateResult.phases`. A money bar fills beneath it per phase, so a ₹42L
house reads as ₹3L in month one rather than an impossible wall. Cash-flow
framing turns an unaffordable number into a plan.

**The regret curve — this is the genuinely new part.** For any decision the
user has made, show what changing it *later* costs. Adding a bedroom at month
two is a drawing revision. Adding it at month seven means breaking a cast slab.
Extend the engine with a change-cost model:

```
changeCost(decision, atPhase) = baseDelta
                              + rework(phasesAlreadyPassed)
                              + demolitionAndDisposal
                              + scheduleSlipCost
```

Every term comes from the rate pack — rework as a percentage of the affected
lines already billed in passed phases, demolition from a real per-m³ rate,
slip cost from the contractor's monthly overhead. Nothing is invented; if a
term has no rate, it is `needsVerification` and shown as a range, not a number.

The UI is a curve per decision: flat and cheap while the decision is still
upstream of its phase, then a hard step at the phase boundary. Hovering a
decision draws its curve. **This is the single most useful thing on the page**
— mid-build changes are the number one way Indian home budgets explode, and no
platform has ever priced the decision to change your mind.

### Lens 3 — TRUTH: "is the quote you were given fair"

The acquisition hook. Most people building a house have two or three
contractor quotes and no way to judge them.

Let the user paste, type, or photograph a quote. The existing drawing-reader
path already handles a photographed document; extend it to read a quotation
into typed line items. Then map each quoted line onto the estimate's own line
keys and show, per line, where it sits against the honest range — within,
above, below, or unmatchable.

- **Never accuse anyone.** The output is "this line is 22% above our rate for
  Hyderabad in Aug 2026" with the rate pack cited — not "your contractor is
  cheating you." A line below range is flagged too, and flagged harder, because
  underquoting is how a build stalls at month nine.
- Lines the platform cannot match are listed plainly as unmatchable rather than
  silently dropped.
- Every comparison carries the rate-pack version and city index so the user can
  argue with it, which is the point.
- The quote a user uploads is their private document. Do not persist it beyond
  the session unless they explicitly save it to their project, and say so in
  the UI.

Visually: the quote's lines fly in and dock against the estimate's lines,
matched pairs connecting with a hairline, the delta bar growing from centre.

### How the lenses relate

One control, three states, and the transition between any two is a single
continuous 900ms transform of the same scene — the camera keeps its position,
the house keeps its geometry, only the representation morphs. Never a fade to
black. Never a loading state between lenses; precompute all three off the same
`EstimateResult`.

Default lens is MATTER for a first-time visitor, TIME once they have an
estimate they have edited more than twice, TRUTH if they arrive from a "check
my quote" entry point.

## The page theme

The estimator is not a page with components on it. It is one instrument, lit
from one direction, on a drafting table at night.

- **Ground.** The canvas token colour, unbroken, edge to edge. No cards sitting
  on top of a background — panels emerge from the ground via a single specular
  hairline on the lit edge and a soft shadow on the opposite one. Never a
  lighter fill to indicate a surface.
- **One light source, and it is the sun in the 3D scene.** Whatever direction
  the scene's key light comes from — and it is placed by the plot's real
  latitude and orientation — every panel edge, every inset field, and every
  raised control on the page catches its specular on the same side. When the
  user changes the plot's orientation and the sun moves, the page's lighting
  moves with it. This is a small thing that nobody does and it makes the whole
  page feel like one object.
- **A drafting field** behind everything: the fine SVG grid at low opacity,
  parallaxing a few pixels against pointer movement and scroll. It reads as
  paper under glass. It must cost nothing — one tiling SVG, transformed, never
  re-rasterised.
- **Two accent colours, and they mean things.** Blueprint cyan is measurement,
  dimension, geometry, and certainty. Amber is money. A dimension line is never
  amber; a rupee figure is never cyan. Hold this rule absolutely and the page
  becomes readable at a glance from across a room.
- **Depth by atmosphere, not by borders.** The 3D viewport does not have a
  frame; it fades into the page through a scrim so the house appears to sit
  *in* the document. Distant geometry desaturates toward the canvas colour.
- **The vignette is real.** A soft radial darkening at the page edges keeps the
  eye at the model and the number. Subtle enough that nobody names it.
- **Dark is the default and the design.** If a light mode exists it is a
  deliberate second design, not an inversion.

## The motion system

Motion is meaning here, not decoration. Every animation answers "what just
changed, and why." Build these as one system with shared easing and duration
tokens, not as scattered transitions.

**Easing.** Three curves only. `ease-out` (0.16, 1, 0.3, 1) for anything
arriving. `ease-in-out` (0.65, 0, 0.35, 1) for anything transforming in place.
`linear` only for continuous playback. Nothing bounces. Nothing overshoots.

**Page entry — the plot.** On first load the page draws itself like a plotter:
the drafting grid fades up, then the plot outline strokes on
(`stroke-dashoffset`, 800ms), then dimension lines extend from each edge with
their figures counting up, then the house rises out of the plot floor by floor.
Total under 1.6s, skippable by any interaction, and it never replays on
navigation back to the page.

**The number.** Counts, never appears. 600ms ease-out, tabular figures, on a
container whose width is fixed so nothing reflows. On a small change it does not
re-animate from zero — it travels from the old value to the new. The delta
appears beside it (`+₹1,84,200`), rises 8px, and fades after 2s.

**Geometry response.** Every input change moves the model within 400ms. A
storey rises rather than popping. A wall slides. The roof lifts and re-lands.
Interpolate the geometry, do not rebuild it — dispose and rebuild only when
topology genuinely changes, and even then cross-fade.

**The accuracy meter.** A continuous arc that fills as questions are answered,
with a soft pulse on the segment that just moved and the next-best question
surfacing beneath it. This is the page's progress bar and its reward loop.

**Lens transitions.** 900ms, continuous, camera held. Materials in MATTER
disassemble and fly on a staggered 4s choreography with per-instance delay
seeded from position so it reads as a wave, not a burst.

**Hover linkage.** 120ms. Hovering a line item makes its geometry glow and dims
everything else to 35%. Hovering geometry raises the matching table row.
Bidirectional, always, in every lens.

**Scroll choreography.** The page has five acts (below). Each act's content
enters on a 60px rise with a 40ms stagger between its elements. The 3D
viewport is sticky through acts 1–3 and releases in act 4. Use
`IntersectionObserver`, never a scroll listener.

**Loading and empty states are designed, not spinners.** A pending estimate
draws the plot outline and dimension lines with no house. A pending render
shows the wireframe. A failed fetch shows the last good estimate greyed with a
retry, never an empty page.

**Pointer parallax.** The 3D camera drifts a maximum of 2° against pointer
position, damped, and stops entirely while the user is typing. Enough to feel
alive, never enough to be noticed.

**Optional sound, off by default.** If you build it: a soft tick on the
counter, a low settle when a slab lands, a paper rustle on lens change.
Behind an explicit toggle that persists, muted on first visit, and completely
absent from the code path when off.

**Reduced motion.** `prefers-reduced-motion` collapses every duration above to
0ms and shows final states directly. Playback becomes a scrubber with no
auto-advance. The page must be equally beautiful still — test it that way.

**Performance floor.** Every animation above runs on `transform` and `opacity`
only. Nothing animates `width`, `height`, `top`, or `left`. Anything that
cannot hold 60fps on a mid-range Android does not ship at that tier.

## The story the page tells

One narrative, top to bottom, interactive throughout.

**Act 1 — Where.** Two questions: where is the plot, how big. The house appears
on a plot of the right proportion. No number yet. Almost no effort spent and
something real has already happened.

**Act 2 — What.** Floors, rooms, tier. The house grows a storey as they add
one. The first number arrives here with `accuracy: 62%` stated plainly beside
it.

**Act 3 — How exactly.** Soil, foundation, roof, finishes, water, boundary,
site access. Every answer visibly moves accuracy up and narrows the number.
The user is not filling fields, they are buying certainty.

**Act 4 — The three lenses.** MATTER, TIME, TRUTH. This is the reveal and it is
earned, not scrollable-to from the top.

**Act 5 — Now what.** Cart from the BOQ, a construction package, the drawing
set, an EMI, a WhatsApp card.

## India 1, India 2, India 3

One estimator at three depths, auto-detected and manually switchable — never
three products, never a visibly poorer "lite" version.

**India 1** — English, high intent, ₹1 Cr+, often NRI or Hyderabad IT. Wants
control and evidence. Gets every input exposed, per-line rate editing, tier
comparison side by side, the full line table, CSV and PDF export, SKU
provenance per line, and the rate-source citations visible.

**India 2** — the core customer. Vijayawada, Guntur, Warangal. ₹25–60L,
price-first, Telugu and English both, mid-range Android. Gets the guided
five-question path, budget-versus-estimate as the primary readout, EMI against
the total, phase-wise money, and one-tap "make it fit ₹40L."

**India 3** — ₹8–18L, often self-managed with a local mestri, slow phone, slow
connection. Not today's paying customer, and that is fine: they are the largest
volume of house-building in the country and the referral engine, and serving
them costs almost nothing if the architecture is tiered from the start. Gets
three questions, one number, in Telugu, under 200KB, no WebGL, and a
WhatsApp-shareable card that renders as an image.

Detection: `deviceMemory`, `hardwareConcurrency`, `connection.effectiveType`,
WebGL2 capability, viewport, `navigator.language`. Detection sets the *default*
only. A visible one-tap control switches depth at any time and persists. Never
name the segments in the UI. **The numbers are identical at all three depths** —
only disclosure differs. A different number at a lower depth would destroy the
entire trust proposition.

Indian number system throughout — lakh and crore, `41,86,400`, never
`4,186,400`. Tabular figures so totals do not reflow while ticking.

## The inputs, rebuilt

Delete the current form.

- **Never more than three decisions visible at once.** Collapsed groups show
  the value they hold and what that value is costing.
- **Ordered by how much the answer moves the number**, computed by running the
  estimate at each input's range endpoints and sorting by spread — not
  hard-coded, so the order stays honest when rates change.
- **Every input states its consequence before it is touched.** Not "Soil type"
  but "Soil type — changes the foundation, ±₹2.4L on this house," with the
  figure computed.
- **Nothing blocks.** Every field has a defensible default from the rate pack.
  Three answers yields a real estimate with a real accuracy figure, never a
  validation error.
- **Direct manipulation where the input is spatial.** Plot dimensions drag on
  the 3D plot. Floors stack a slab. Coverage resizes a footprint and the
  setback margin turns red when crossed.
- **Budget is an input.** Two figures — construction and interiors — tracked as
  the engine's two ledgers, each with its own over/under readout, always both
  visible.

## The 3D, beyond the house

The parametric house stays as built — footprint from plot × coverage, storeys
from `floors`, roof, portico, parapet, mumty with tank, chajjas, compound wall
on the real perimeter, Indian construction DNA in geometry. Add:

- **The sun is real.** Placed by the plot's latitude, longitude and orientation
  via a solar position calculation, with a time-of-day scrubber. Shadows fall
  where they actually will. This also drives the page lighting, above.
- **The ground is the plot**, at true dimensions, with the setback margins
  drawn as translucent bands and the road on the correct side.
- **Section cut.** A plane the user can drag through the house, revealing floor
  build-up — slab, screed, tile — with each layer labelled and priced.
- **A 5'6" human figure** for scale, always present in MATTER, optional
  elsewhere.
- **Three quality tiers** by the same detection as the depth model. Full: PBR,
  soft shadows, SSAO, real sun. Reduced: flat materials, no shadows, no
  post. None: `design-system/art/iso-house.svg` animated by CSS transforms on
  its addressable `<g id="iso-*">` groups — which is why it was authored that
  way. All three express the same building; the SVG user sees *their* storeys
  and *their* portico.
- Handle WebGL context loss by falling back to the SVG path without losing
  state.

## The AI layer — bounded, and the boundary is the feature

Build on the existing `Adjustment` path with `provenance: 'ai_suggested'`, a
required `source_url`, and the ±35% clamp. Do not route around it.

The AI may: parse a brief into a reviewable input diff; read a drawing or a
contractor's quotation into typed items with per-field confidence and source
regions, low-confidence fields never silently applied; propose rate adjustments
as `Adjustment` records with citations, which the engine clamps and applies,
with the UI showing proposed, applied, clamped and ignored; explain a line from
the rate pack quoting the real quantity, rate and source; and answer in the
user's language including Telugu, with numbers rendered by the formatter.

The AI may never produce a total, rate, quantity, dimension or load. Enforce
this with types — the boundary returns a typed patch or `Adjustment[]`, making
a free-floating number unrepresentable — and add a test that a model response
containing a total does not change `grandTotal`. Stream explanation text; never
stream a number.

## Accuracy, safety, and what must not regress

- Every existing test in `packages/estimator/test/` stays green.
- Add tests for what you add: sensitivity ordering, the schedule model, the
  change-cost model, the quote matcher, the AI boundary, and identical numbers
  across all three depths.
- Every rate keeps a traceable source — rate-pack version or SKU code. Show the
  version and rate-pack month in the UI.
- An estimate is not a sanction-grade design. Say so where a user could
  reasonably confuse the two, and keep the licensed-professional framing.
- No number in the interface originates from a language model.

## Performance budget

- First estimate on a mid-range Android over 4G: under 2.5s to interactive.
- Recompute on input change: under 80ms, client-side, no network.
- 60fps on an M-class laptop; 30fps floor on a mid Android at the reduced tier.
- India 3 depth: under 200KB JS, no WebGL, no additional web fonts.
- Three.js code-split, loaded only at the full tier.
- Lighthouse ≥ 90 on the estimator route at every depth.

## Score it

Score out of 100 and write `scratch/ESTIMATOR_SCORE.md` in the same format as
`scratch/UI_SCORE.md`. Score honestly — a real 82 with a list of what the last
18 need is worth more than a claimed 100.

| Band | Points | Full marks means |
|---|---|---|
| The three lenses | 20 | MATTER at true scale with real densities; TIME with a working change-cost curve from the rate pack; TRUTH matching a real quote line-by-line with citations. All three off one `EstimateResult`, continuous transitions. |
| Accuracy & engine truth | 14 | Every number traceable. Tests green. Uncertainty surfaced. No LLM-originated figures. |
| Motion system | 13 | Shared easing tokens, plotter entry, ticking number, geometry interpolation, hover linkage both ways, scroll acts, designed loading states, reduced-motion equally beautiful, transform/opacity only. |
| 3D craft | 12 | Real sun by latitude, true plot with setbacks, section cut, human scale figure, three tiers all expressing the same building, context-loss recovery. |
| Page theme | 12 | One light source shared by scene and page, drafting field, cyan-means-measure and amber-means-money held absolutely, no cards-on-background, atmosphere not borders. |
| Input UX & psychology | 12 | Three decisions at a time, sensitivity-ordered, consequences priced, accuracy meter drives completion, nothing blocks, spatial inputs directly manipulated. |
| India 1/2/3 | 8 | Three depths, auto-detected, switchable, identical numbers, Telugu real, India 3 under 200KB. |
| AI, bounded | 6 | Brief parsing, drawing and quote reading with confidence, cited clamped adjustments, explanations. Boundary type-enforced and tested. |
| Performance | 3 | Budgets met on a real mid-range device profile. |

Under 90: keep going before you report.

## When you are done

Update `DECISIONS.md` with the consequential calls — the three-lens
architecture, the change-cost model's terms, the depth model, the Three.js tier
strategy, the AI boundary enforcement, any engine extension. Update
`PROJECT_STATE.md`. Write `scratch/ESTIMATOR_SCORE.md`.

Then tell me, in under ten lines: the score, the three weakest bands, and the
single change that would move it most.
