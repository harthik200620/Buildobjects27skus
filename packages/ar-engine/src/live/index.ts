/**
 * Live-camera tier C helpers — pure maths, no DOM. The web layer (`apps/web/components/ar/camera/*`)
 * adapts the browser APIs (getUserMedia, DeviceOrientation, canvas) and feeds these.
 */

export * from './anchor';
export * from './budget';
export * from './camera-math';
export * from './fit';
export * from './hysteresis';
export * from './lk';
export * from './plane';
export * from './pose';
export * from './smoothing';
export * from './tracking';
