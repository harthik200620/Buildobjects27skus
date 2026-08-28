'use client';

import type { Orientation } from '@buildobjects/ar-engine';
import { addRoomEnvironment } from './three-env';

/**
 * Renders a GLB to a transparent PNG canvas, cropped to the product's projected bounding box,
 * from a yaw / elevation that suits the placement orientation. The crop is what makes true
 * scale work: the canvas edges ARE the product's facing bounding box, so stretching it to the
 * placement rectangle (computed from real dimensions) keeps proportions honest.
 */
export interface ProductRender {
  canvas: HTMLCanvasElement;
  aspect: number;
  bbox: { x: number; y: number; z: number };
}

const cache = new Map<string, Promise<ProductRender>>();

export function renderGlb(url: string, opts: { yawDeg: number; orientation: Orientation; size?: number }): Promise<ProductRender> {
  const key = `${url}|${Math.round(opts.yawDeg)}|${opts.orientation}|${opts.size ?? 1024}`;
  if (!cache.has(key))
    cache.set(
      key,
      doRender(url, opts).catch((e) => {
        cache.delete(key);
        throw e;
      }),
    );
  return cache.get(key)!;
}

async function doRender(url: string, opts: { yawDeg: number; orientation: Orientation; size?: number }): Promise<ProductRender> {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const size = opts.size ?? 1024;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Photoreal pipeline: ACES filmic tone mapping + an image-based environment so PBR
  // materials (chrome B22 cap, frosted polycarbonate dome) pick up real reflections
  // instead of reading as a flat white blob.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  await addRoomEnvironment(THREE, scene, renderer);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
  key.position.set(-2, 3, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 1.0);
  fill.position.set(2, 1, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(0, 2, -3);
  scene.add(rim);

  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  // Rescue degenerate PBR exports: some providers (Meshy) mark the whole product metallic=1
  // roughness=1 with a single material, so a frosted plastic dome renders as ghost metal.
  // Fix the classic broken case (near-full metal on a pale base texture) back to a dielectric —
  // true metals keep their value; the env map supplies reflections either way.
  model.traverse((o) => {
    const mesh = o as unknown as { isMesh: boolean; material?: unknown };
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const pbr = mat as { metalness?: number; roughness?: number; color?: { r: number; g: number; b: number } };
      if (typeof pbr.metalness === 'number' && pbr.metalness >= 0.9 && typeof pbr.roughness === 'number' && pbr.roughness >= 0.9) {
        let bright = true;
        if (pbr.color) {
          const c = pbr.color;
          bright = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.5;
        }
        if (bright) {
          pbr.metalness = 0.05;
          pbr.roughness = 0.35;
        }
      }
    }
  });
  // stand on y = 0, centre x / z (the generator already does this; real GLBs may not)
  const box0 = new THREE.Box3().setFromObject(model);
  model.position.set(-(box0.min.x + box0.max.x) / 2, -box0.min.y, -(box0.min.z + box0.max.z) / 2);
  const group = new THREE.Group();
  group.add(model);
  // Orient the product relative to the placement surface so it
  // reads as a real 3D object, never a flat sprite.
  //  - wall_flush (bulbs, cctv): the product's long axis points OUT of the wall toward the room;
  //    the camera views it at a slight 3/4 angle so you SEE the length (neck + cap receding to
  //    the wall, dome in front) instead of a head-on disc.
  //  - hanging (ceiling bulb): cap up, dome down, viewed slightly from below.
  //  - flat: lies as built on the floor.
  if (opts.orientation === 'hanging') {
    group.rotation.z = Math.PI;
  } else if (opts.orientation === 'wall_flush') {
    group.rotation.x = Math.PI / 2;
  } // +Y (length) → +Z (out of wall), cap base toward wall
  else if (opts.orientation === 'ceiling_flush') {
    group.rotation.x = Math.PI;
  } else if (opts.orientation === 'flat') {
    /* lies on the floor as built */
  }
  group.rotation.y += (opts.yawDeg * Math.PI) / 180;
  scene.add(group);

  const box = new THREE.Box3().setFromObject(group);
  const sizeV = new THREE.Vector3();
  box.getSize(sizeV);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const maxDim = Math.max(sizeV.x, sizeV.y, sizeV.z) || 1;
  const fov = 34;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 100);
  const dist = (maxDim / 2 / Math.tan((fov * Math.PI) / 360)) * 1.5;
  // 3/4 perspective: offset the camera in azimuth AND elevation so the protruding product's
  // side profile and depth are visible (the whole point of a wall-mounted 3D lamp).
  const e =
    opts.orientation === 'flat'
      ? { az: 0.6, el: 0.62 }
      : opts.orientation === 'hanging'
        ? { az: 0.3, el: -0.28 }
        : opts.orientation === 'ceiling_flush'
          ? { az: 0.3, el: 0.5 }
          : opts.orientation === 'wall_flush'
            ? { az: 1.05, el: 0.18 } // strong 3/4: a wall lamp reads as a bulb protruding out, dome toward viewer, neck+cap receding
            : { az: 0.5, el: 0.24 };
  camera.position.set(center.x + dist * Math.sin(e.az) * Math.cos(e.el), center.y + dist * Math.sin(e.el), center.z + dist * Math.cos(e.az) * Math.cos(e.el));
  camera.lookAt(center);
  camera.updateMatrixWorld();
  renderer.render(scene, camera);

  // project the 8 bbox corners to find the crop
  let minX = size,
    minY = size,
    maxX = 0,
    maxY = 0;
  for (const cx of [box.min.x, box.max.x])
    for (const cy of [box.min.y, box.max.y])
      for (const cz of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(cx, cy, cz).project(camera);
        const sx = ((p.x + 1) / 2) * size,
          sy = ((1 - p.y) / 2) * size;
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
  // tighten to actual non-transparent pixels inside that box
  const full = document.createElement('canvas');
  full.width = size;
  full.height = size;
  full.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
  const data = full.getContext('2d')!.getImageData(0, 0, size, size).data;
  let tMinX = size,
    tMinY = size,
    tMaxX = 0,
    tMaxY = 0;
  for (let y = Math.max(0, Math.floor(minY)); y < Math.min(size, Math.ceil(maxY)); y++)
    for (let x = Math.max(0, Math.floor(minX)); x < Math.min(size, Math.ceil(maxX)); x++) {
      if (data[(y * size + x) * 4 + 3] > 8) {
        if (x < tMinX) tMinX = x;
        if (x > tMaxX) tMaxX = x;
        if (y < tMinY) tMinY = y;
        if (y > tMaxY) tMaxY = y;
      }
    }
  if (tMaxX <= tMinX || tMaxY <= tMinY) {
    tMinX = Math.floor(minX);
    tMaxX = Math.ceil(maxX);
    tMinY = Math.floor(minY);
    tMaxY = Math.ceil(maxY);
  }
  const out = document.createElement('canvas');
  out.width = tMaxX - tMinX + 1;
  out.height = tMaxY - tMinY + 1;
  out.getContext('2d')!.drawImage(full, tMinX, tMinY, out.width, out.height, 0, 0, out.width, out.height);
  renderer.dispose();
  renderer.forceContextLoss();
  return { canvas: out, aspect: out.width / out.height, bbox: { x: sizeV.x, y: sizeV.y, z: sizeV.z } };
}
