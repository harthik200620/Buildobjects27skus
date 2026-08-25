/**
 * The Build Objects theme as literals, for the places CSS cannot reach: the WebGL thread colour
 * of the stitched logo, canvas/SVG fills in generated media, chart series. Every value mirrors
 * `@theme` in theme.css exactly — change both or neither; `pnpm --filter @buildobjects/web contrast`
 * checks the CSS side against WCAG.
 */
export const THEME = {
  ink: '#0f1111',
  ink2: '#565959',
  ink3: '#6f7373',
  canvas: '#ffffff',
  canvas2: '#f7f8f8',
  surface: '#ffffff',
  surface2: '#f7f8f8',
  surface3: '#eef1f1',
  line: '#d5d9d9',
  line2: '#e7e9e9',
  lineStrong: '#888c8c',
  /** The logo mark's real teal. A fill colour only — 1.79:1 on white, never text. */
  brand: '#56d3d8',
  onBrand: '#062028',
  teal50: '#e6f5f6',
  teal100: '#d9f1f2',
  teal600: '#14919a',
  /** Links, primary buttons, focus rings, active states — 4.96:1 on white. */
  teal700: '#0f7c84',
  teal800: '#0b6b73',
  teal900: '#085a61',
  header: '#0b2a30',
  header2: '#0f3a42',
  headerInk: '#ffffff',
  headerInk2: '#b8d4d8',
  success: '#007600',
  successBg: '#eaf6ea',
  warn: '#8a4b00',
  warnBg: '#fff4e5',
  danger: '#b12704',
  dangerBg: '#fdecea',
  /**
   * Twelve series colours for the cost donut and any multi-series figure, each ≥ 3:1 on white
   * and distinguishable from its neighbours: teal leads, then the deep header teal, then a
   * rotation of saturated darks with the neutral ink-2 in the middle.
   */
  series: ['#0f7c84', '#0b2a30', '#b45309', '#1d4ed8', '#6d28d9', '#be185d', '#4d7c0f', '#0369a1', '#9a3412', '#565959', '#14919a', '#7c2d12'],
} as const;

/**
 * @deprecated Transition alias for code still importing the v1 name (components/estimate/Donut.tsx
 * reads `.series`). Remove once every importer reads THEME.
 */
export const PATINA = {
  abyss: THEME.canvas2,
  canvas: THEME.canvas,
  ink: THEME.ink,
  ink2: THEME.ink2,
  ink3: THEME.ink3,
  accent: THEME.teal700,
  series: THEME.series,
} as const;
