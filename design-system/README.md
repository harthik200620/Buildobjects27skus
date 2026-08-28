# design-system/

The visual source the storefront was built from, and the only place a value in it is authoritative
over the code.

```
north-star/   the seven artboards. Open the .dc.html files in a browser.
art/          the seven photographic backplates, their generation prompts and MANIFEST.md
icons/        the icon set, as exported
tokens.css    the token layer, as designed
```

**Order of authority:** an artboard beats a description of one; `packages/ui/src/theme.css` beats
everything here, because it is what actually ships. When the two disagree, the stylesheet is the
truth and this folder is out of date.

`art/MANIFEST.md` says which plate is which, what is in each, and what is still open against them —
`components/Plate.tsx` points readers at it.
