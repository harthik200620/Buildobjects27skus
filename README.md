# Build Objects

A construction-materials store for Andhra Pradesh and Telangana, with a cost estimator and an
AR previewer. Thirty-seven categories in thirteen departments, nine of them stocked today;
every specification carries its provenance, and every price is stated with GST and landed at
the buyer's pincode.

## Running it locally

Requires Node 20+ and pnpm 11+.

```bash
pnpm install
```

```bash
pnpm infra:up
```

`infra:up` starts MySQL 8.4, Meilisearch and Redis from `infra/` — portable binaries plus Redis
in WSL, so no Docker is needed on Windows. `pnpm infra:status` shows what is listening and
`pnpm infra:down` stops it. On a machine with Docker, `infra/docker-compose.yml` is the same
stack.

```bash
pnpm db:migrate && pnpm db:seed && pnpm registry:seed
```

`registry:seed` reads the workbook, rewrites the nine registry files from it, and seeds the
categories, departments, attribute groups and attributes — removing anything the workbook no
longer declares.

```bash
pnpm assets:3d
```

```bash
pnpm dev
```

The app is at http://localhost:3000. Sign in with any 10-digit Indian mobile number and the
one-time code `000000`; delivery pincodes are `50xxxx`–`53xxxx`.

Everything above runs without API keys. Keys change behaviour rather than gate it: without
`GEMINI_API_KEY` the AR scene read falls back to an on-device luminance analysis and asks the
user to confirm the room type, and without `ANTHROPIC_API_KEY` the ingestion pipeline reads the
curated fixtures in `services/pipeline/data/curated/` instead of live pages. See `.env.example`.

## Layout

```
apps/web            Next.js App Router — storefront, product pages, AR, estimator, API routes
packages/
  ar-engine         Placement rules, gating, true-scale maths, pose and plane tracking
  assets3d          Parametric glTF builders and the Meshy/Tripo image-to-3D pipeline
  catalog           The shared vocabulary: attribute registry, SKU shape, facets, formatting
  db                Drizzle schema, migrations and the MySQL pool
  estimator         Deterministic costing engine — no dependencies, no I/O
  llm               Gemini client: concurrency gate, retries, grounded JSON, cost accounting
  ui                Design tokens and the base stylesheet
services/pipeline   Ingestion: fetch, extract, verify, fill, images, brochures, describe
assets/3d           Generated .glb models and the asset manifest
infra               Local MySQL / Meilisearch / Redis without Docker
```

## How the data flows

`WHOLE_PRODUCT_LIST_BO_PRODUCT_CALENDAR.xlsx` at the repo root is the master specification
document: nine sheets, one per category, one row per specification, and the value each of the
three brands holds for it. It is the file a person edits when a specification changes, and
`services/pipeline/src/registry/from-sheet.ts` is the only thing that reads it.

```
workbook ──▶ registry/{category}.json ──▶ attributes + attribute_groups ──▶ sku_attribute_values
                     ▲                                                              │
      registry/spec-groups.json (headings, per category)                            ▼
      registry/attribute-overlay.json (facet widgets, enums, synonyms)      spec_json · key_specs
                                                                            Meilisearch · facets
```

`services/pipeline` is the only writer. It produces attribute values into the EAV tables, then
derives everything a page renders — the denormalised `spec_json`, the key specs, the card specs,
the Meilisearch document and the facet config. Reads never touch EAV.

Photographs come from each brand's own product page, never from a competitor's: see
`pnpm pipeline images:resource` below.

That split is what keeps listing pages fast at scale: faceting is Meilisearch's job, a product
page is one row, and the SKU list endpoint paginates by keyset (`WHERE id > ? LIMIT n`) rather
than by offset. `pnpm scale:seed` loads 400k synthetic SKUs and `pnpm scale:test` measures it.

## Checks

One command runs everything CI runs:

```bash
pnpm check
```

That is `lint` → `typecheck` → `test` → `contrast` → `validate`, and `.github/workflows/ci.yml`
adds `build` on top. Each is available on its own:

| command | what fails it |
|---|---|
| `pnpm lint` | Biome: formatting, import order, and the rule set in `biome.jsonc` — every disabled rule there carries the reason it is off |
| `pnpm typecheck` | `tsc` across all nine packages, with `noUnusedLocals` on so dead bindings cannot accumulate |
| `pnpm test` | Vitest in every package that has tests |
| `pnpm contrast` | parses `packages/ui/src/theme.css` and fails if a token pair the UI uses drops below its WCAG minimum |
| `pnpm validate` | the curated SKU files against their registries: unknown keys, wrong types, a `verified` value with fewer than two sources, or a placeholder string standing in for a value |

`pnpm format` applies every fix Biome can make safely.

## Pipeline commands

| command | what it does |
|---|---|
| `pnpm registry:seed` | workbook → nine registries → categories, groups, attributes (prunes what the workbook dropped) |
| `pnpm pipeline sheet` | what the workbook contains, category by category — a dry read, writes nothing |
| `pnpm pipeline run` | the seven per-SKU stages: fetch · extract · verify · fill · images · brochures · describe |
| `pnpm pipeline images:resource --write` | re-source every SKU's photographs from its own brand's page; refuses any image on a competitor's domain. Without `--write` it reports and changes nothing |
| `pnpm pipeline art:categories` | one 16:9 tile per category — a real product photograph for a live category, a drawn tile for an upcoming one |
| `pnpm pipeline derive` | rebuild `spec_json`, key specs, facets and the Meilisearch index |
| `pnpm pipeline report` | per-SKU coverage: attributes filled, by provenance, images, brochures |

Two more are manual because they need a running server: `pnpm --filter @buildobjects/web
lighthouse` audits a local production build, and `shots` captures page screenshots into
`storage/reports/shots/`.

## Related documents

- `DECISIONS.md` — dated log of technical choices and why they were made
- `DEMO.md` — an end-to-end walkthrough of the running app
- `DEPLOY.md` — deployment notes
