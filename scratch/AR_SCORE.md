# AR engine — score

**76 / 100**, up from 57. The reported faults are fixed and, for the first time, they are fixed in
a way a machine can re-check: every claim below is a number a script prints, not a thing somebody
looked at.

| Band | Max | Was | Now | Why |
|---|---:|---:|---:|---|
| Placement correctness | 26 | 18 | 23 | Every SKU, every camera pitch, every yaw: an anchor always exists and always sits inside the placement band. The band, the framing and the nudge are asserted in `packages/ar-engine/test/framing.test.ts`. Not solved: multi-plane rooms — the wall is still assumed to face the camera squarely. |
| Visibility | 10 | 6 | 9 | The contract is now testable and tested: either the product is framed, or the view says which way it went. Off-screen is an arrow and a button, not an empty feed. |
| Scale truth | 14 | 9 | 11 | `fitModelToDims` squares each mesh up with its stated dimensions instead of resizing by height alone. Auto-fit is computed from the distance the product was actually placed at, and framing runs twice so the two agree. Still no calibration flow; camera height is still assumed. |
| Platform AR | 14 | 8 | 12 | **The earlier note here was wrong**: Quick Look was never unreachable — `ArQuickLook` exports a USDZ client-side from the GLB. What it did NOT do was normalise first, so iOS got the raw mesh: the CCTV camera on its side, the extinguisher facing sideways off the wall, the epoxy tin four times too wide. It normalises now, caches the export per GLB, and takes `ar-placement` from the rule instead of hardcoding the floor. Still missing: pre-built USDZs (the 24 on disk are 6–24 MB each, 358 MB in total — unshippable without a compression pass). |
| Asset quality | 11 | 7 | 8 | `pnpm --filter @buildobjects/assets3d measure` reports what every mesh renders at, offline. Seven of twenty-one still disagree with their own stated proportions by more than a fifth — reported honestly rather than hidden. 7 SKUs are still placeholders. |
| Visual QA harness | 12 | 2 | 9 | Built. A fake camera plus synthetic `deviceorientation` drives a real phone pose in a real browser; product pixels are counted by hiding the 3D canvas and diffing. No goldens, no normals assertions, not in `pnpm check` (it needs a running server, like the other audits). |
| Haiku integration | 7 | 2 | 2 | Untouched. |
| Refusal and guidance | 3 | 3 | 3 | The nudge is the missing piece of this and it is measured at 390 px. |
| Performance | 3 | 2 | 3 | Four per-frame costs removed from the render loop, and a network call that should never have been running at all. |

## What was wrong, in the order it mattered

**A screen fraction is not a placement.** Everything was anchored by casting a ray through a fixed
fraction of the frame — `v = 0.68` for anything on the floor — and nothing bounded where that
landed. Swept across the pitches a phone is actually held at:

| | |
|---|---|
| pitch +20 and above, any floor SKU | **no anchor at all**, ever — the ray never meets the floor plane |
| pitch +10, cement bag | 25.4 m away, 21 × 31 px |
| pitch −20, bulb | 66.7 m away, 2 × 4 px |
| pitch −45, solar panel | ray nearly parallel to the plane; the "hit" projects **176 000 px** across |
| pitch −75, tile | 25 % on screen. Bathtub 26 %, glass 1 % |

The last row is the reported top-down case. It is the same defect as the first.

**Meshes drawn the wrong way round.** Resizing by height alone read one arbitrary axis as the
product's height. `CCT-CPP-USC-TA24L2C-L` was drawn 154 × 70 × 70 for a stated 70 × 70 × 163 —
lying on its side. `FIR-SAF-ABC-SP-6KG` had its width and depth swapped, so the extinguisher faced
sideways off the wall. `EPX-FOS-CONBEXTRAEP10` was four times too wide.

**A rule nothing ever read.** `orientation: 'flat'` has been in `PLACEMENT_RULES` since it was
written, on tiles, solar panels, cement and the bathtub. No renderer acted on it, so a 1200 mm floor
tile stood on its long edge and a 2278 mm solar module stood upright on a roof — worst from directly
above, which is where a phone gets pointed to look at a floor.

**The gyroscope was read and thrown away.** `useOrientation` returns a fresh object every render;
the render loop is a `useCallback` that does not depend on it, so the `active` flag it captured was
whatever it was on the first render — `false`, because no sample had arrived yet — and it stayed
false for the session. `ref` is a `useRef` and therefore stable, so samples filled it the whole
time. The live camera has been running on **a constant assumed pitch of −10°** on every device.
Nothing responded to how the phone was held: not the placement, not the horizon, and not the surface
classifier, which reads pitch to tell floor from ceiling. No amount of placement maths fixes either
reported fault while the pose is a constant.

**The loop, per frame.** `setPixelRatio` + `setSize`; a `getBoundingClientRect` forced layout; a
`setAnchor` re-deriving a transform that had not moved; a `Box3` rebuild with eight `Vector3` clones.

**A signal nobody was listening to.** The analysis scheduler raises `onLiveLost` when the vision key
is gone, and nothing had ever been wired to it — so on a deployment with no key it kept firing every
2.5 s, each call capturing and JPEG-encoding a 768 px frame **on the main thread**, for round trips
that could only return 503.

## Performance, measured rather than asserted

Same probe, same machine, `fe7172a` against now — 300 frames on `/ar/cem-ult-ppc50`, and a
35-second window with the analyser forced to 503:

