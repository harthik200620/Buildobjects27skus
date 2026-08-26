# Backplate prompt pack — Gemini & ChatGPT

Everything here produces the photographic plates that sit behind the opening
section of each page. Generate them, run the grade pass at the bottom, drop them
in `design-system/art/`.

**Do not generate these three.** They are already better as vectors and a photo
would be a downgrade:

| Asset | Why it stays drawn |
|---|---|
| `iso-house.svg` | It is the model being costed, not a picture of a house. Addressable groups animate when the estimator changes floors. 10 KB, crisp at any DPR. |
| the drafting field | 4 KB tiling SVG. As a PNG it is ~2 MB and soft on retina. |
| the BO coin | A CSS 3D object that rotates forever and catches light. A photo is a still. |

---

## 1. Model settings

**Gemini — Nano Banana Pro (Gemini 3 Pro Image).** Preferred. Supports `21:9`,
`16:9`, `4:3`, `1:1` and outputs 1K / 2K / **4K**. Set **4K** for the hero,
**2K** for everything else. Aspect ratio is a real parameter — set it, do not
ask for it in words.

**ChatGPT — Images 2.0.** Caps at **2048 × 2048** and ratios between 3:1 and
1:3, so 21:9 (2.33:1) is in range but you will not get 4K. Two habits to correct
in every prompt: it lifts the shadows (say *crushed, near-black shadows* twice)
and it adds people and signage unless told not to. State the ratio in words in
the prompt itself — "a wide 21:9 cinematic frame".

Generate **4 variants of each** and keep one. Roughly 1 in 3 gets the Indian
vernacular right on the first pass.

---

## 2. The three blocks

Every prompt is `SCENE + GRADE + NEGATIVE`. The grade block is what makes twelve
separate generations read as one photographer's shoot — paste it verbatim every
time, do not paraphrase it.

### GRADE (paste into every prompt)

> Colour grade: cinematic, low-key, crushed near-black shadows with a deep
> teal-cyan cast; the only bright values are warm amber practical lights. No
> lifted blue-grey midtones, no HDR flatness, no bright overcast look. High
> dynamic range with most of the frame dark. Fine 35mm film grain. Shot
> anamorphic with shallow depth of field and real optical falloff.

### NEGATIVE (paste into every prompt)

> No text, no lettering, no numerals, no signage, no logos, no brand names, no
> watermark. No people, no faces, no hands. No pitched or gabled roofs, no roof
> shingles, no clapboard siding, no picket fence, no American mailbox — this is
> not a Western suburban house. No domes, no arches, no jaali screens, no
> carved stone, no palace or haveli architecture — this is not heritage or
> Mughal India. Contemporary, ordinary, present-day South India.

### The vernacular (use these words — they are what make it read as AP/Telangana)

Flat RCC terrace roof · parapet wall about three feet high · staircase mumty on
the terrace · black Sintex overhead water tank on the mumty · concrete chajja
sunshade projecting over every window · slim black MS steel window grills ·
raised plinth about two feet with steps · car portico with a sit-out verandah ·
compound wall with a mild-steel gate · cement plaster with texture-paint bands ·
coconut palm, bougainvillea, plumeria.

---

## 3. The plates

### `home-hero.png` — 21:9, 4K — the front door

> A wide 21:9 cinematic architectural photograph at blue-hour dusk of an
> ordinary contemporary two-storey house on a residential street in Vijayawada,
> Andhra Pradesh. Flat RCC terrace roof with a three-foot parapet; a staircase
> mumty on the terrace carrying a black Sintex overhead water tank; a deep
> concrete chajja sunshade projecting over every window; slim black mild-steel
> window grills; a raised plinth about two feet high with steps; a car portico
> with a sit-out verandah; a low compound wall with a mild-steel gate closest to
> camera. Cement plaster walls with a darker texture-paint band. Warm amber
> interior light spilling out through the windows onto the porch floor. A
> coconut palm and a bougainvillea against the compound wall. Deep teal-cyan
> dusk sky. Shot from across the street at eye level, 40mm.
>
> [GRADE] [NEGATIVE]

*Keep the upper-left third dark and uncluttered — the headline sits there.*

### `pdp-stage.png` — 16:9, 2K — the product stage

> A studio photograph of an empty low circular plinth of polished dark concrete
> standing on a seamless near-black studio floor. One soft overhead key light
> from the upper left throws a soft elliptical pool on the plinth and a long wet
> specular reflection across the floor; a faint cyan rim light from behind.
> Volumetric haze in the air. The plinth is completely empty — nothing stands on
> it. 85mm, f/4.
>
> [GRADE] [NEGATIVE]

### `site-materials.png` — 16:9, 2K — the materials band

> A cinematic close photograph of stacked cement bags and bundled steel TMT
> rebar on an Indian construction site at golden hour, a heap of river sand
> beside them, a bamboo scaffolding pole entering the left of frame. Dust motes
> suspended in a low raking sunbeam. The upper third of the frame is empty dark
> air. 50mm, f/2.0.
>
> [GRADE] [NEGATIVE]

### `catalogue-aisle.png` — 16:9, 2K — the listing pages

> A cinematic photograph looking straight down a long dark warehouse aisle
> stacked high on both sides with Indian building materials — cement bags, tile
> cartons, coils of electrical wire, bundles of PVC pipe, paint drums —
> receding into blackness. Lit only by a row of overhead lamps casting warm
> amber pools and long shadows. Volumetric haze. Strong one-point perspective
> vanishing into black. 35mm, f/2.8.
>
> [GRADE] [NEGATIVE]

