# design-system/

The visual spec for the Build Objects storefront rebuild.

```
UI_UPGRADE_PROMPT.md   ← paste this into Claude Code. Start here.
tokens.css             ← replaces the @theme static block in packages/ui/src/theme.css
icons/icons.tsx        ← replaces apps/web/components/icons.tsx (93 icons, same export names)
north-star/            ← the seven artboards. Open the .dc.html files in a browser.
art/                   ← iso-house.svg, fetch-art.mjs, ART_PROMPTS.md
```

**Order of authority:** an artboard beats the prompt; the prompt beats your
judgement; `tokens.css` beats a value written anywhere else.

Kept from the current store: the `#06181D` canvas, Audiowide as the wordmark,
Encode Sans for figures, and all the copy. Everything else is new.
