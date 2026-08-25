# CCTV (CCT) — SKU selection

Category `cctv`, code `CCT`, unit `piece`, GST 18%, HSN 8525.
Governing Indian safety reference for cameras under BIS CRS: **IS 13252 (Part 1) / IEC 62368-1**
(no registration, licence or certificate numbers were read anywhere, so none are recorded).
Selected 2026-08-23 for the Andhra Pradesh / Telangana market.

The India volume hero in this category is still the **2 MP-class HD analogue (4-in-1 TVI/AHD/CVI/CVBS)
fixed-lens camera** — the unit an AP/Telangana shop, house or godown buyer wires to a DVR. All three
picks are that product: one turret with audio, one quick-install eyeball, one dual-light bullet. They
share signal type, lens class, resolution class and 12 V DC power, so they compare cleanly on the PDP
compare engine while covering the three body shapes buyers ask for.

---

## Hikvision — `hikvisionindia.com`

**Domain confirmed as manufacturer.** The About page describes Hikvision India's own "Make-in-India"
manufacturing facility (over 9 lakh sq ft near Mumbai, a stated capacity of 8 lakh cameras a month,
850 of the 3,000 Hikvision products built locally), a careers section and a partner programme; product
pages are served from `/products/camera-products/…` with Hikvision's own spec tables. Not a marketplace.
The global parent site `hikvision.com` hosts the model's datasheet PDF on `assets.hikvision.com`.

- **SKU chosen:** **DS-2CE76D0T-ITPFS** — 2 MP Audio Indoor Fixed Turret Camera, Turbo HD Value Series, 3.6 mm lens
- **URL:** https://www.hikvisionindia.com/products/camera-products/value-series/ds-2ce76d0t-itpfs/
- **Datasheet:** https://assets.hikvision.com/prd/public/all/doc/m000006905/DS-2CE76D0T-ITPFS_Datasheet_20230807.pdf
- **Why this one:** It is the long-running Hikvision India best-seller in the 2 MP analogue class —
  the "2 MP dome with mic" every Hyderabad installer quotes — and it is listed live on page 2 of the
  India site's Value Series. It is also the best-documented: the India page carries the full spec
  table (sensor, 1080p, 3.6 mm FOV, 20 m IR, 12 V DC / 2.7 W, 84.6 × 78.9 mm, 140.5 g, −40…60 °C) and
  the global datasheet PDF confirms every value. The audio-over-coax microphone is the feature that
  separates it from the cheaper DS-2CE5AD0T/DS-2CE1AD0T value models. Note: the older
  `/product-detail/ds-2ce76d0t-itpfs` URL still in search indexes returns 404; the live page is the
  one above.

## Dahua — `dahuasecurity.com`

**Domain confirmed as manufacturer.** Every page is titled "Zhejiang Dahua Technology Co., Ltd."; the
product page hosts, on Dahua's own `material`/`materialfile` CDN, the S6 datasheet, the HDCVI camera
user manual, the eyeball installation guide, a dimension drawing and two 4000 × 4000 px product
renders. Not a marketplace.

- **SKU chosen:** **HAC-HDW1200TRQ** (S6 version) — 2MP IR HDCVI Fixed-focal Eyeball Camera, Lite Series; ordering code DH-HAC-HDW1200TRQP (PAL), 3.6 mm lens
- **URL:** https://www.dahuasecurity.com/products/All-Products/HDCVI-Cameras/Lite-Series/1080P/1080-P/HAC-HDW1200TRQ(-A)=S6
- **Datasheet:** https://materialfile.dahuasecurity.com/uploads/cpq/prm-os-srv-res/smart/datasheetzipfiles/HAC-HDW1200TRQ(-A)_S6_datasheet_20230324.pdf
- **Why this one:** The HDW1200TRQ "quick-to-install" eyeball is Dahua's highest-volume 2 MP HDCVI
  camera in India and the current (S6, 2023) version is still a live listing with the richest official
  documentation of any Dahua Lite model: full spec table on the page, a three-page datasheet with DORI
  distances, user manual, installation guide, dimension PDF and high-resolution renders. 30 m smart IR
  and a pedestal that screws straight to the surface are its selling points. It is an IP50 (dust-only)
  indoor/sheltered camera; the base TRQP has no microphone (the "-A" variant adds one).

## CP PLUS — `cpplusworld.com`

