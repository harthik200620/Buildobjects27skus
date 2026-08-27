# BO AR engine — fix the placement, then take it to 100

Paste everything below the line into Claude Code, at the repo root.

---

You are fixing and then rebuilding the Build Objects AR engine. Products are
currently rendering on the wrong surfaces — a CCTV camera lies flat on a carpet
instead of mounting high on a wall, a bulb does not go on the wall or ceiling,
epoxy flooring does not lay on the ground. Every one of the 27 live SKUs must
place correctly, at correct scale, on the correct surface, from any camera
angle.

Do not start writing code until you have finished the audit in the first
section. Two things in this brief are findings from a prior investigation, and
you should confirm both before relying on them.

## Phase 0 — audit before you touch anything

Read and map the whole path end to end, then write what you found to
`scratch/AR_AUDIT.md` before making a change:

```
packages/ar-engine/src/types.ts          Surface, PlacementRule, SceneAnalysis, GateResult
packages/ar-engine/src/surface-guide.ts  matchSurface, dropPointFor, autoFitScale
packages/ar-engine/src/gate.ts           the allow/refuse decision
packages/ar-engine/src/placement.ts      where the product lands
packages/ar-engine/src/scale.ts          mm-per-pixel from reference objects
packages/ar-engine/src/analyze.ts        scene analysis entry point
packages/ar-engine/src/fidelity.ts       mesh-matches-its-photo check
packages/ar-engine/src/tier.ts           device capability tiers
packages/ar-engine/src/vision/           surfaces, depth, pitch, frame
packages/ar-engine/src/live/             plane, pose, lk, tracking, anchor, fit,
                                         smoothing, hysteresis, camera-math, budget
packages/assets3d/src/photoreal/         meshy, tripo, run, normalise, providers,
                                         select-images, jobs
packages/llm/src/                        client, models, generate, guard
apps/web/                                every component that mounts the AR view
.env.example                             BO_CHAT_*, GEMINI_*, MESHY_API_KEY, TRIPO_API_KEY
```

Answer these in the audit, with file and line references:

1. **Where does a `PlacementRule` actually come from at runtime?** Trace it from
   the AR view back to its source. A prior investigation found the type declared
   and consumed but **never populated anywhere in the repo** — grep for
   `wall_flush`, `resurfaces`, `replaces_pane` and see whether the only hit is
   `types.ts`. If that is right, this single gap is the root cause of every
   wrong-surface bug, and no amount of vision work fixes it. Confirm or refute
   it explicitly.
2. **What does the engine fall back to when no rule matches a category?** Name
   the default surface, orientation and anchor. That default is what is putting
   a CCTV camera on a carpet.
3. **Which of the 27 live SKUs currently have a correct surface, and which do
   not?** Enumerate all 27 from the catalogue by SKU code and category. This
   list is the work-list for everything below.
4. **Is `BO_CHAT_API_KEY` referenced by any TypeScript in the repo?** A prior
   investigation found it declared in `.env.example` with
   `BO_CHAT_MODEL=claude-haiku-4-5-20251001` and `BO_CHAT_BASE_URL=https://api.anthropic.com/v1`,
   and used by no code at all, with no Anthropic client anywhere —
   `packages/llm` being `@google/genai` only. Confirm or refute.
5. **Does the live path use WebXR, or the hand-rolled CV stack in `live/`?**
   Report which, and on which devices each runs today.
6. **Why does the bulb SKU render nothing at all?** Reproduce it, then name
   which of the six causes in Workstream 1b it is, with the file and line.
   Do not fix it in the audit — just identify it.

Report those five answers before proceeding. If any finding contradicts this
brief, follow what the code actually says and tell me.

## The capability boundary — build to what is real

Two constraints are physics and platform, not effort. Design to them rather
than trying to out-engineer them.

**Monocular depth is scale-ambiguous.** A single RGB frame cannot yield
absolute metric scale without a reference of known size. No model fixes this.
Amazon's AR View looks flawless because it rides ARKit and ARCore, which have
an IMU and motion parallax — not because its computer vision is better. Any
path that lacks those needs either a known reference object in frame or an
explicit user calibration, and must say so rather than guessing.

**iOS Safari has no WebXR `immersive-ar` and no hit-test, as of 2026.** Verify
this yourself before building on it. It means the browser AR story is three
paths, not one, and the current engine runs the hardest path everywhere:

| Platform | Path | Why |
|---|---|---|
| Android Chrome | **WebXR** `immersive-ar` + `hit-test` + `depth-sensing` where available | ARCore gives real plane detection, real metric scale, real anchors. Free, native, better than anything hand-rolled. |
| iOS Safari | **AR Quick Look**, USDZ per SKU | Native ARKit tracking, occlusion and lighting through a single link. Placement rules bake into the USDZ anchoring (`preferredPlaneAnchoring`). |
| Desktop, photo upload, anything else | **The existing CV stack in `live/`** | This is where your Lucas-Kanade tracker and plane fitter are genuinely the right tool. Keep them; do not run them where a platform API is available. |