| | before | after |
|---|---:|---:|
| WebGL drawing-buffer reallocations | 1200 | **0** |
| forced layouts (`getBoundingClientRect`) | 300 | **0** |
| doomed analyser round trips | 28 | **3** |
| frame rate | 7.7 fps | 7.9 fps |

**The frame rate did not move, and that is the honest headline.** This runs in headless Chromium on
SwiftShader, where rasterising a 780 × 1688 backbuffer in software dominates everything else by an
order of magnitude. The removed work is real and is now provably gone; what it is worth on a phone
with a GPU is not something this measures, and is not claimed. An earlier reading of 44.9 fps was
taken at a different point in the run and is not comparable — it is recorded here because it was
nearly reported as a six-fold speedup, and it was not one.

## Verified on production

`pnpm --filter @buildobjects/web ar:audit --base https://buildobjects27skus-web.vercel.app`, against
the deployed build rather than a dev server:

- **15 placements across three SKUs, 0 failures.** Every one either shows the product or points at
  it. Zero drawing-buffer reallocations over 150 frames on the deployed bundle.
- The cement bag lies flat on the floor at 100 % true scale, branding legible. It used to stand on
  its long edge.
- Locally, across the whole catalogue: **135 placements, 7 failures.**

### The seven, and what they actually were — found and fixed 2026-08-28

Two were the harness, five were one bug, and the bug was two measurements of "on screen" that
disagreed.

**One was a harness flake.** `gls-gua-climaguard-blue5` at +25 reported "pose did not follow" with
a stage of zero pixels — the page had not finished coming up. It passes on a re-run.

**One was correct behaviour counted as a failure.** `sol-ada-asb-m10-144-575` at +25 draws nothing
AND says "Too close to fit — tilt down for the whole solar panel". A panel that will not fit,
reported as not fitting, is the engine working.

**Five were `nudgeToward` measuring against the wrong rectangle.**

Cement, both epoxies and the tile, all at +5, all anchored within thirty pixels of the bottom of a
720-line frame — underneath the sheet — every one reporting `100 % on screen` with no nudge and
drawing nothing a person could see.

The engine was never wrong. Reproduced in Node, the solver given the chrome band returns
`coverage 0 %, nudge down`; given the full frame it returns `100 %, no nudge`. The debug string was
reporting the second because `frameNow` runs ONCE — after that the anchor stays put, by design, and
the render loop is what notices the product has left the view.

That check does use the band. But when it concluded "not visible" it then asked `nudgeToward`
which way to point, and that function measured against `map` — **the whole stage**. A product
sitting under the sheet is outside the band and inside the stage, so the answer was `null`, the
arrow was cleared, and the view said nothing at all about a product nobody could see.

The fix is that the two now measure the same rectangle. `nudgeToward` moved out of the camera
component into `packages/ar-engine/src/live/framing.ts` as `nudgeFromBounds`, next to the solver
whose placement it describes, where it takes the band explicitly and can be tested. It always
names a direction now: it is only ever called once the caller has decided the product cannot be
seen, and silence was what lost it.

**Measured after:** the four floor SKUs at +5 go from `0 px, no nudge` to a visible product and
"Cement bag is below — Bring it here". **0 rendered nothing at all**, from 5.

One remains, and it is a threshold disagreement rather than a silent failure: `epx-fos` at −15
draws 903 px — a small tin placed 6 m away, which is as close as a floor is visible in the band at
that pitch, enlarged 3.34x by auto-fit to `MIN_LEGIBLE_PX`. Something IS drawn and the view is not
lying about it. Raising that constant would enlarge every product in the catalogue past true size
more often, which is a trade against the thing this feature is for, and it should not be tuned on
one sample.

### The gap that let it live

Every assertion in `packages/ar-engine/test/framing.test.ts` ran against `fullFrame(K)`, and the
live view has never passed that — it passes the strip between the top bar and the sheet, which on a
phone is well under half the picture. So "every SKU at every pitch is either framed or nudged" was
proven only for a view the app does not use, and a placement landing neatly under the product sheet
satisfied all of it. There is a band sweep now, plus unit tests for `nudgeFromBounds`; both fail
against the old code.

`window.__arDebug` also reports the band the solver composed into and the chrome it came from, so
the next time "100 % on screen" disagrees with what is on screen it can be attributed in one run
instead of five.

## What the harness caught that the maths did not

Both of these passed every unit test and were wrong in the browser, which is the whole argument for
the harness existing:

- **All three CCTV SKUs were invisible at every angle.** A marginal wall measurement put the wall
  under a metre away, the placement pinned itself to that reading, and a camera mounted at 2.6 m on
  a wall that close is above the top of the frame at any pitch. A measured wall is a strong
  preference now, not a pin.
- **The product followed the camera.** An extinguisher measured at five pitches came back
  pixel-identical at every one, because half a second after each tilt the view quietly moved it back
  to the middle of the screen. A product that follows the camera is not in the room.

## What would move the score most now

**Pre-build the USDZs** (2 points). The client-side export is correct now but costs a
one-to-two-megabyte parse on the phone; the 24 raw ones on disk are 6–24 MB each and need the same
compression pass the GLBs got before they could ship.

**The seven meshes that disagree with their own dimensions** (up to 3 points, and it is the last
honest gap in scale truth). `measure` names them. They are a content problem, not a maths one, and
no transform can fix a mesh that is the wrong shape.

**Move the Anthropic client into `packages/llm`** (5 points). It works and is live; it is in
`apps/web/lib/chat`, so the AR analysis path cannot select it.
