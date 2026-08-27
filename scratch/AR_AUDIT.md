# AR engine — Phase 0 audit

Read-only. No code changed. Every claim below has a file and line behind it.

**Headline: four of the brief's six premises are refuted by the code.** The placement rule table
exists, is populated, is wired to production, and covers every live SKU with zero fallthroughs.
WebXR exists. A ceiling classifier exists. `BO_CHAT_API_KEY` is referenced by TypeScript. Writing
`packages/ar-engine/src/rules.ts` as the brief specifies would duplicate working, tested code.

The wrong-surface and no-product reports are real. Their cause is somewhere else, and I found a
strong candidate: **the gate is wired into the photo path only, and never runs in live camera.**

---

## 1. Where does a `PlacementRule` come from at runtime? — **REFUTED**

The brief says the type is "declared and consumed but never populated anywhere in the repo", and
that grepping `wall_flush` / `resurfaces` / `replaces_pane` hits only `types.ts`.

It does not. Those literals appear in eight files, and the table is real:

- `packages/ar-engine/src/placement.ts:12` — `export const PLACEMENT_RULES: Record<string, PlacementRule>`,
  ten populated entries: `bulbs, cctv, tiles, glass, solar-panels, fire-extinguishers, cement,
  epoxy, total-stations, bathtub`.
- `packages/ar-engine/src/placement.ts:132` — `ruleFor(category)`.
- `packages/ar-engine/src/placement.ts:3` — `PLACEMENT_RULES_VERSION = 2`. It is already versioned.

**It is wired to production**, not just to tests:

- `apps/web/lib/ar-data.ts:4` imports `ruleFor`.
- `apps/web/lib/ar-data.ts:155` — `rule: ruleFor(data.category.slug)`.
- `apps/web/components/ar/camera/ArCamera.tsx:115` — `useState<Surface>(rule.surfaces[0])`.

The CCTV rule already says exactly what the brief asks me to author:

```ts
cctv: { surfaces: ['wall','ceiling'], orientation: 'wall_flush', anchor: 'back',
        heightBandMm: [2200, 3000], integration: 'mounted' }   // placement.ts:25
```

**So the root cause named in the brief is not the cause.** No amount of rule authoring fixes a bug
that is not a missing rule.

## 2. What is the fallback default? — the brief is right about the default, wrong about who hits it

`placement.ts:134-144`:

| field | value |
|---|---|
| surfaces | `['floor']` |
| orientation | `'upright'` |
| anchor | `'bottom'` |
| integration | `'rests_on'` |

That is indeed a carpet. **No live SKU reaches it.** All nine live category slugs are keys in the
table — verified by matching `apps/web/data/catalogue/flagship.json` against the table's keys.

## 3. The live SKUs — **28, not 27**, in 9 categories, all with rules

The 28th is `CEM-AMB-KAWACH50`, the zero-touch proof row. Every category resolves:

| category | n | rule | GLB present |
|---|---|---|---|
| bulbs | 3 | yes | 3/3 |
| cctv | 3 | yes | **2/3** |
| cement | 4 | yes | **3/4** |
| epoxy | 3 | yes | 3/3 |
| fire-extinguishers | 3 | yes | **2/3** |
| glass | 3 | yes | **0/3** |
| solar-panels | 3 | yes | **2/3** |
| tiles | 3 | yes | 3/3 |
| total-stations | 3 | yes | 3/3 |

**Seven SKUs have no 3D asset at all**: `CCT-DAH-HDW1200TRQP`, `CEM-AMB-KAWACH50`,
`FIR-CEA-MAP90-4KG`, `GLS-AIS-EDGE-NATURAPLUS`, `GLS-GUA-CLIMAGUARD-BLUE5`,
`GLS-SGB-SUNBAN-SAPPHIRE5`, `SOL-ADA-ASB-M10-144-575`. All three glass SKUs are missing — which
means the entire `glass` category renders nothing, for a reason that has nothing to do with rules.

**Twenty of the twenty-one existing GLBs are over the brief's 2 MB budget**, at 6.0–11.5 MB.
`BUL-PHI-ACESAVER9WB22` is 62 KB with hand-named materials (`silver`, `pin-silver`,
`white-plastic`, `bulb-housing`) — a synthetic placeholder, not a generated mesh.

## 4. Is `BO_CHAT_API_KEY` referenced by TypeScript? — **REFUTED, as of today**

It is, in six places. `apps/web/lib/chat/anthropic.ts` is a complete Anthropic Messages client:

- `:59` `anthropicBase()` reads `BO_CHAT_BASE_URL`
- `:63` `anthropicModel()` reads `BO_CHAT_MODEL`, defaulting to `claude-haiku-4-5-20251001`
- `:67` `chatKey()` reads `BO_CHAT_API_KEY`
- `:331` `readDocumentAsJson()` — forced-tool document reading, images and PDFs