Build all three behind one interface so the calling component does not know
which is active. Feature-detect, never user-agent sniff.

## Workstream 1 — the placement rule table (do this first, it is the actual bug)

Author the missing rule data as a real, typed, versioned table, and add a test
per SKU. This is the highest-value work in the brief and it is mostly data.

Create `packages/ar-engine/src/rules.ts` exporting a `PlacementRule` per
category, covering all 27 live SKUs with no fallthrough. Real Indian
mounting practice, real dimensions, every value defensible:

| Product | surfaces | orientation | anchor | heightBandMm | integration |
|---|---|---|---|---|---|
| CCTV camera (dome/bullet) | `['wall','ceiling']` | `wall_flush` | `back` | `[2400, 3000]` | `mounted` |
| Ceiling fan | `['ceiling']` | `hanging` | `top` | `[2600, 3000]` | `mounted` |
| Batten / tube light | `['ceiling','wall']` | `ceiling_flush` | `top` | `[2400, 3000]` | `mounted` |
| Wall light / sconce | `['wall']` | `wall_flush` | `back` | `[1800, 2100]` | `mounted` |
| Chandelier / pendant | `['ceiling']` | `hanging` | `top` | `[2100, 2700]` | `mounted` |
| Modular switch plate | `['wall']` | `wall_flush` | `back` | `[1200, 1400]` | `recessed` |
| Epoxy / floor coating | `['floor']` | `flat` | `bottom` | — | `resurfaces` |
| Floor tile | `['floor']` | `flat` | `bottom` | — | `resurfaces` |
| Wall tile | `['wall']` | `wall_flush` | `back` | — | `resurfaces` |
| Wash basin (wall-hung) | `['wall']` | `wall_flush` | `back` | `[800, 850]` (rim) | `mounted` |
| Water closet (floor) | `['floor']` | `upright` | `bottom` | — | `rests_on` |
| Geyser / water heater | `['wall']` | `wall_flush` | `back` | `[1800, 2000]` | `mounted` |
| Exhaust fan | `['wall']` | `wall_flush` | `back` | `[2100, 2400]` | `recessed` |
| Mirror | `['wall']` | `wall_flush` | `back` | `[1000, 1800]` | `mounted` |
| Solar panel | `['roof']` | `flat` | `bottom` | — | `stands_on` |
| Door | `['wall']` | `wall_flush` | `bottom` | — | `replaces_pane` |
| Window | `['wall']` | `wall_flush` | `back` | `[900, 2100]` | `replaces_pane` |
| Sofa / bed / dining / wardrobe | `['floor']` | `upright` | `bottom` | — | `rests_on` |

Extend to all 27. Rules:

- **No SKU may fall through to a default.** A category without a rule is a
  build-time error, not a runtime guess. Add a test that iterates every live SKU
  and asserts a rule resolves.
- **`rejectScenes` is used.** A WC in a living room, a solar panel indoors, a
  chandelier in a bathroom — refuse with the guidance chip rather than place.
- **Ceiling-mounted items must actually detect a ceiling**, which means the
  vision layer needs a `ceiling` classifier that works when the phone is tilted
  up. If it cannot see a ceiling, refuse and guide — never fall back to floor.
- **`heightBandMm` drives the default drop point**, so a camera lands high on
  the wall before the user touches anything. Getting the first frame right is
  most of the perceived quality.
- Cite the source for any dimension that is a standard rather than a product
  spec, and flag anything you could not source as `needsVerification`.

## Workstream 1b — "nothing on screen" is a bug, and it has six causes

A reported failure: opening the camera for a **bulb** shows no product at all.
Not misplaced — absent. This is a worse failure than wrong placement, because
the user cannot tell whether the feature is broken, their phone is
unsupported, or they are pointing at the wrong thing.

Enumerate and instrument every path that can end with no product on screen.
Each of these is real and at least one is what is happening now:

1. **Placed off-screen.** The rule mounts a bulb or a camera at 2400–3000 mm.
   A phone held level, pointed at a wall at eye height, puts a correct
   placement above the top of the frame. **This is the most likely cause of the
   bulb report, and it will hit the CCTV camera identically.**
2. **The gate refused and the guidance was not visible.** `GateResult.allowed`
   is false — no ceiling detected, no space — and the chip is missing, subtle,
   behind the camera feed, or off in the layout.
