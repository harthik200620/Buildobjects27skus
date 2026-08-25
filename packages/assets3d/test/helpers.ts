import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SpecJson } from '@buildobjects/catalog';
import sharp from 'sharp';
import { buildGlb, type Material, type MeshData } from '../src/gltf';
import { box } from '../src/shapes';

export const FLAT: Material = { name: 'flat', color: [0.5, 0.5, 0.5, 1], metallic: 0, roughness: 0.8 };

/** A solid-colour PNG (RGBA). */
export async function pngSolid(w: number, h: number, rgba: [number, number, number, number] = [200, 30, 30, 255]): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: rgba[0], g: rgba[1], b: rgba[2], alpha: rgba[3] / 255 } } })
    .png()
    .toBuffer();
}

/** A "studio photo": white canvas with a coloured rectangle (no alpha), like a hero original. */
export async function studioPhoto(
  w = 200,
  h = 200,
  rect = { left: 50, top: 40, width: 100, height: 120 },
  rgb: [number, number, number] = [200, 30, 30],
): Promise<Buffer> {
  const inner = await sharp({ create: { width: rect.width, height: rect.height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: inner, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();
}

/** An RGBA mask: transparent canvas with opaque rectangles. */
export async function maskPng(w: number, h: number, rects: { left: number; top: number; width: number; height: number }[]): Promise<Buffer> {
  const layers = await Promise.all(
    rects.map(async (r) => ({
      input: await sharp({ create: { width: r.width, height: r.height, channels: 4, background: { r: 120, g: 120, b: 120, alpha: 1 } } })
        .png()
        .toBuffer(),
      left: r.left,
      top: r.top,
    })),
  );
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
}

export function glbOf(meshes: MeshData[], name = 'test'): Buffer {
  return buildGlb(meshes, name).glb;
}

/** A box GLB with the given extents (metres), centred at `c`. */
export function boxGlb(w: number, h: number, d: number, c: [number, number, number] = [0, h / 2, 0]): Buffer {
  return glbOf([box(w, h, d, c, FLAT)]);
}

/**
 * An L-shaped model: main slab 0.2 × 0.1 × 0.05 standing on y = 0, plus a 0.05 × 0.05 arm at the
 * top on the +x side (`armSide = 'right'`, as seen from +Z) or the −x side (`'left'`).
 */
export function lShapeGlb(armSide: 'right' | 'left'): Buffer {
  const main = box(0.2, 0.1, 0.05, [0, 0.05, 0], FLAT);
  const ax = armSide === 'right' ? 0.125 : -0.125;
  const arm = box(0.05, 0.05, 0.05, [ax, 0.075, 0], { ...FLAT, name: 'arm' });
  return glbOf([main, arm]);
}

/** The hero cut-out that matches `lShapeGlb('right')` seen from the front: 250 × 100 with the arm top-right. */
export function lShapeMask(): Promise<Buffer> {
  return maskPng(270, 120, [
    { left: 10, top: 10, width: 200, height: 100 },
    { left: 210, top: 10, width: 50, height: 50 },
  ]);
}

export function specWithDims(w: number, h: number, d: number): SpecJson {
  const row = (key: string, value: number) => ({
    key,
    label: key,
    value,
    unit: 'mm',
    data_type: 'number',
    provenance: 'verified',
    confidence: 1,
    source_url: null,
    compare: false,
  });
  return {
    groups: [{ key: 'dims', label: 'Dimensions', importance: 1, rows: [row('dim_w_mm', w), row('dim_h_mm', h), row('dim_d_mm', d)] }],
    filled: 3,
    total: 3,
    by_provenance: { fetched: 0, verified: 3, ai_filled: 0 },
  } as unknown as SpecJson;
}

export function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bo-assets3d-${prefix}-`));
}

export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const bytesResponse = (buf: Buffer, status = 200) => new Response(new Uint8Array(buf), { status });
