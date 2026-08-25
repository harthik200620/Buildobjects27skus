# 3D assets

One GLB per SKU, metres, Y up, standing on y = 0 and centred on x / z, front facing +Z, at the SKU's real dimensions.

- `placeholders/{SKU_CODE}.glb` — generated parametric models (`pnpm assets:3d`). `quality: 'textured'` when they wear the SKU's photo cut-outs, `'placeholder'` when flat-coloured; `placeholder: true` either way.
- `{SKU_CODE}.glb` — a photoreal model (`pnpm assets:3d:photoreal`, Meshy / Tripo, normalised to true dimensions) or a brand model dropped in by hand. Re-run `pnpm assets:3d`; the manifest flips to `placeholder: false`, `quality: 'photoreal'`, and the web app serves it at `/3d/{SKU_CODE}.glb` with zero code change.
- `jobs.json` / `photoreal-report.json` — provider job ledger (never pays twice for the same inputs) and the last run's outcomes.
- USDZ for iOS Quick Look is exported client-side from the GLB on demand unless a `{SKU_CODE}.usdz` is listed.
