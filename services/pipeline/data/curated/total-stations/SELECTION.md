# Total stations (TST) — SKU selection

Category `total-stations`, code `TST`, unit `piece`, GST 18%, HSN 9015.
Governing references: **ISO 17123-3** (angle accuracy) and **ISO 17123-4** (EDM accuracy) test
procedures, **IEC 60825-1:2014** laser safety classes, **IEC 60529** ingress protection.
Selected 2026-08-23 for the Andhra Pradesh / Telangana market.

All three picks are **2-second manual (mechanical) total stations** — the accuracy class that
AP/Telangana engineering tenders and mid-size survey firms specify most often — so the three
SKUs compare like-for-like on the PDP compare engine (angular accuracy, EDM accuracy,
reflectorless and prism range, magnification, battery life, IP rating, weight).

---

## Leica Geosystems — `leica-geosystems.com`

**Domain confirmed as manufacturer.** The TS07 product page and its datasheets are published by
Leica Geosystems AG, Heinrich-Wild-Strasse, 9435 Heerbrugg, Switzerland ("part of Hexagon AB"),
with Hexagon branding in the page footer and the datasheets served from Leica's own Sitecore
media library and Hexagon's download blob. Not a marketplace.

- **SKU chosen:** FlexLine **TS07 2" R500** — `TST-LEI-TS07-2-R500`
- **URL:** https://leica-geosystems.com/products/total-stations/manual-total-stations/leica-flexline-ts07
- **Datasheet:** https://leica-geosystems.com/-/media/files/leicageosystems/products/datasheets/leica%20flexline%20ts07%200221%20en-in%20lr.pdf (EN-IN edition, 02.21)
- **Why this one:** The TS07 is the mainstream FlexLine model between the entry TS03 and the
  TS10, and the only one of the three with an India-specific (EN-IN) datasheet on the official
  site. That datasheet is unusually complete — accuracy classes (1"–7"), compensator setting
  accuracy and range, prism/reflectorless ranges and accuracies, telescope, display, memory,
  interfaces, battery life, laser class, IP66, temperature range and weight — so almost every
  registry attribute is `fetched`. The 2" R500 variant is the configuration that dominates
  IndiaMART dealer listings (Chennai, Delhi, Ahmedabad, Coimbatore) and government tenders; the
  2" listing opened for pricing is the Chennai 4D Survey Instruments listing.

## Trimble — `geospatial.trimble.com`

**Domain confirmed as manufacturer.** `geospatial.trimble.com` is Trimble Inc.'s own geospatial
division site (Westminster, Colorado): the C5 page is Contentful-hosted under Trimble's account,
links to Trimble's TRL DocuShare document library for the user guide, and closes with "Contact
your local Trimble Authorized Distribution Partner". Not a marketplace.