### `construct-frame.png` — 16:9, 2K — the Construct pages

> A cinematic photograph at golden hour of a reinforced-concrete framed
> structure under construction in India: raw grey concrete columns and beams, a
> freshly cast first-floor slab with shuttering props still standing beneath it,
> exposed rebar starter bars rising from the column tops, bamboo scaffolding
> lashed at the corners, a blue tarpaulin. Silhouetted against a teal dusk sky
> with one warm sunbeam raking across the wet concrete. 35mm, f/2.8.
>
> [GRADE] [NEGATIVE]

### `cart-yard.png` — 16:9, 2K — the cart and checkout

> A cinematic photograph at dusk of a small Indian materials delivery truck
> parked at a construction site gate, loaded with cement bags under a tied blue
> tarpaulin, tail lights glowing warm amber, wet ground reflecting the light. A
> compound wall and mild-steel gate behind it, one sodium street lamp above.
> 40mm, f/2.8.
>
> [GRADE] [NEGATIVE] Also: no number plate.

### `interior-warm.png` — 16:9, 2K — interiors and lifestyle

> A cinematic interior photograph at dusk of a finished contemporary South
> Indian living room: polished vitrified tile floor, a teak-framed sofa in
> linen upholstery, a Kota stone accent wall, a brass floor lamp casting warm
> amber light, a ceiling fan above, tall windows with slim mild-steel grills
> showing blue-hour sky outside. Editorial architecture-magazine composition,
> eye level, 35mm, f/2.8.
>
> [GRADE] [NEGATIVE]

---

## 4. The 35 category tiles

These matter more than the hero — they are the entire home page grid, and three
of the current ones are visibly weaker than the rest. Consistency beats
individual quality here: **one prompt template, one slot, generated in one
sitting, same model, same settings.**

**Template — 1:1, 2K:**

> A single hero photograph of `{SUBJECT}` arranged on a seamless dark surface,
> shot from a three-quarter angle slightly above. One soft key light from the
> upper left, a faint cyan rim light from behind, a soft contact shadow beneath.
> The subject fills the centre two-thirds of the frame with dark empty space at
> the bottom. Product-photography sharpness, real material texture.
>
> [GRADE] [NEGATIVE]

Fill `{SUBJECT}` from the workbook — the same 35 names, in the registry's
spelling. A few worked examples:

| Category | `{SUBJECT}` |
|---|---|
| Concreting | a stack of three cement bags and a steel trowel |
| Steel & Reinforcement | a bundle of ribbed TMT reinforcement bars, cut ends toward camera |
| Flooring | four large vitrified floor tiles fanned out, one standing on edge |
| Doors & Windows | a teak door leaf leaning against a UPVC casement window frame |
| Painting | three open paint tins, a roller and a brush |
| Plumbing | a coil of CPVC pipe with brass elbows and a tee fitting |
| Electrical | a coil of copper wire, a modular switch plate and a miniature circuit breaker |
| Lighting | three pendant lights hanging at different heights, switched on |
| Sanitaryware | a wall-mounted basin and a chrome mixer tap |
| Water Proofing | a bucket of grey waterproofing compound with a notched trowel |
| Solar | a monocrystalline solar panel at an angle catching a warm reflection |
| Safety | a yellow hard hat, safety goggles and a pair of work gloves |

Run all 35 in one session so the light never drifts. If one comes back weak,
regenerate that one *immediately* with the same settings rather than later.

---

## 5. The grade pass (do not skip this)

No generator will land on `#06181D` reliably. Getting the set to actually match
takes two minutes per image in Lightroom, Photoshop, Affinity or GIMP:

1. **Crush the blacks.** Curves: lift the black point until the darkest area
   reads about `#06181D`, not pure black. Pull the shadow end of the curve down
   and slightly toward cyan.
2. **Split-tone.** Shadows → hue ~190°, saturation ~18. Highlights → hue ~40°,
   saturation ~12. This is the whole teal-and-amber look in one control.
3. **Desaturate the midtones** by about 10, so only the practical lights carry
   colour.
4. **Add grain** — ~12 amount, ~25 size. Kills banding on 8-bit displays and is
   most of why a dark interface reads as a material rather than a fill.
5. **Export** as WebP quality 82 at 2560px wide (hero: 3840px). Then run the
   image through the store's existing srcset ladder — do not ship a single
   4K PNG to a phone.

A CSS-only fallback if you would rather not touch a photo editor — it gets you
most of the way and costs nothing:

```css
.plate img {
  filter: brightness(0.72) contrast(1.14) saturate(0.82);
}
.plate::after {          /* the teal/amber split-tone, faked in one layer */
  content: "";
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgb(6 24 29 / 62%), rgb(6 24 29 / 20%) 46%, rgb(6 24 29 / 88%));
  mix-blend-mode: multiply;
}
```

---

## 6. Rejecting a bad one

Throw it away and regenerate if any of these are true — all of them are common
failure modes on this brief, and every one of them reads as fake to a customer
in Vijayawada who has been looking at these houses their whole life:

- The roof is pitched, tiled or shingled.
- There is no parapet, no mumty, or no water tank on the terrace.
- The windows have no chajja above them, or no grills.
- The house sits directly on the ground with no plinth.
- There is a lawn with a sprinkler, a picket fence, or a garage door.
- Any lettering appeared anywhere, in any language.
- The midtones are bright grey-blue — that is the model ignoring the grade
  block, and no amount of post will fully fix it.
