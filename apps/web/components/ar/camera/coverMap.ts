/**
 * The `object-fit: cover` map between the video frame (W × H video px) and the stage (w × h CSS
 * px). The stage shows the centred crop (x0, y0, cw, ch) of the frame scaled by k; every pixel
 * conversion in the HUD goes through these two functions, and `applyViewOffset` makes the
 * three.js camera render exactly that crop so the model lands on the same pixels as the maths.
 * Pure — no DOM.
 */
export interface CoverMap {
  /** Video frame size, video px. */
  W: number;
  H: number;
  /** Stage size, CSS px. */
  w: number;
  h: number;
  /** CSS px per video px. */
  k: number;
  /** The visible crop of the frame, video px (origin top-left). */
  x0: number;
  y0: number;
  cw: number;
  ch: number;
}

export function coverMap(W: number, H: number, w: number, h: number): CoverMap {
  const safeW = Math.max(1, W),
    safeH = Math.max(1, H),
    sw = Math.max(1, w),
    sh = Math.max(1, h);
  const k = Math.max(sw / safeW, sh / safeH);
  const cw = sw / k,
    ch = sh / k;
  return { W: safeW, H: safeH, w: sw, h: sh, k, x0: (safeW - cw) / 2, y0: (safeH - ch) / 2, cw, ch };
}

/** Stage CSS px → video px. */
export const stageToVideo = (m: CoverMap, x: number, y: number): { u: number; v: number } => ({ u: x / m.k + m.x0, v: y / m.k + m.y0 });

/** The minimal three.js camera surface this module needs (avoids a static `three` import). */
export interface ViewOffsetCamera {
  aspect: number;
  fov: number;
  setViewOffset(fullWidth: number, fullHeight: number, x: number, y: number, width: number, height: number): void;
  clearViewOffset(): void;
  updateProjectionMatrix(): void;
}

/**
 * Pixel-exact camera: the full frame is W × H with the vertical FOV of the pinhole intrinsics
 * (three uses the vertical FOV and `aspect` for the horizontal one, which reproduces fx = fy and
 * a centred principal point), and the sub-frustum is the cover crop — so the canvas, sized to
 * the stage, shows exactly the pixels the video shows.
 */
export function applyViewOffset(camera: ViewOffsetCamera, m: CoverMap, fovYDeg: number): void {
  camera.aspect = m.W / m.H;
  camera.fov = fovYDeg;
  camera.setViewOffset(m.W, m.H, m.x0, m.y0, m.cw, m.ch);
  camera.updateProjectionMatrix();
}
