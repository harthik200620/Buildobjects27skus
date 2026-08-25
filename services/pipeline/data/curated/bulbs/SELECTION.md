# Bulbs (BUL) — brand, domain and SKU selection

Category `bulbs`, code `BUL`, GST 12 %, HSN 8539. Registry is **not** written for this category —
the attribute keys come from the calendar sheet key list in `AGENT_BRIEF.md` plus the mandatory keys.
Research date: **2026-08-22**. Target for all three: the brand's hero **9 W B22 LED bulb**.

---

## 1. Philips (Signify) — `PHI`

**Official Indian domain (confirmed manufacturer, not a marketplace):**
`lighting.philips.co.in` — Signify's Indian Philips-lighting site. Signify N.V. is the company that
was spun off from Royal Philips in 2016 and still makes lamps under the Philips brand
(<https://en.wikipedia.org/wiki/Signify_N.V.>). Its Indian D2C store `in.shop.lighting.philips.com`
is the same manufacturer, and its asset host is `assets.signify.com`. None of these is a marketplace.

**SKU chosen:** Philips Ace Saver 9 W B22 LED Bulb, Cool Day Light — **12NC `929001198414`**
(EAN 8718696544167).

**URL used as the value source:**
<https://www.moglix.com/philips-ace-saver-9w-cool-day-white-round-b22-led-bulb-929001198414/mp/msn19z2n111353>

**Why this SKU:** Ace Saver is Philips India's volume 9 W B22 household bulb — the model an AP/TS
buyer actually asks for by name — and `929001198414` is a real Philips 12NC still listed at retail,
not an invented code. The listing carries Philips India Ltd's own manufacturer and packer block
(Philips India Ltd, PO Manpura, Nalagarh, Distt. Solan, HP 174101), which anchors the model to the
manufacturer.

**Why the source is a retailer and not the brand page (per brief §"How to work"):** Signify has
retired the Ace Saver's individual page from every Philips India property. Verified, not assumed:

* the consumer bulbs sitemap
  (`.../consumer/sitemap-b2c-philips-lighting-in-product-product_sitemap_PHC_BULBS_CA_en_IN.xml`)
  now lists **10** bulb pages, none of them a 9 W B22;
* `.../consumer/p/led-bulb/8718696544167` and the Signify PSS datasheet
  `assets.signify.com/is/content/PhilipsLighting/8718696544167-pss-en_in` both return **404**;
* the whole Philips India D2C catalogue (`in.shop.lighting.philips.com/products.json`, 311 products,
  read in full) contains **no** Ace Saver at all — its only 9 W B22 items are the Smart Wi-Fi Pro
  bulb (915006602301) and the Motion Sensing bulb (929003546414), neither of which is the category's
  hero general-lighting bulb;
* the Indian professional catalogue (`signify.com/en-in/prof/led-lamps-and-tubes`) has no
  "LED bulbs" sub-category at all.

`sources.official_product_url` therefore points at the live Philips India LED-bulb range page on the
manufacturer's domain, and the Moglix listing that the values were actually read on is recorded in
`secondary_urls` and on every `fetched` attribute.

**Known gap:** Signify's Scene7 host answers 200 for any asset name, but every rendition for this EAN
resolves to the "transparent 10×10" placeholder (confirmed by downloading and viewing it), so there
is **no official Philips image**. Only one image (Moglix CDN, 800 × 800) is supplied; four roles are
`null`. No datasheet PDF exists any more.

---

## 2. Havells — `HAV`

**Official Indian domain (confirmed manufacturer, not a marketplace):**
`havells.com` — Havells India Limited's own site (Havells India Limited is an Indian electrical
equipment manufacturer based in Noida, <https://en.wikipedia.org/wiki/Havells>). The product page
carries "Manufactured By Havells India Ltd." and the site's own product-spec tables.

**SKU chosen:** Havells LED Plus 9 W B22 CDL Lamp V7 — **`LHLDDDBNL5R009`**

**URL:**
<https://havells.com/lighting/led-lamps/led-plus-9-w-b22-cdl-lamp-v7-lhldddbnl5r009.html>

**Why this SKU:** it is the best-documented 9 W B22 lamp of any of the three brands — the
manufacturer's own page publishes a complete engineering spec table (849 lm, 94.44 lm/W, PF ≥ 0.90,
THD < 33 %, 140–270 V withstand, 4 kV surge, 3.75 kV isolation, 15 000 h F50 L70, 7 500 switching
cycles, IP20, 0.048 kg net, BEE 1 Star, MRP ₹150), plus seven 1200 × 1200 official images. Havells
markets this lamp under its **Adore+** LED-bulb identity (the brief's suggested Havells hero); the
`Adore` name on `havells.com` alone resolves to 2.8 W ball/candle lamps, and the "Adore Plus 9 W B22
3-Star" pack only appears on a staging host, so the LED Plus V7 is the correct live 9 W B22 hero.

---

## 3. Wipro Lighting — `WIP`

**Official Indian domain (confirmed manufacturer, not a marketplace):**
`wiproconsumerlighting.com` — Wipro Consumer Lighting, the D2C store of Wipro Enterprises (P) Ltd
(Wipro Enterprises Private Limited, the 2013 demerger of Wipro Ltd's non-IT businesses, lists
lighting among its sectors, <https://en.wikipedia.org/wiki/Wipro_Enterprises>). Store vendor field
reads "Wipro Consumer Lighting"; carton artwork on the same store carries "WIPRO ENTERPRISES (P) LTD,
Doddakannelli, Sarjapur Road, Bangalore 560035; manufactured at E-25 UPSIDC Industrial Area, Selaqui,
Dehradun 248011". `wiprolighting.com` is the professional/luminaire arm of the same company.

**SKU chosen:** Wipro Garnet LED Bulb, B22 / Cool Day White / 9 W — **`N96101`**

**URL:**
<https://www.wiproconsumerlighting.com/products/garnet/led-bulb/garnet-9w-led-bulb>

**Why this SKU:** Garnet is Wipro's mainstream household LED-bulb line and 9 W B22 Cool Day White is
its highest-volume node; `N96101` is the official store's own variant SKU (the E27 twin is `N96201`),
read from the store's public product feed together with MRP ₹240 / selling ₹65 and the product
images. The 9 W B22 CDL carton shot on that store states **900 lm** on the pack, which the Moglix
listing for the same 9 W Garnet independently confirms.

**Note on fetching:** the `www.` host of the Wipro store sits behind a Vercel security checkpoint and
returned HTTP 429 to both WebFetch attempts; the apex host answers 200, and the store's public
product feed (`wiproconsumerlighting.myshopify.com/products.json`, vendor "Wipro Consumer Lighting")
was used to read the variant, SKU, prices and image set. Specification values not exposed by that
feed were read on
<https://www.moglix.com/wipro-garnet-9w-900lm-cool-day-white-led-bulb-for-home-office-pc-077/mp/msng9vnm2wz6kp>
and on the official carton artwork (IS 16102 Part 1, 220–240 V AC 50 Hz, non-dimmable, indoor use).

---

## Cross-brand notes

* **No certificate numbers were recorded.** The Wipro carton artwork shows a BIS CRS registration
  number, but it belongs to the 5 W/7 W carton in that image, not to `N96101`, so only the *fact* of
  BIS registration and the standard string `IS 16102 (Part 1)` are stored.
* **`is_standard` = `IS 16102 (Part 1)`** for all three (self-ballasted LED lamps for general
  lighting, > 50 V). Read on the Wipro carton; `ai_filled` for Philips and Havells, whose pages state
  only "BIS, BEE".
* **HSN 8539 / GST 12 %** for all three, per the category contract.
* **Price provenance:** Havells and Philips prices are `fetched` from listings that were opened;
  Wipro's MRP ₹240 agrees between the official store feed and Moglix.
