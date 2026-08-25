#!/usr/bin/env python3
"""
Removes the fabricated attribute values from the curated files.

12,895 of the 15,080 attribute values across `data/curated/**.json` were the literal string
"Verified Industry Standard", and another 621 were "Certified Architectural Standard" sitting
under keys invented to hold them (`standards_and_certifications_parameter_#1` … `#23`). Every
one was stamped `provenance: "verified"` at `confidence: 0.98`.

None of it ever reached a page — the registry never defined those keys — but it made each file
five times larger than the facts in it, and committing it would put 12,895 values labelled
"verified" into the repository's history.

The real values are unaffected, and the workbook is the source for specifications now
(`from-sheet.ts`); what stays here is the fallback for a SKU the workbook has no column for,
plus price, images, documents, copy and brand intelligence, which the workbook never held.

Run:  python services/pipeline/tools/strip_placeholder_values.py [--dry-run]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CURATED = ROOT / "services" / "pipeline" / "data" / "curated"
REGISTRY = ROOT / "services" / "pipeline" / "registry"

PLACEHOLDERS = {
    "verified industry standard",
    "certified architectural standard",
    "not applicable",
    "n/a",
    "na",
    "tbd",
    "-",
    "",
}
# Keys that exist only to hold the second of those.
JUNK_KEY = re.compile(r"_parameter_#\d+$")


def is_placeholder(value: object) -> bool:
    return isinstance(value, str) and value.strip().lower() in PLACEHOLDERS


def registry_for(category: str) -> tuple[set[str], list[str]]:
    """The keys this category defines, and the eight the workbook marks as key specs."""
    attrs = json.loads((REGISTRY / f"{category}.json").read_text(encoding="utf-8"))["attributes"]
    return {a["key"] for a in attrs}, [a["key"] for a in attrs if a["show_in_key_specs"]]


def main() -> None:
    dry = "--dry-run" in sys.argv
    files = sorted(CURATED.glob("*/*.json"))
    removed = kept = orphans = resynced = 0
    before = after = 0

    for f in files:
        raw = f.read_text(encoding="utf-8")
        before += len(raw.encode("utf-8"))
        doc = json.loads(raw)
        attrs: dict = doc.get("attributes", {})
        defined, key_specs = registry_for(f.parent.name)

        clean = {}
        for key, leaf in attrs.items():
            value = leaf.get("value") if isinstance(leaf, dict) else leaf
            if JUNK_KEY.search(key) or is_placeholder(value):
                removed += 1
                continue
            # A key the registry does not define can never be written to the database, so a
            # value under it is unreachable however real it looks.
            if key not in defined:
                orphans += 1
                continue
            clean[key] = leaf
            kept += 1

        doc["attributes"] = clean

        # The workbook decides the key specs now. The list here is the ordering hint the
        # describe stage passes to seo.key_specs_order, and it still named `product_type`,
        # `grade` and `mix_ratio` — attributes that no longer exist.
        if doc.get("key_specs") != key_specs:
            doc["key_specs"] = key_specs
            resynced += 1
        out = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
        after += len(out.encode("utf-8"))
        if not dry:
            f.write_text(out, encoding="utf-8", newline="\n")
        print(f"  {doc['sku_code']:<28} {len(attrs):>4} → {len(clean):>3} attributes")

    verb = "would remove" if dry else "removed"
    print(f"\n{verb} {removed} fabricated values, kept {kept} real ones across {len(files)} files")
    print(f"{before / 1024 / 1024:.1f} MB → {after / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
