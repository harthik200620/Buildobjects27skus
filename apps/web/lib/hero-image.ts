/**
 * Which of a product's photographs leads.
 *
 * The pipeline fills a gallery to five frames and writes a drawn placeholder — a dark card
 * carrying the product's name and the words "Official image pending" — wherever it could not find
 * a real photograph. Nine of the twenty-seven stocked products have at least one, which is fine:
 * they sit at the end of the gallery where a reader who has scrolled that far can see for
 * themselves that the set is short.
 *
 * On one, `CCT-DAH-HDW1200TRQP`, the placeholder is at position 1. Position 1 is the hero, so that
 * card was the product's face on the CCTV category page, in every search result, and at the top of
 * its own product page — a tile that says "Official image pending" in a shop, next to four real
 * photographs of the camera that were already on disk and simply ordered behind it.
 *
 * So: a placeholder is never the hero while a real frame exists. That is the rule, and it is
 * defensive rather than cosmetic — the pipeline can order images however it likes and the
 * storefront still leads with a photograph.
 */
import type { SkuImageView } from './catalog';

/**
 * Role preference, once placeholders are out of the way.
 *
 * `hero` is what a brand shot for this purpose; `angle` is the same product from another side;
 * `detail` is a crop; `in_context` has a room in it, which makes a poor thumbnail; and
 * `pack_or_dimensions` is a line drawing. That order is the order a picture editor would pick in.
 */
const ROLE_RANK: Record<string, number> = { hero: 0, angle: 1, detail: 2, in_context: 3, pack_or_dimensions: 4 };

/**
 * Products whose role labels are wrong in the source data, and cannot be repaired by any rule.
 *
 * `CCT-DAH-HDW1200TRQP` is a HAC-HDW1200TRQ, which is a TURRET — an "eyeball" — camera. Its five
 * frames are labelled hero/angle/in_context/detail/pack, and of them only the one labelled
 * `detail` is a turret at all: the `angle` frame is a bullet camera, a different body style
 * entirely, and its alt text describes an eyeball while showing one. So the role order above would
 * replace a placeholder with a photograph of the wrong product, which is a worse failure than the
 * placeholder it fixes — it looks correct.
 *
 * This is a catalogue defect and belongs upstream in the image pipeline, not here. Until it is
 * fixed there, this one line stops the storefront misrepresenting the product. It is a list of
 * exceptions and it should stay short; if it grows, the pipeline is what needs the work.
 */
const ROLE_OVERRIDE: Record<string, number> = {
  'CCT-DAH-HDW1200TRQP': 4,
};

/**
 * The gallery, reordered so it leads with a real photograph.
 *
 * Everything is kept — a placeholder still appears, just never first — because a five-frame
 * gallery that silently becomes a four-frame one hides how thin the set is. Order is otherwise
 * untouched, so the sequence a reader arrows through is the one the pipeline intended.
 */
export function leadWithRealPhoto(skuCode: string, images: SkuImageView[]): SkuImageView[] {
  if (images.length < 2 || !images[0]?.placeholder) return images;

  const forced = ROLE_OVERRIDE[skuCode.toUpperCase()];
  const lead =
    (forced !== undefined ? images.find((i) => i.position === forced && !i.placeholder) : undefined) ??
    [...images].filter((i) => !i.placeholder).sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || a.position - b.position)[0];

  if (!lead) return images;
  return [lead, ...images.filter((i) => i !== lead)];
}

/**
 * The same correction, applied to a search document's `hero_image_key`.
 *
 * A card, a search hit and the home page's stock panel do not carry a gallery — they carry one
 * key, chosen when the product was indexed. Re-deriving it would mean reading the image rows for
 * every hit on every listing page, so this rewrites the position segment of the key instead:
 * `skus/81/CCT-DAH-HDW1200TRQP/img/1-card.webp` becomes `…/4-card.webp`, and every rendition
 * (thumb, card, gallery, zoom) of position 4 already exists beside it.
 *
 * Keyed off the same ROLE_OVERRIDE, so the gallery and the card cannot disagree about which
 * photograph is this product's face.
 */
export function correctHeroKey(skuCode: string, key: string | null): string | null {
  if (!key) return key;
  const position = ROLE_OVERRIDE[skuCode.toUpperCase()];
  if (position === undefined) return key;
  return key.replace(/\/img\/\d+-/, `/img/${position}-`);
}