3. **Scale collapsed.** A bulb is roughly 60 mm across. At an assumed
   `DEFAULT_SURFACE_DISTANCE_M` it may project to a handful of pixels.
   Check `autoFitScale` against `MIN_LEGIBLE_PX`, and check what happens when
   `distanceM` is absent and the default is wrong in the far direction.
4. **The asset never loaded.** A 404, a decode failure, a mesh the fidelity
   gate rejected with nothing substituted. Today this is silent.
5. **The material rendered invisible.** Specific to bulbs and glass: an
   emissive or transmissive material that does not survive `normalise.ts`
   renders as transparent geometry. Inspect the bulb SKU's glTF materials
   directly rather than assuming.
6. **Clipped or behind camera.** Near-plane clipping, a negative-depth
   placement, or an anchor resolved behind the viewer.

Fix all six, and then make the class of bug impossible to ship again:

- **The engine may never render nothing without saying why.** Every terminal
  state gets a named, visible UI state — refused, off-screen, asset failed,
  calibrating. Add a `PlacementOutcome` union covering all of them, make the
  renderer exhaustive over it, and assert in tests that no code path can reach
  "no product, no message."
- **Off-screen gets an indicator and a one-tap fix.** When the placement is
  valid but outside the viewport, show a directional arrow with the reason —
  *"tilt up — this light mounts at 2.7 m"* — and a **Show me** control that
  reframes to the product. High-mounted SKUs are unusable without this.
- **A first-frame guarantee.** On open, if the rule's default drop point would
  land outside the frame given the current pose, either widen framing or start
  with the guidance state. The user must never see an empty camera feed with
  no explanation.
- **A dev overlay**, behind a flag, drawing the detected planes, the drop
  point, the projected bounding box and the current `PlacementOutcome`. You
  cannot debug 27 SKUs across five angles without being able to see what the
  engine thinks it is doing.

## Workstream 2 — the Haiku provider (BO_CHAT_*)

Build an Anthropic provider and wire the dead config.

- New `packages/llm/src/anthropic/` — a client reading `BO_CHAT_API_KEY`,
  `BO_CHAT_BASE_URL`, `BO_CHAT_MODEL`, speaking the Messages API.
- Refactor the provider seam so `SceneAnalysis.provider` accepts
  `'anthropic' | 'gemini' | 'device' | 'mock'` and callers choose by capability
  and cost, not by hard-coded import. Do not delete the Gemini path — keep it
  selectable and keep its tests green.
- **Haiku 4.5 vision limits, which shape the call:** standard resolution tier,
  long edge capped at 1568 px and 1568 visual tokens, JPEG/PNG/GIF/WebP, images
  placed *before* text in the message. Downscale frames to 1568 px before
  sending — sending a 4K frame costs the same tokens and adds upload latency for
  nothing. Verify these against the current docs before shipping.
- **Where Haiku belongs:** one-shot scene understanding on a still frame
  (surface classification, scene type, reference-object spotting), refusal
  explanations in the user's language, and offline SKU rule authoring and QA.
- **Where Haiku must never be:** the per-frame live loop. A network round trip
  per frame cannot hold tracking, and it bills per frame. Live tracking stays
  on-device, always. Enforce with a rate limit and a test.
- Every model output is a typed, schema-validated object. A model may classify a
  surface; it may not emit a position, a scale, or a distance. Geometry comes
  from the CV or the platform AR layer.

## Workstream 3 — platform-native AR

Implement the three paths behind one `ARSession` interface.

- **WebXR path.** Request `immersive-ar` with `hit-test`, and
  `depth-sensing` and `light-estimation` as optional features. Use real plane
  detection: a hit-test result carries a pose whose orientation tells you
  whether it is horizontal or vertical — that is your wall-versus-floor answer,
  with no inference. Anchor the product to a real XRAnchor so it stays put when
  the user walks around.
- **Quick Look path.** Generate a USDZ per SKU from the existing glTF, set
  `preferredPlaneAnchoring` from the rule (`horizontal` for floor items,
  `vertical` for wall items), and serve it via `<a rel="ar">`. Wall-anchored
  Quick Look requires the correct anchoring metadata — a wall item exported with
  horizontal anchoring is exactly the carpet bug, in a different layer.
- **CV path.** Keep the existing stack, and improve the two things that matter
  most: a ceiling classifier, and honest refusal. When scale confidence is low,
  say "point at the floor line, or tap a door frame to calibrate" instead of
  placing the product at a guessed size.
- All three feed the same `Placement`. The composite, the UI and the tests do
  not branch on which produced it.

## Workstream 4 — the 3D assets, regenerated once

You have `MESHY_API_KEY` and `TRIPO_API_KEY`, and `packages/assets3d` already
has both providers, a normalisation pass and a fidelity gate that rejects a mesh
that does not match its own photo.

