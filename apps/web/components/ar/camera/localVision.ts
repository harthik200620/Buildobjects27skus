'use client';

import { DEFAULT_CAMERA_HEIGHT_M, detectSurfaces, gridFromRgba, intrinsicsFor, pitchFromQuat, type Quat, type SceneAnalysis } from '@buildobjects/ar-engine';

/**
 * Scene understanding on the device, in the render loop, with no API key.
 *
 * The live camera used to depend on Gemini: every few seconds a JPEG went to /api/ar/analyze and
 * came back as JSON describing the surfaces. It worked, and it meant AR only ran for someone with
 * a key, a network and a budget — and it ran at whatever rate the budget allowed, so the product
 * lagged several seconds behind where the phone was actually pointed.
 *
 * This does the same job locally and continuously. One small canvas, one downsample, one pass of
 * segmentation (packages/ar-engine/src/vision), and the answer is available on the next frame.
 *
 * The costs are real and deliberate:
 *   · 96 × 72 pixels. Big enough that a wall is a region and small enough that the whole analysis
 *     is well under a millisecond. Surfaces are large things; resolution buys nothing here.
 *   · ~8 Hz, not 60. A room does not change sixty times a second, and the anchor is held by the
 *     tracker between analyses, not by re-detecting.
 *   · `willReadFrequently`, because the whole point of this canvas is getImageData.
 */

const ANALYSIS_W = 96;
const ANALYSIS_H = 72;
/** ~8 Hz. Faster buys no accuracy; slower is visible as lag when you swing the phone. */
const MIN_INTERVAL_MS = 120;

export interface LocalVision {
  /** Analyse now if enough time has passed; returns null when it was too soon or the frame was not ready. */
  step(video: HTMLVideoElement, q: Quat | null, now: number): SceneAnalysis | null;
  dispose(): void;
}

export function createLocalVision(): LocalVision {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let last = 0;

  const ensure = () => {
    if (ctx) return ctx;
    canvas = document.createElement('canvas');
    canvas.width = ANALYSIS_W;
    canvas.height = ANALYSIS_H;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    return ctx;
  };

  return {
    step(video, q, now) {
      if (now - last < MIN_INTERVAL_MS) return null;
      if (!video || video.readyState < 2 || !video.videoWidth) return null;
      const c = ensure();
      if (!c) return null;
      last = now;
      try {
        c.drawImage(video, 0, 0, ANALYSIS_W, ANALYSIS_H);
        const { data } = c.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H);
        const grid = gridFromRgba(data, ANALYSIS_W, ANALYSIS_H);
        /*
         * The intrinsics are for the FULL frame, because the horizon is a property of the lens and
         * the pose, not of the thumbnail we happen to analyse. Passing the 96×72 numbers here
         * would put the horizon in the wrong place by the ratio of the two heights.
         */
        const K = intrinsicsFor(video.videoWidth, video.videoHeight, 'phone');
        return detectSurfaces({
          grid,
          pitchDeg: q ? pitchFromQuat(q) : null,
          fy: K.fy,
          height: video.videoHeight,
          /* What turns the floor line into a wall distance. The same value the placement uses,
             so the two cannot disagree about how high the camera is. */
          cameraHeightM: DEFAULT_CAMERA_HEIGHT_M.phone,
        });
      } catch {
        /* A tainted canvas or a frame that vanished mid-draw: skip this tick, keep the last answer. */
        return null;
      }
    },
    dispose() {
      canvas = null;
      ctx = null;
    },
  };
}