This was built earlier today for the assistant and the quote checker, both verified live. The
brief's investigation predates it.

**The brief is right about one half**: `packages/llm` is `@google/genai` only (`package.json:18`,
no Anthropic dependency, no `src/anthropic/`). The Anthropic client lives in the web app, so the
AR analysis path in `packages/ar-engine` cannot reach it. Workstream 2's real remaining work is
moving or re-exporting that client so `SceneAnalysis.provider` can select it — not writing one.

## 5. WebXR or the hand-rolled CV stack? — **both, already routed by capability**

`packages/ar-engine/src/tier.ts` implements the three-path architecture the brief asks for in
Workstream 3, feature-detected, no UA sniffing:

- `:96` `xr.isSessionSupported('immersive-ar')`
- `:107` `webxr → tier L`
- `:108` `camera && secureContext → tier C` (the CV stack)
- `:109` `quickLook → tier Q`
- `:110` else `tier P` (photo)
- `apps/web/components/ar/ArLive.tsx:129-130` requests `immersive-ar` with `requiredFeatures: ['hit-test']`

**The one real gap the brief identifies correctly**: the ordering at `tier.ts:108-109` tests
`camera` before `quickLook`. iOS Safari has `getUserMedia` and a secure context, so iOS lands on
**tier C — the hand-rolled CV path** — with Quick Look demoted to a secondary chip. That is the
brief's "runs the hardest path everywhere" criticism, and on iOS it lands.

## 6. Why does the bulb render nothing? — four of six causes eliminated by inspection

I could not reproduce it: it needs a camera and a phone, and this is a headless environment. What
I can do is eliminate causes against the code.

| # | cause | verdict | evidence |
|---|---|---|---|
| 1 | placed off-screen | **already handled** | `surface-guide.ts:236` clamps `v` to `[0.06, 0.94]`, with a comment explaining exactly this case |
| 3 | scale collapsed | **already handled** | `autoFitScale` (`surface-guide.ts:288`) enlarges a 60 mm bulb from ~25 px to `MIN_LEGIBLE_PX = 96`, capped at `MAX_AUTO_FIT = 6` |
| 4 | asset never loaded | **not for bulbs** | all three bulb GLBs exist (62 KB / 6.0 MB / 7.4 MB) |
| 5 | invisible material | **refuted** | every bulb material is `alphaMode: OPAQUE`, no `KHR_materials_transmission`, no emissive, `extensionsUsed: []` |
| 6 | clipped / behind camera | not eliminated | needs a device |
| 2 | **gate refused, guidance invisible** | **prime suspect, and worse than described** | see below |

**The gate never runs in live camera mode.** `gate()` is called at `ArStage.tsx:194` and in
`photoSession.ts` — both the photo path. `ArCamera.tsx` does not import or call it; there is no
`GateResult` anywhere in the live path.

So in tier C — which is what iOS Safari and every Android without WebXR get — there is no refusal
and no guidance chip at all. Live mode instead starts at `rule.surfaces[0]` (`ArCamera.tsx:115`)
and follows `matchSurface` (`:307`, `:438`), which walks only the rule's own surfaces. That is why
a CCTV camera cannot be placed on a floor *by the rule* — and why, when the required surface is
never detected, nothing appears and nothing explains it.

This is a better root cause than the brief's for both symptoms, and it is one wiring gap rather
than a missing subsystem.

---

## What is actually missing

1. **The gate is not wired into the live camera path.** One integration, not a rewrite.
2. **7 of 28 SKUs have no mesh** — the whole `glass` category among them.
3. **20 of 21 meshes are 3–5× over the 2 MB budget**; no LOD, no Draco/meshopt variant.
4. **iOS is routed to the CV path ahead of Quick Look** (`tier.ts:108-109`).
5. **No Anthropic provider in `packages/llm`** — the client exists but in the web app.
6. **Epoxy is modelled as a bucket, not a coating**: `placement.ts:94` gives it
   `orientation: 'upright'`, `integration: 'rests_on'`, surfaces `['floor','table','ground']`.
   That is correct for a 10 kg pack of Conbextra and wrong for the "epoxy flooring should lay on
   the ground" expectation. This is a product decision, not a bug — the three epoxy SKUs are
   repair mortars and injection grouts, not floor coatings.

## What I did not verify

- Whether the CCTV-on-carpet report came from photo mode or live mode. The rule forbids floor in
  both; a mislabelled wall region in `vision/surfaces.ts` would explain it, and `surfaces.ts:195`
  documents a prior bug of exactly that shape being fixed once already.
- Anything requiring a real camera: causes 6, frame rate, tracking quality.
- The fidelity gate scores per SKU — Workstream 4, not started.
