# Refused models

Generated models that are not the product. They are kept — not deleted — because each one is
evidence of how it went wrong, and because deleting them would invite the pipeline to regenerate
the same thing from the same photograph and call it new.

`../review.json` says why each is here, one entry per file. Nothing in this directory is staged:
`stage-media.mts` picks only top-level `.glb` files, so the store serves the parametric model
built at the SKU's real dimensions instead.

To bring one back, fix its source photograph first, regenerate it, look at the result, and then
remove its entry from `review.json` — in that order. A file moved back with the entry left behind
is refused again by `buildOne`, which is deliberate.