- Run the existing fidelity gate across all 27 SKUs and produce a pass/fail
  table in `scratch/AR_ASSET_AUDIT.md` with the score per SKU.
- **Regenerate only the failures, and only once each.** Before spending a
  generation, write the exact prompt, the source images selected, and the
  expected dimensions to the audit file. Generation is billed and slow: no
  loops, no speculative retries. If a regeneration fails the gate a second time,
  stop, record it, and flag it for a hand-modelled or licensed asset rather than
  trying a third time.
- Every mesh is normalised to real-world metres against the SKU's catalogue
  dimensions, Y-up, origin at the rule's anchor face — a wall-mounted camera's
  origin sits on its back plate, not its centroid, or it will float off the
  wall. Add a test asserting origin placement per `anchor` value.
- Every mesh carries a low-poly LOD and a Draco/meshopt-compressed variant.
  Budget: under 2 MB per SKU on the live path.

## Workstream 5 — per-SKU visual QA, and this is how you know you are done

Build a harness at `packages/ar-engine/test/visual/` that, for every one of the
27 SKUs, composites the product into a fixed set of reference scenes and writes
a screenshot grid to `scratch/ar-qa/`.

- Reference scenes: living room, bedroom, bathroom, kitchen, corridor, exterior
  wall, roof — each shot from **five camera angles**: eye level straight on,
  low looking up, high looking down, oblique left, oblique right.
- That is 27 SKUs × the scenes their rules allow × 5 angles. Every frame is
  asserted, not eyeballed: the product's rendered surface normal must match the
  target surface normal within tolerance, its base or back must be coincident
  with the plane, its rendered size must match its real dimensions at the
  measured distance within 10%, and it must not intersect other geometry.
- **Every frame asserts the product is actually visible** — a minimum count of
  product pixels rendered inside the viewport. A frame that renders nothing
  fails, even if the underlying placement maths is correct.
- **A wall item appearing on a floor plane is a hard test failure, not a warning.**
- Golden-file the screenshot grid so a regression is visible in a diff.
- Review the grid yourself before reporting. A test that passes on a frame that
  looks wrong means the assertion is wrong.

## Constraints

- Every existing test in `packages/ar-engine/test/` and
  `packages/assets3d/test/` stays green. If one encodes a wrong assumption, say
  so and stop rather than editing it to pass.
- Camera permission is requested only on explicit user action, with a clear
  reason, and the stream stops on unmount. Frames leave the device only for the
  one-shot analysis call, never continuously, and never stored server-side
  without saying so in the UI.
- No secret reaches the client. All model calls go through a server route.
- Refusal is a first-class state and must look designed, not broken.
- Do not delegate this to subagents. One agent, working through the workstreams
  in order.

## Score it

Score out of 100 and write `scratch/AR_SCORE.md`. Score honestly — a real 78
with a named list of the missing 22 is worth more than a claimed 100.

| Band | Points | Full marks means |
|---|---|---|
| Placement correctness | 26 | All 27 SKUs, all allowed scenes, all five angles: right surface, right orientation, right anchor face coincident with the plane, right mounting height. Zero fallthroughs. |
| Visibility | 10 | All six no-product causes found and fixed. `PlacementOutcome` exhaustive, off-screen indicator with Show me, first-frame guarantee, dev overlay. No path reaches an empty camera with no message. |
| Scale truth | 14 | Rendered size matches real dimensions within 10% at measured distance, or the engine refuses and asks for calibration rather than guessing. |
| Platform AR | 14 | WebXR on Android with real hit-test anchors; USDZ Quick Look on iOS with correct plane anchoring per rule; CV path for the rest. One interface, feature-detected. |
| Asset quality | 11 | All 27 pass the fidelity gate, normalised to metres, origin on the anchor face, LOD and compression, under 2 MB. |
| Visual QA harness | 12 | Full screenshot grid, assertions on normals and size, goldens committed, wall-on-floor is a hard failure. |
| Haiku integration | 7 | BO_CHAT_* live, typed schema-validated output, images downscaled to 1568 px, never in the per-frame loop, Gemini path still selectable and green. |
| Refusal and guidance | 3 | Honest, specific, localised, designed. Never a silent wrong placement. |
| Performance | 3 | 30fps floor on a mid Android, camera released on unmount, live path under budget. |

Under 90: keep going before you report.

## When you are done

Update `DECISIONS.md` with the consequential calls — the three-path AR
architecture, the rule table as data, the Haiku provider seam, which SKUs were
regenerated and why. Update `PROJECT_STATE.md`. Write `scratch/AR_AUDIT.md`,
`scratch/AR_ASSET_AUDIT.md` and `scratch/AR_SCORE.md`.

Then tell me, in under ten lines: the score, which SKUs still place wrongly and
why, and the single change that would move the score most.
