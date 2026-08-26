# Backplates — what each file is, and where it goes

Seven photographic plates, generated 26 Aug 2026, identified, renamed, graded to
the canvas and optimised. They are ready to use as they are.

The ungraded originals stay where you put them, in `scratch/design-refs/` (2752 ×
1536 JPEG, ~3.4 MB each) — they are not duplicated here. If a plate needs
re-grading, work from those; the mapping is in the table below. `_source/` holds
the one intermediate a tool in this repo has replaced: see "Settled" below.
**Never ship a file from `generated images/`** — they are 3 MB and much brighter
than the page. Ship the `.webp` files in this folder.

| Original | Became |
|---|---|
| `11_22AM.jpg` | `home-hero.webp` — **replaced 26 Aug, see below** |
| `11_24AM.jpg` | `pdp-stage.webp` |
| `11_25AM.jpg` | `site-materials.webp` |
| `11_27AM.jpg` | `catalogue-aisle.webp` |
| `11_28AM.jpg` | `construct-frame.webp` |
| `11_30AM.jpg` | `cart-yard.webp` |
| `11_33AM.jpg` | `interior-warm.webp` |
| `4_00PM.jpg` | `home-hero.webp` (the one that ships) |

## The manifest

| File | 2560px unless noted | Page / slot | Notes |
|---|---|---|---|
| `home-hero.webp` | 2752px | Home — behind the headline | Dusk contemporary villa: cantilevered slabs, sandstone cladding, a full-height timber louvre screen, a lit double-height living room, reflecting pool, porch, sandstone compound wall with a sliding MS gate, coconut palms and frangipani, wet paving. Correct AP vernacular throughout, and checked at native resolution for signage — there is none. |
| `catalogue-aisle.webp` | | Category and search pages | One-point perspective down a materials aisle, amber lamp run vanishing into black. |
| `site-materials.webp` | | Home — the materials band | Cement, rebar and sand in a raking sunbeam. Top third is empty for copy. |
| `construct-frame.webp` | | Construct pages | RCC frame with shuttering props and starter bars. The only daylight frame in the set — its sky is pulled down to the canvas so it matches the other six. |
| `cart-yard.webp` | | Cart and checkout | Loaded truck at a site gate in the rain, one sodium lamp. Warmest frame in the set. |
| `interior-warm.webp` | | Interiors, lifestyle, Livspace-facing pages | Finished living room at dusk — vitrified floor, Kota stone wall, brass lamp, ceiling fan, MS grills. |
| `pdp-stage.webp` | | Product detail — the gallery stage | An empty lit plinth. The product renders **on** this. Nothing else may occupy the plinth. |

### The hero was replaced, 26 Aug 2026

The frame this shipped with was a dusk G+1 house and it was the best of the original set. It was
replaced with a contemporary villa on the same 2752 × 1536 canvas — a different kind of house, and
one closer to what the store's customers are commissioning.

Two things came out of doing it that are worth keeping:

**The grade is a tool now.** This file said the plates were "graded to the canvas and optimised"
and never said how, which meant the only way to match the set was to eyeball it. The house style,
measured off the seven that shipped, is `mean rgb 32,59,60 · median 46 · p90 95` — blue at or above
green, red well below both, everything sitting in the canvas's own hue and nothing near white.
`services/pipeline/tools/grade-plate.mts` solves the per-channel gain that lands a new frame on
that, iteratively, and reports what it converged to. The new hero came in at `62,87,82 / 78` and
went out at `31,71,76 / 60` — an exact match on the channel means to the plate it replaced.

**The hero has its own scrim.** The shared `.plate-scrim` is tuned for a 208px banner where a title
sits directly on the photograph. On an 838px hero it crushed the frame to a faint smudge in the top
right — the photograph was there, paid for, and invisible. `.hero-plate .plate-scrim` in
`styles/home.css` stays heavy on the left where the copy is and opens across the right half where
the building is. Measured on the rendered page rather than judged:

    width   headline            lede
    1440    9.12:1  AAA         5.97:1  AA
    1024    8.71:1  AAA         5.19:1  AA
     768    7.22:1  AAA         4.77:1  AA
     390    9.20:1  AAA         4.80:1  AA

Each figure is against the single BRIGHTEST pixel behind that block, which is the worst case; most
of each band sits far darker.

## How they are used

Every one is a **backplate**: it sits behind the opening section of its page,
full-bleed, under a scrim, with the copy on top. None of them is a foreground
image and none should ever be shown at full brightness.