- **SKU chosen:** **Trimble C5 2"** (time-of-flight EDM, autofocus) — `TST-TRI-C5-2`
- **URL:** https://geospatial.trimble.com/en/products/hardware/trimble-c5
- **Datasheet / manual:** Trimble datasheet PN 022516-482B (04/20) — the copy on
  geospatial.trimble.com returned HTTP 503 on every attempt, so the identical Trimble document
  hosted by authorised dealer Duncan-Parnell is cited
  (https://www.duncan-parnell.com/customer/docs/skudocs/trimble-c5-datasheet-www-duncan-parnell-com-.pdf);
  the official C5 user guide v3.0 rev C (Sept 2025) from trl.trimble.com is the second source.
- **Why this one:** The C5 is the only current Trimble *mechanical* total station family (the
  C3 was retired); the C5 HP is a phase-shift variant without autofocus. The standard C5 is what
  Trimble's Indian distribution partners list (Allterra, Gurugram; Pune; Noida; Nagpur). The
  official page itself states the headline specs (1"/2"/3"/5", 2 mm + 2 ppm prism, 3 mm + 2 ppm
  DR, 5,000 m / 800 m, dual-axis, −20 to +50 °C, 4.3 kg, two colour touchscreens, Trimble Access)
  and the datasheet and user guide fill the rest, which lets most numbers be `verified` against
  two documents. 2" is chosen to match the Leica and Topcon picks.

## Topcon — `topconpositioning.com`

**Domain confirmed as manufacturer.** `topconpositioning.com` is the corporate site of Topcon
Positioning Systems, Inc. (Topcon Corporation, Tokyo): it hosts the product brochures in
Topcon's digital-asset hub, the ISO 9001:2015 certificate and the company's legal terms. Not a
marketplace.

- **SKU chosen:** **Topcon GM-52** (GM-50 Series, 2", dual display, laser plummet) — `TST-TOP-GM-52`
- **URL:** https://www.topconpositioning.com/gb/total-stations/manual-total-stations/gm-50
  (resolves to the GB "manual total stations" page, which lists the GM-50 Series with its
  comparison specs: 2"/5", 4,000 m prism, 500 m reflectorless, IP66)
- **Brochure / manual:** official brochure 7010-2251 C (09/25)
  https://www.topconpositioning.com/content/dam/topcon_digital_asset_hub/collateral/brochures/topcon_gm-50-series_7010-2251_enUS23broc.pdf
  and the Topcon GM-50 series instruction manual 1025821-01-A (Top Basic edition) — Topcon
  Japan's own download link is a script page that cannot be fetched directly, so the identical
  manual hosted by a Topcon dealer is cited
  (https://geoconstrucciones.com.gt/assets/images/solutions/Manual_GM50_tb_e_a.pdf).
- **Why this one:** The GM-50 Series is Topcon's entry/mainstream manual total station and the
  GM-52 (2") is by far the most-listed Topcon instrument on IndiaMART (Delhi, Bengaluru, Gaya,
  Roorkee) — the default first total station for small survey firms and engineering colleges in
  AP/Telangana. The brochure gives the marketing specs; the instruction manual's chapter 24
  gives the full table (telescope, encoder, tilt sensor, EDM ranges and accuracies by target,
  memory, Bluetooth, BDC46C battery, laser plummet, IP66, temperature, size and weight), and an
  authorised Indian dealer page (Skipper Technologies) plus the IndiaMART listing agree on the
  key figures, so most of them are `verified`.

---

## Known gaps (carried into the SKU files as `ai_filled` or noted in `note` fields)

- **Dimensions.** Leica publishes no W × H × D for the TS07, so `dim_*` are `ai_filled`
  (confidence 0.45). Trimble's 206 × 169 × 318 mm and Topcon's 183 × 181 × 348 mm are the
  published figures (Topcon's "with handle", dual-display model) — neither states whether the
  tribrach is included, so they are stored as published.
- **Weight.** Leica states 4.3–4.5 kg for the TS07 depending on configuration; 4.3 kg is stored.
  Trimble's 4.3 kg is the main unit (batteries 0.1 kg each). Topcon's 5.1 kg is with handle and
  battery.
- **Country of origin.** None of the three documents carries a "made in" statement. Trimble's
  user guide declares Nikon-Trimble Co., Ltd., Tokyo as manufacturer (stored as `fetched`,
  confidence 0.75); Leica and Topcon are `ai_filled` at ≤ 0.5 and must be confirmed on the
  unit label.
- **Leica included/optional flags.** The datasheet marks Bluetooth / WLAN / face-II keyboard
  with included/optional symbols that do not survive text extraction; Bluetooth is stored as
  included (confidence 0.8), WLAN and the LTE side cover as optional.
- **Topcon battery life.** The brochure's "14 hours" is the EDM-eco figure in the manual; normal
  fine-mode operation is about 10 h. 14 h is stored in `battery_operating_time_h`, the 10 h
  figure in `battery_type`.
- **Images.** Leica's official media library offers only 800 × 428 carousel renditions plus the
  2480 × 750 key visual (hero); Trimble's Contentful originals are 370–800 px and are cited
  through Contentful's `?w=…&fit=scale` renditions (1440–1600 px, upscaled); Topcon's only
  GM-50-specific official image is 400 × 500 px, the angle image is a 447 px dealer photo and the
  in-context / detail shots are Topcon's 1920 × 960 family photographs of GM-series instruments.
  No pack or dimension drawings exist for any of the three.
- **Warranty.** Leica and Topcon 12 months come from the Indian listings opened; Trimble's 12
  months is `ai_filled`. Extended-warranty availability is `ai_filled` for all three.
- **Prices** are `fetched` from the single IndiaMART listing opened per brand (Leica 2" —
  Chennai, ₹4.70 lakh excl. GST; Trimble C5 — Allterra Gurugram, ₹8.25 lakh, accuracy class not
  stated; Topcon GM-52 — Delhi, ₹3.95 lakh). Ranges seen across other Indian listings are given
  in each `price.note`.
- No BIS/ISI licence, calibration-certificate or test-report numbers were published anywhere,
  so none are recorded; `calibration_certificate_supplied` is `ai_filled` true for all three.
- Trimble's official logo is an inline SVG on the site, so `logo_url` is null for Trimble.
