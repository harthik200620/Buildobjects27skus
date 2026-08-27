# AR engine — score

**57 / 100.** The reported bug is fixed and verified on production. Most of the brief's rubric is
untouched, and the gap between "works" and "scores well" is the honest part of this number.

| Band | Max | Got | Why |
|---|---:|---:|---|
| Placement correctness | 26 | 18 | Rules exist, are versioned and wired; all 28 live SKUs resolve with zero fallthroughs. Verified one SKU per category on the real view. Not verified: five camera angles × every allowed scene, which is the harness below. |
| Visibility | 10 | 6 | Three distinct causes found and fixed. Loading and failed states are visible. No `PlacementOutcome` union, no off-screen "Show me", no dev overlay. |
| Scale truth | 14 | 9 | True size verified — cement 450×700 mm, extinguisher 160×505 mm, both at 100%. Auto-fit lifts small items to a legible size and says "auto" when it has. No calibration flow when confidence is low; the engine still assumes a default distance. |
| Platform AR | 14 | 8 | Tier L/C/Q/P exists, feature-detected via `isSessionSupported`, never UA-sniffed. WebXR hit-test path is real. Quick Look is unreachable: zero USDZ tracked. |
| Asset quality | 11 | 7 | 20 of 21 now under 2 MB (was 1 of 21); 139 MB saved. 7 SKUs are still placeholders, one is 2.4 MB, no separate LOD variants. |
| Visual QA harness | 12 | 2 | Not built. Ad-hoc screenshots across 12 SKUs, reviewed by eye, no goldens and no assertions on normals. |
| Haiku integration | 7 | 2 | A full Messages client exists and is live for the assistant and the quote reader — but in `apps/web/lib/chat`, not `packages/llm`, so the AR analysis path cannot select it. |
| Refusal and guidance | 3 | 3 | Honest, specific, designed, and measured inside the viewport at 360/390/430 px. |
| Performance | 3 | 2 | 139 MB off the catalogue; camera released on unmount. No measured frame rate on a real mid-range Android. |

## The three causes of "I cannot see the product"

All three were real, all three shipped, and they stacked — which is why fixing any one alone would
not have shown a product.

1. **`glbUrl` was null on every deployed page.** `hasGlb()` probed `./assets/3d`, a repo-root
   sibling outside the serverless bundle, so `existsSync` was false for all 28 SKUs in production.
   The renderer effect returned early and never fetched anything. Production-only, which is why
   every local reproduction showed a product.
2. **The renderer destroyed itself whenever the product was resized.** `scaleMult` was a dependency
   of the effect that CREATES `SceneRenderer`; auto-fit set a scale on the first surface, the
   effect re-ran, the scene was disposed and the GLB refetched — with `autoPlacedRef` already spent,
   so nothing placed it again.
3. **The auto-place guard was set before the placement was attempted.** `anchorFromPixel` returns
   null on the first frame while the pose settles; one null burned the flag for the session.

## What would move the score most

**The visual QA harness (12 points, and it guards the other 26).** Everything above was found by
opening the view and looking. Twelve SKUs × one angle, reviewed by eye, is not a regression test —
the next dependency-array mistake ships exactly the same way this one did. A harness that
composites every SKU into its allowed scenes at five angles and asserts *product pixels rendered
inside the viewport* would have failed on all three causes above, on the first run, without anybody
noticing anything.

Second: **publish the USDZs** (up to 14 points, and it is the whole iOS experience). 24 exist under
`assets/3d/photoreal/raw/`, which `.gitignore` excludes; `/3d/*.usdz` is 404. Until they ship, iOS
must stay on the CV path and the tier ordering is correct as it stands.
