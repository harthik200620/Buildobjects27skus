'use client';

import { LK_HEIGHT, LK_WIDTH, type LumaGrid, lumaFromRgba, lumaGridFromRgba } from '@buildobjects/ar-engine';
import React from 'react';

/**
 * The per-frame pump: `requestVideoFrameCallback` when the browser has it (one callback per
 * decoded frame), else requestAnimationFrame. Each frame is drawn into a 160×120 canvas and
 * turned into a luma byte array (≈ 1 ms) for the optical flow; every `gridEvery`-th frame also
 * yields the 16×16 luma grid the on-device analyser reads. Pauses while the page is hidden or
 * `paused` is set, and keeps an EMA of the frame rate.
 */
export interface FrameSample {
  t: number;
  index: number;
  /** Video frame size, video px. */
  W: number;
  H: number;
  /** 160×120 Rec. 709 luma of the whole frame. */
  luma: Uint8Array;
  /** The same frame's 16×16 luma/contrast grid, every `gridEvery`-th frame. */
  grid: LumaGrid | null;
  fps: number;
}

export interface FrameLoopOptions {
  gridEvery?: number;
  paused?: boolean;
}

export function useFrameLoop(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onFrame: (f: FrameSample) => void,
  opts: FrameLoopOptions = {},
): { fps: number } {
  const onFrameRef = React.useRef(onFrame);
  onFrameRef.current = onFrame;
  const pausedRef = React.useRef(!!opts.paused);
  pausedRef.current = !!opts.paused;
  const gridEvery = opts.gridEvery ?? 6;
  const [fps, setFps] = React.useState(0);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) return;
    const small = document.createElement('canvas');
    small.width = LK_WIDTH;
    small.height = LK_HEIGHT;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    let alive = true;
    let index = 0;
    let lastT = 0;
    let fpsEma = 0;
    let lastFpsPublish = 0;
    type RvfcVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { width: number; height: number }) => void) => number;
      cancelVideoFrameCallback?: (h: number) => void;
    };
    const rv = video as RvfcVideo;
    const useRvfc = typeof rv.requestVideoFrameCallback === 'function';
    let handle = 0;
    let hiddenWaiter: (() => void) | null = null;

    const schedule = () => {
      if (!alive) return;
      if (document.hidden) {
        hiddenWaiter = schedule;
        return;
      }
      handle = useRvfc ? rv.requestVideoFrameCallback!(tick) : requestAnimationFrame((t) => tick(t, { width: video.videoWidth, height: video.videoHeight }));
    };
    const tick = (now: number, meta: { width: number; height: number }) => {
      if (!alive) return;
      const W = meta.width || video.videoWidth,
        H = meta.height || video.videoHeight;
      if (pausedRef.current || !W || !H || video.readyState < 2) {
        schedule();
        return;
      }
      if (lastT) {
        const inst = 1000 / Math.max(1, now - lastT);
        fpsEma = fpsEma ? fpsEma + 0.1 * (inst - fpsEma) : inst;
      }
      lastT = now;
      try {
        ctx.drawImage(video, 0, 0, LK_WIDTH, LK_HEIGHT);
        const rgba = ctx.getImageData(0, 0, LK_WIDTH, LK_HEIGHT).data;
        const luma = lumaFromRgba(rgba, LK_WIDTH, LK_HEIGHT);
        const grid = index % gridEvery === 0 ? lumaGridFromRgba(rgba, LK_WIDTH, LK_HEIGHT) : null;
        onFrameRef.current({ t: now, index, W, H, luma, grid, fps: fpsEma });
      } catch {
        /* a frame can fail to draw right after a track swap — skip it */
      }
      index += 1;
      if (now - lastFpsPublish > 1000) {
        lastFpsPublish = now;
        setFps(Math.round(fpsEma));
      }
      schedule();
    };
    const onVisibility = () => {
      if (!document.hidden && hiddenWaiter) {
        const w = hiddenWaiter;
        hiddenWaiter = null;
        w();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      if (useRvfc) rv.cancelVideoFrameCallback?.(handle);
      else cancelAnimationFrame(handle);
    };
  }, [videoRef, enabled, gridEvery]);

  return { fps };
}
