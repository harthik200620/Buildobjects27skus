'use client';

import type { Placement, PlacementRule, ProductDims, Surface } from '@buildobjects/ar-engine';
import { alphaMask, MAX_SIDE, type PixelRect } from '../photo';
import type { CoverMap } from './coverMap';
import type { SceneRenderer } from './SceneRenderer';

/**
 * "Make it real" inputs from the live camera: freeze the visible crop of the video (≤ 1600 px),
 * render the model pass to the same size through the same pixel-exact camera, build the overlay
 * (frame + contact shadow + model), and the silhouette mask from the model's alpha (> 8,
 * dilated 2 px) with the contact shadow at 50 % — then hand everything to the shared runner.
 */
export interface CameraComposite {
  photo: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  modelPass: HTMLCanvasElement;
  /** The model's rectangle in `photo` px. */
  rect: PixelRect;
  placement: Placement;
  /** `photo` px per stage CSS px. */
  scale: number;
}

/** The visible crop of the video as a canvas no larger than `maxSide` on its long edge. */
export function freezeFrame(video: HTMLVideoElement, map: CoverMap, maxSide = MAX_SIDE): { canvas: HTMLCanvasElement; scale: number } | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const k = Math.min(1, maxSide / Math.max(map.cw, map.ch));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(map.cw * k));
  canvas.height = Math.max(1, Math.round(map.ch * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, map.x0, map.y0, map.cw, map.ch, 0, 0, canvas.width, canvas.height);
  // photo px per stage px: the stage shows cw video px over w css px; the photo shows cw video px over canvas.width px
  return { canvas, scale: canvas.width / map.w };
}

const FLOOR_LIKE: Surface[] = ['floor', 'ground', 'table', 'roof'];

export interface BuildCompositeArgs {
  video: HTMLVideoElement;
  map: CoverMap;
  renderer: SceneRenderer;
  surface: Surface;
  yawDeg: number;
  dims: ProductDims;
  rule: PlacementRule;
  lightDirection: 'left' | 'right' | 'top' | 'front' | 'unknown';
}

export function buildCameraComposite(args: BuildCompositeArgs): CameraComposite | null {
  const frozen = freezeFrame(args.video, args.map);
  if (!frozen) return null;
  const { canvas: photo, scale } = frozen;
  const bounds = args.renderer.screenBounds();
  if (!bounds) return null;
  const pass = args.renderer.modelPass(photo.width, photo.height);
  if (!pass) return null;
  const rect: PixelRect = {
    x: bounds.x * scale,
    y: bounds.y * scale,
    w: Math.max(4, bounds.w * scale),
    h: Math.max(4, bounds.h * scale),
    cx: (bounds.x + bounds.w / 2) * scale,
    cy: (bounds.y + bounds.h / 2) * scale,
    rot: 0,
  };
  const onFloor = FLOOR_LIKE.includes(args.surface);
  const lightX = args.lightDirection === 'left' ? 1 : args.lightDirection === 'right' ? -1 : 0;

  // overlay = frame + contact shadow (floor items) + model
  const overlay = document.createElement('canvas');
  overlay.width = photo.width;
  overlay.height = photo.height;
  const octx = overlay.getContext('2d')!;
  octx.drawImage(photo, 0, 0);
  if (onFloor) {
    const sy = rect.y + rect.h - rect.h * 0.02;
    const g = octx.createRadialGradient(rect.cx, sy, 0, rect.cx, sy, rect.w * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,.42)');
    g.addColorStop(0.55, 'rgba(0,0,0,.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = g;
    octx.beginPath();
    octx.ellipse(rect.cx + lightX * rect.w * 0.08, sy, rect.w * 0.7, Math.max(6, rect.h * 0.09), 0, 0, Math.PI * 2);
    octx.fill();
  }
  octx.drawImage(pass, 0, 0);

  // mask = model silhouette (alpha > 8, dilated 2 px) + the contact shadow at 50 %
  const mask = alphaMask(pass, { threshold: 8, dilatePx: 2 });
  if (onFloor) {
    const mctx = mask.getContext('2d')!;
    const sy = rect.y + rect.h - rect.h * 0.02;
    mctx.save();
    mctx.globalAlpha = 0.5;
    mctx.fillStyle = '#fff';
    mctx.beginPath();
    mctx.ellipse(rect.cx + lightX * rect.w * 0.08, sy, rect.w * 0.7, Math.max(6, rect.h * 0.09), 0, 0, Math.PI * 2);
    mctx.fill();
    mctx.restore();
  }

  const W = photo.width,
    H = photo.height;
  const anchorY = args.rule.anchor === 'top' ? rect.y : args.rule.anchor === 'center' || args.rule.anchor === 'back' ? rect.cy : rect.y + rect.h;
  const placement: Placement = {
    surface: args.surface,
    x: rect.cx / W,
    y: anchorY / H,
    w: rect.w / W,
    h: rect.h / H,
    rotationDeg: args.yawDeg,
    depth: 1,
    mmPerPxHere: args.dims.h_mm / Math.max(1, rect.h),
  };
  return { photo, overlay, mask, modelPass: pass, rect, placement, scale };
}