**Domain confirmed as manufacturer.** The About page states the brand is headquartered in Delhi-NCR
with a manufacturing facility in Kadapa, Andhra Pradesh, producing 2.5 million devices a month; the
datasheet footer reads "CP PLUS (Aditya Infotech Ltd.), F-28 Okhla Industrial Area, Phase 1, New Delhi";
the site hosts its own datasheets, user manuals and the AIL Service Warranty Policy. Not a marketplace.

- **SKU chosen:** **CP-USC-TA24L2C-L** — 2.4MP Dual Light Bullet Camera – 20Mtr. (Illumax range, Cosmic bullet body), 3.6 mm lens
- **URL:** https://cpplusworld.com/cp-usc-ta24l2c-l
- **Datasheet:** https://cpplusworld.com/prodassets/datasheet/CP-USC-TA24L2C-L.pdf
- **Why this one:** The 2.4 MP Cosmic bullet (CP-USC-TA24L2) has been CP PLUS's best-selling camera
  in South India for years; the `C-L` dual-light (IR + warm white light, built-in mic, IP67) version is
  its live successor — the original `cp-usc-da24l2`, `cp-usc-ta24l2` and `-v5` pages now redirect to the
  site's 404 handler, and the C-L bullet was the only 2.4 MP Cosmic-body page found live. It is fully
  documented on the manufacturer's own site: a 40-row spec table embedded in the page, a five-page
  datasheet with dimension drawing, a user manual, and the AIL warranty policy that fixes the
  24-month carry-in term. "Made in Bharat" (Kadapa plant) matters to AP buyers.

---

## Known gaps (carried into the SKU files as `ai_filled` / `estimated`, or omitted)

- **Images.** Hikvision India publishes one 800 × 800 px official render; the two ≥ 1000 px images
  used are Hikvision renders hosted by the Amazon.in listing (marked in the alt text). Dahua has two
  official 4000 px renders (front and 45°) and nothing in-context. CP PLUS publishes only 400 × 520 px
  and 280 × 200 px renditions; the in-context image is CP PLUS's own Illumax poster hosted by the
  IndiaMART listing. No pack-shot or dimension image exists for any of the three, so those roles are
  `null` (dimension drawings are attached as PDFs for Dahua and within the CP PLUS datasheet).
- **Prices.** Hikvision `fetched` (Amazon.in ₹1,249 opened 2026-08-23; MRP ₹3,999 from the Moglix
  listing). CP PLUS `fetched` (IndiaMART ₹1,230/piece; CP PLUS shows MRP 0 on its site, so `mrp` is
  null). Dahua `estimated` — Flipkart blocked the fetch and Moglix lists only the HAC-T1A21-U; the
  figure is the typical Hyderabad dealer rate, ±15%.
- **Hikvision datasheet host.** `assets.hikvision.com` answers 403 to requests without a browser
  User-Agent and 200 `application/pdf` (522,031 bytes) with one; the PDF was downloaded and parsed,
  so it is marked `checked: true`, but the pipeline fetcher must send a browser User-Agent for it.
- **BIS CRS.** No registration status or number was read on any page; `bis_crs_registered` is
  omitted for all three SKUs.
- **IP rating enum.** Dahua's IP50 is not in the registry enum; `ip_rating` is mapped to
  "Not rated (indoor)" as `ai_filled` (0.7) and the exact IP50 statement is kept in
  `weatherproof_sealing_process` and `ingress_protection_test` as `fetched`.
- **WDR (dB) and bit rate.** None of the three publishes a WDR figure (all are "DWDR"), and bit rate
  does not apply to analogue output — `wdr_db` and `max_bitrate_mbps` are omitted.
- **Warranty.** CP PLUS 24 months is `fetched` from Annexure A of the AIL Service Warranty Policy
  (HDCVI/analogue cameras, carry-in). Hikvision and Dahua do not publish a per-model term;
  24 months is `ai_filled` (Moglix shows "1 Year" for the Hikvision unit).
- **Brand intel.** CP PLUS `year_established` (2007) is `ai_filled`: the About page says only
  "18 Years of Reforming a Secure India" and The Org profile dates the parent Aditya Infotech Ltd to
  1994. Hikvision and Dahua founding years and parents are `fetched` from Wikipedia.
- **Country of origin.** Hikvision "India" is `fetched` from the Moglix listing; CP PLUS "India" from
  the "Made in Bharat" Illumax poster; Dahua "China" is `ai_filled`.
- **Audio.** The Dahua base model (TRQP) has no microphone; `audio_support` = "None". Buyers who
  need audio should be offered the HAC-HDW1200TRQ-A variant.