```html
<section class="plate">
  <img src="/art/home-hero.webp" alt="" aria-hidden="true">
  <div class="plate-scrim"></div>
  <div class="plate-body"> … headline … </div>
</section>
```

```css
.plate { position: relative; isolation: isolate; }
.plate > img {
  position: absolute; inset: 0; z-index: 0;
  width: 100%; height: 100%; object-fit: cover;
  /* The plates are 16:9. The hero slot is wider than that, so the crop is
     centre-weighted and the house stays in frame down to about 1100px. */
  object-position: 50% 62%;
}
.plate-scrim {
  position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background:
    linear-gradient(180deg, var(--color-canvas) 0%, rgb(6 24 29 / 30%) 34%, rgb(6 24 29 / 82%) 100%),
    linear-gradient(90deg, rgb(6 24 29 / 88%) 0%, rgb(6 24 29 / 10%) 62%);
}
.plate-body { position: relative; z-index: 2; }
```

The second scrim layer is the one that matters — it darkens the **left** side,
which is where every headline on this site sits. Without it the copy fights the
photograph at exactly the width most people browse at.

Run each plate through the store's existing `next/image` srcset ladder. Do not
serve a 3200px hero to a phone; that ladder already exists and was tuned in
Round 2.

## Two things to know before you ship

**1. The brand packaging is fabricated.** `site-materials` and
`catalogue-aisle` came back with legible packaging for UltraTech, ACC, Kajaria,
Finolex, Supreme, Asian Paints and Berger. These are not photographs of stock —
they are a generator's invention of other companies' trade dress, and several
of the words are misspelled. Publishing invented packaging for a real company on
your own storefront is a trademark exposure, and it looks fake to anyone who
knows the bag.

I have thrown those regions out of focus, which is consistent with the f/2.0
the frame already claims and removes the legibility. **That is a mitigation, not
a fix.** Before these go anywhere customer-facing, do one of:

- regenerate both with the no-lettering constraint enforced (prompts are in
  `PROMPT_PACK.md` — add *"all packaging is plain, unmarked and unbranded"* to
  the scene, not just the negative block); or
- photograph your own yard, which you will want anyway; or
- keep them and accept that two of your seven plates carry softened fake
  branding.

Everything else in the set is clean.

### Settled, 26 Aug 2026 — both, differently

**`site-materials` was already clean and stays as it is.** Checked at native
resolution: its sacks are defocused past any letterform, and nothing else in the
frame — rebar, sand, bamboo, the raking beam — carries branding at all.

**`catalogue-aisle` was not, and is now cropped.** The mitigation had softened the
near foreground and left the MID-GROUND shelving sharp; at 2560px the stacked sacks
on both sides read "… Cement" repeatedly down the pile. "You cannot read it at the
size we display it" is not the test — the plate ships on a public CDN and this one is
the backplate on all 35 category pages and on search, which would have made it the
most-served image in the store.

Blurring the shelves was tried and fails on this composition. The two stacks sit at
32–43% and 56–67% of the frame, so the corridor between them is a seventh of the
width; a mask narrow enough to catch the lettering blurs almost the whole photograph.
The frame's subject IS the branded packaging, and there is no version of it that
keeps the subject and loses the brands.

So it is cropped to the upper 46% — the ceiling, the beams, and the lamp run
receding into black. No packaging sits above 42% of the frame, and what clips the
bottom edge was verified illegible at native resolution rather than at display size.
It is now **2560 × 657, 3.90:1** and 85 KB, which is also the better plate: every
slot it fills is a wide banner, so `object-fit: cover` discards a sliver where it
used to discard half the composition.

`services/pipeline/tools/regrade-plate.mts` does it and is rerun-safe; the pre-crop
frame is stashed in `_source/`. Re-run it after any regeneration.

**2. All seven are 16:9, not 21:9.** The hero slot in the north star is wider.
`object-fit: cover` with the `object-position` above handles it, but check the
crop at 1440px and at 390px before you call it done — the mumty and the tank are
the top of the frame and they are what make the house read as Indian.

## Not in this folder, deliberately

`iso-house.svg` (the estimator's model), the drafting field, and the BO coin
stay as vector and CSS. See `PROMPT_PACK.md` §1 for why. Do not replace them
with photographs.

## Not generated

The 35 category tiles. They are the entire home page grid and matter more than
any single plate — three of the current ones are visibly weaker than the rest.
The locked template and the `{SUBJECT}` list are in `PROMPT_PACK.md` §4. Run all
35 in one sitting so the light does not drift, then grade them with the same
recipe.
