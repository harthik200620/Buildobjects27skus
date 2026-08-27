'use client';

import { type Anchor, laysFlat, type PlacementRule, type ProductDims, type Quat, type SceneAnalysis, type Vec3 } from '@buildobjects/ar-engine';
import type { DirectionalLight, Group, HemisphereLight, Mesh, Object3D, PerspectiveCamera, PointLight, Scene, WebGLRenderer } from 'three';
import { applyViewOffset, type CoverMap } from './coverMap';
import { normalizeModel, orientForSurface, type ThreeNS } from './orient';

/**
 * The three.js side of tier C: one transparent WebGL canvas over the video, a pixel-exact
 * camera (`applyViewOffset` over the cover crop), the GLB at true scale in a holder the engine's
 * anchor positions, RoomEnvironment IBL with hemisphere + directional lights steered by the
 * scene analysis, a contact-shadow plane for floor items and an emissive + warm point light for
 * bulbs. `modelPass()` renders the model alone (transparent background) for "Make it real".
 * three.js is loaded on demand; nothing here runs on the server.
 */
export type RendererLighting = SceneAnalysis['lighting'];

export interface SceneRendererOptions {
  glbUrl: string | null;
  rule: PlacementRule;
  dims: ProductDims;
  category: string;
  dprMax?: number;
}

const LIGHT_DIRECTION: Record<RendererLighting['direction'], [number, number, number]> = {
  left: [-2.5, 3, 1.5],
  right: [2.5, 3, 1.5],
  top: [0, 4, 0.5],
  front: [0, 2.5, 3],
  unknown: [-1.5, 3, 2],
};

export class SceneRenderer {
  readonly webgl: boolean;
  readonly hasModel: boolean;
  readonly modelSize: { x: number; y: number; z: number };
  readonly modelNote: string | null;
  private map: CoverMap | null = null;
  private visible = false;
  private disposed = false;
  private dprMax: number;
  /* The drawing-buffer size actually in force, so `setSize` can do nothing when nothing changed. */
  private sizeW = 0;
  private sizeH = 0;
  private sizeDpr = 0;
  /* Scratch geometry for `screenBounds`, kept off the per-frame allocation path. */
  private boundsBox: import('three').Box3 | null = null;
  private boundsPoint: import('three').Vector3 | null = null;
  private boundsView: import('three').Vector3 | null = null;
  private boundsStamp = '';

  private constructor(
    readonly THREE: ThreeNS,
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly holder: Group,
    /** Holds the product alone, so a flat-laid product turns without taking the shadow with it. */
    private readonly tilt: Group,
    private readonly model: Object3D | null,
    private readonly lights: { hemi: HemisphereLight; key: DirectionalLight; bulb: PointLight | null },
    private readonly rule: PlacementRule,
    /** The SKU's stated dimensions — `laysFlat` reads them to decide whether it turns down. */
    private readonly dims: ProductDims,
    size: { x: number; y: number; z: number },
    note: string | null,
    dprMax: number,
  ) {
    this.webgl = true;
    this.hasModel = !!model;
    this.modelSize = size;
    this.modelNote = note;
    this.dprMax = dprMax;
  }

  static async create(canvas: HTMLCanvasElement, opts: SceneRendererOptions): Promise<SceneRenderer> {
    const THREE = await import('three');
    const dprMax = opts.dprMax ?? 2;
    let renderer: WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      throw new Error(`WebGL is not available (${(e as Error).message})`);
    }
    renderer.setPixelRatio(Math.min(dprMax, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.02, 60);
    scene.add(camera);

    // Image-based lighting from the built-in room — enough for plastics, metals and glass to read as lit by a room.
    try {
      const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch {
      /* IBL is a nicety; the analytic lights still work */
    }

    const hemi = new THREE.HemisphereLight(0xfff8f0, 0x334155, 1.1);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(-1.5, 3.5, 2.5);
    scene.add(key);
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.75);
    fillLight.position.set(2.0, -1.0, 2.0);
    scene.add(fillLight);

    const holder = new THREE.Group();
    holder.visible = false;
    scene.add(holder);
    /*
     * The product, and only the product.
     *
     * A product that lies down (`laysFlat`) is turned a quarter turn about X, and turning the
     * HOLDER would take the contact shadow with it — a shadow standing vertically in the air,
     * which is worse than the upright tile it was meant to fix. The shadow stays on the holder and
     * is always flat on the surface; this group is what turns.
     */
    const tilt = new THREE.Group();
    holder.add(tilt);

    let model: Object3D | null = null;
    let size = { x: opts.dims.w_mm / 1000, y: opts.dims.h_mm / 1000, z: opts.dims.d_mm / 1000 };
    let note: string | null = null;
    let bulb: PointLight | null = null;
    let shadow: Mesh | null = null;

    if (opts.glbUrl) {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(opts.glbUrl);
      model = gltf.scene;
      const norm = normalizeModel(THREE, model, opts.rule, opts.dims);
      size = norm.size;
      note = norm.note;

      // Enhance model materials for photorealistic PBR rendering
      model.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const std = mat as {
            roughness?: number;
            metalness?: number;
            color?: { setHex?: (h: number) => void; r: number; g: number; b: number };
            name?: string;
            clearcoat?: number;
            clearcoatRoughness?: number;
          };
          // Diffuser dome
          if (std.name?.includes('diffuser') || std.name?.includes('glass')) {
            std.roughness = 0.16;
            std.metalness = 0.02;
            std.clearcoat = 0.45;
            std.clearcoatRoughness = 0.15;
          } else if (std.name?.includes('silver') || std.name?.includes('metal') || std.name?.includes('pin')) {
            std.roughness = 0.22;
            std.metalness = 0.95;
          } else if (std.name?.includes('housing') || std.name?.includes('plastic')) {
            std.roughness = 0.32;
            std.metalness = 0.05;
          }
        }
      });

      tilt.add(model);

      if (opts.category === 'bulbs') {
        // ── 1. Authentic White Wall Batten Holder Socket (matching photo) ─────────
        const socketGroup = new THREE.Group();
        const whitePolyMat = new THREE.MeshStandardMaterial({
          color: 0xf8fafc,
          roughness: 0.28,
          metalness: 0.05,
        });
        const screwMat = new THREE.MeshStandardMaterial({
          color: 0x64748b,
          roughness: 0.35,
          metalness: 0.85,
        });

        // A. Circular Wall Baseplate Flange (flush on the wall plane at y = 0)
        const baseGeo = new THREE.CylinderGeometry(0.034, 0.038, 0.007, 36);
        const baseMesh = new THREE.Mesh(baseGeo, whitePolyMat);
        baseMesh.position.set(0, 0.0035, 0);
        socketGroup.add(baseMesh);

        // B. 2 Wall Mounting Screws
        const screwGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.002, 12);
        const s1 = new THREE.Mesh(screwGeo, screwMat);
        s1.position.set(-0.024, 0.0075, 0);
        const s2 = new THREE.Mesh(screwGeo, screwMat);
        s2.position.set(0.024, 0.0075, 0);
        socketGroup.add(s1, s2);

        // C. Cylindrical Socket Body Collar (surrounding the B22 cap)
        const collarGeo = new THREE.CylinderGeometry(0.0165, 0.018, 0.02, 32);
        const collarMesh = new THREE.Mesh(collarGeo, whitePolyMat);
        collarMesh.position.set(0, 0.017, 0);
        socketGroup.add(collarMesh);

        tilt.add(socketGroup);

        // ── 2. Radiant Glowing Dome with Light Bloom ─────────────────────────────
        model.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            const std = mat as {
              name?: string;
              color?: { setHex?: (h: number) => void };
              emissive?: { setHex: (h: number) => void };
              emissiveIntensity?: number;
              roughness?: number;
              metalness?: number;
            };
            if (std.name?.includes('diffuser') || std.name?.includes('glass')) {
              if (std.emissive) {
                std.emissive.setHex(0xfffaed);
                std.emissiveIntensity = 1.6;
              }
              std.roughness = 0.12;
            }
          }
        });

        // ── 3. Soft Glowing Halo Bloom Sprite ──────────────────────────────────
        const haloCanvas = document.createElement('canvas');
        haloCanvas.width = haloCanvas.height = 256;
        const hctx = haloCanvas.getContext('2d')!;
        const hg = hctx.createRadialGradient(128, 128, 10, 128, 128, 128);
        hg.addColorStop(0, 'rgba(255, 255, 240, 0.7)');
        hg.addColorStop(0.35, 'rgba(255, 245, 210, 0.35)');
        hg.addColorStop(0.7, 'rgba(255, 235, 180, 0.1)');
        hg.addColorStop(1, 'rgba(255, 220, 150, 0)');
        hctx.fillStyle = hg;
        hctx.fillRect(0, 0, 256, 256);

        const haloTex = new THREE.CanvasTexture(haloCanvas);
        const haloMat = new THREE.SpriteMaterial({
          map: haloTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.85,
        });
        const haloSprite = new THREE.Sprite(haloMat);
        haloSprite.scale.set(size.x * 2.2, size.x * 2.2, 1);
        haloSprite.position.set(0, -size.y * 0.7, 0);
        holder.add(haloSprite);

        // ── 4. Warm Point Light Radiating Onto Wall and Room ───────────────────
        bulb = new THREE.PointLight(0xfff5e4, 2.8, 4.5, 1.6);
        bulb.position.set(0, -size.y * 0.6, 0);
        holder.add(bulb);
      }

      // ── Realistic Wall Contact Shadow Plane behind bulb base ──────────────
      const shadowCanvas = document.createElement('canvas');
      shadowCanvas.width = shadowCanvas.height = 512;
      const sctx = shadowCanvas.getContext('2d')!;
      const g = sctx.createRadialGradient(256, 256, 10, 256, 256, 256);
      g.addColorStop(0, 'rgba(0,0,0,.65)');
      g.addColorStop(0.3, 'rgba(0,0,0,.35)');
      g.addColorStop(0.65, 'rgba(0,0,0,.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 512, 512);

      const tex = new THREE.CanvasTexture(shadowCanvas);
      const ext = Math.max(size.x, size.z, size.y) * 1.5;
      const horizontal = !['wall', 'window'].includes(opts.rule.surfaces[0]) && opts.rule.orientation !== 'hanging' && opts.rule.anchor !== 'back';

      if (horizontal) {
        shadow = new THREE.Mesh(
          new THREE.PlaneGeometry(ext, ext).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 }),
        );
        shadow.position.y = 0.002;
      } else {
        // Wall contact shadow flush against the wall behind the bulb base
        shadow = new THREE.Mesh(
          new THREE.PlaneGeometry(ext, ext).rotateX(Math.PI / 2),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.82, side: THREE.DoubleSide }),
        );
        shadow.position.y = 0.001;
      }
      shadow.renderOrder = -1;
      holder.add(shadow);
    }
    return new SceneRenderer(THREE, renderer, scene, camera, holder, tilt, model, { hemi, key, bulb }, opts.rule, opts.dims, size, note, dprMax);
  }

  /**
   * Stage size in CSS px; the drawing buffer follows the device pixel ratio (<= dprMax).
   *
   * THE EARLY RETURN IS THE WHOLE POINT. The render loop calls this every frame, and it used to do
   * the work every frame: `setPixelRatio` re-runs `setSize` internally, so each frame performed TWO
   * full resizes, and a resize assigns `canvas.width` / `canvas.height`, which reallocates and
   * clears the WebGL drawing buffer. Reallocating a full-screen backbuffer 120 times a second is
   * the single most expensive thing this view did, and the size it was setting had not changed
   * since the frame before.
   */
  setSize(w: number, h: number): void {
    if (this.disposed) return;
    const dpr = Math.min(this.dprMax, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(w));
    const ch = Math.max(1, Math.round(h));
    if (cw === this.sizeW && ch === this.sizeH && dpr === this.sizeDpr) return;
    this.sizeW = cw;
    this.sizeH = ch;
    this.sizeDpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cw, ch, false);
  }

  /** Pixel-exact camera: the cover crop of the W × H frame with the intrinsics' vertical FOV, the pose quaternion and the camera height. */
  setCamera(map: CoverMap, fovYDeg: number, q: Quat, C: Vec3): void {
    if (this.disposed) return;
    this.map = map;
    applyViewOffset(this.camera, map, fovYDeg);
    this.camera.position.set(C.x, C.y, C.z);
    this.camera.quaternion.set(q.x, q.y, q.z, q.w);
    this.camera.updateMatrixWorld(true);
  }

  /** Put the holder at the engine's anchor. Screen anchors (no world geometry) hide the model. */
  setAnchor(anchor: Anchor | null, yawDeg: number): void {
    if (this.disposed) return;
    const { THREE, holder, rule } = this;
    if (!anchor || anchor.kind === 'screen') {
      holder.visible = false;
      return;
    }
    holder.position.set(anchor.P.x, anchor.P.y, anchor.P.z);
    if (anchor.kind === 'horizontal') {
      const normal = anchor.surface === 'ceiling' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);
      holder.quaternion.copy(orientForSurface(THREE, anchor.surface, normal, rule));
      holder.rotateY((yawDeg * Math.PI) / 180);
      /*
       * LAY IT DOWN, IF IT IS SUPPOSED TO LIE DOWN.
       *
       * `orientation: 'flat'` was declared on tiles, solar panels and cement from the day the rules
       * table was written, and nothing ever acted on it — so a 1.2 m floor tile stood on its long
       * edge and a 2.28 m solar module stood upright on a roof. Both were unmistakable from
       * directly above, which is the angle you hold a phone at to look at a floor.
       *
       * A quarter turn about X puts the stated height along the surface; the model then straddles
       * the plane, so it is lifted by half its new standing height to rest on it. Applied here
       * rather than in `normalizeModel` because it depends on the SURFACE, and the surface changes
       * while the view is open — a tile is flat on the floor and upright on a wall.
       */
      if (laysFlat(rule, anchor.surface, this.dims)) {
        this.tilt.rotation.set(-Math.PI / 2, 0, 0);
        /* Turned down, the model straddles the plane; half its new standing height rests it on. */
        this.tilt.position.set(0, this.modelSize.z / 2, 0);
      } else {
        this.tilt.rotation.set(0, 0, 0);
        this.tilt.position.set(0, 0, 0);
      }
      if (rule.mountOffsetMm) holder.position.addScaledVector(normal, rule.mountOffsetMm / 1000);
    } else {
      /* Upright on a wall, whatever it does on a floor: a tile is flat underfoot and vertical on
         a splashback, and the same renderer draws both while the surface changes underneath it. */
      this.tilt.rotation.set(0, 0, 0);
      this.tilt.position.set(0, 0, 0);
      const normal = new THREE.Vector3(anchor.n.x, anchor.n.y, anchor.n.z);
      holder.quaternion.copy(orientForSurface(THREE, anchor.surface, normal, rule));
      holder.rotateY((yawDeg * Math.PI) / 180);
      if (rule.mountOffsetMm) holder.position.addScaledVector(normal, rule.mountOffsetMm / 1000);
    }
    holder.visible = this.visible && this.hasModel;
    holder.updateMatrixWorld(true);
  }

  /** Auto-visibility: scale the model so its on-wall footprint reads at a usable pixel size, while it
   *  stays anchored to the wall point. 1 = true 1:1 metres; the placement math uses the same
   *  multiplier so the "mm" label stays honest relative to the enlarged view. */
  setScale(mult: number): void {
    if (this.disposed || !this.model) return;
    this.holder.scale.setScalar(Math.max(0.2, Math.min(6, mult)));
    this.holder.updateMatrixWorld(true);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.holder.visible = v && this.hasModel && this.holder.position.lengthSq() >= 0;
  }

  /** Steer the analytic lights by the scene analysis (direction / warmth / brightness). */
  setLighting(l: RendererLighting): void {
    if (this.disposed) return;
    try {
      const { hemi, key, bulb } = this.lights;
      const [x, y, z] = LIGHT_DIRECTION[l.direction] ?? LIGHT_DIRECTION.unknown;
      key.position.set(x, y, z);
      const warm = l.warm ? 0xfff1dc : 0xffffff;
      key.color.setHex(warm);
      const b = Math.max(0.15, Math.min(1, l.brightness));
      key.intensity = 0.8 + 1.6 * b;
      hemi.intensity = 0.5 + 0.9 * b;
      hemi.color.setHex(l.warm ? 0xfff4e6 : 0xffffff);
      if (bulb) bulb.intensity = l.brightness < 0.45 ? 1.6 : 1.0;
    } catch {
      /* ignore */
    }
  }

  render(): void {
    if (this.disposed) return;
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      /* ignore */
    }
  }

  /** The model's projected bounding box in stage px (null when hidden or entirely behind the camera). */
  screenBounds(): { x: number; y: number; w: number; h: number } | null {
    if (this.disposed || !this.holder.visible || !this.model || !this.map) return null;
    const { THREE } = this;
    /*
     * Scratch objects, reused. This used to allocate a Box3, walk the model to rebuild it, and
     * clone a Vector3 inside a triple-nested loop — ten allocations and a full traverse per call,
     * on the render loop's hot path. The box is rebuilt only when the model's world matrix has
     * actually changed, which is when something moved it.
     */
    this.boundsBox ??= new THREE.Box3();
    this.boundsPoint ??= new THREE.Vector3();
    this.boundsView ??= new THREE.Vector3();
    const stamp = this.model.matrixWorld.elements.join(',');
    if (stamp !== this.boundsStamp) {
      this.boundsStamp = stamp;
      this.boundsBox.setFromObject(this.model);
    }
    const box = this.boundsBox;
    if (box.isEmpty()) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      behind = 0;
    const p = this.boundsPoint;
    const view = this.boundsView;
    for (const cx of [box.min.x, box.max.x])
      for (const cy of [box.min.y, box.max.y])
        for (const cz of [box.min.z, box.max.z]) {
          p.set(cx, cy, cz);
          view.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
          if (view.z > -1e-4) {
            behind++;
            continue;
          }
          p.project(this.camera);
          const sx = ((p.x + 1) / 2) * this.map.w,
            sy = ((1 - p.y) / 2) * this.map.h;
          minX = Math.min(minX, sx);
          maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy);
          maxY = Math.max(maxY, sy);
        }
    if (behind === 8 || !Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /**
   * Render the model alone to an offscreen target (transparent background) at w × h px with
   * the current camera — the same crop, so it overlays the freeze frame pixel for pixel.
   */
  modelPass(w: number, h: number): HTMLCanvasElement | null {
    if (this.disposed || !this.holder.visible) return null;
    const { THREE, renderer, scene, camera } = this;
    const W = Math.max(1, Math.round(w)),
      H = Math.max(1, Math.round(h));
    const target = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, stencilBuffer: false });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const prevTarget = renderer.getRenderTarget();
    const prevPixelRatio = renderer.getPixelRatio();
    const prevSize = new THREE.Vector2();
    renderer.getSize(prevSize);
    const pixels = new Uint8Array(W * H * 4);
    try {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setPixelRatio(prevPixelRatio);
      renderer.setSize(prevSize.x, prevSize.y, false);
      target.dispose();
    }
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(W, H);
    // GL rows run bottom-up; un-premultiply the alpha the blend left in the colour channels.
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4,
        dst = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) {
        const a = pixels[src + x + 3];
        if (a === 0) continue;
        const k = 255 / a;
        img.data[dst + x] = Math.min(255, pixels[src + x] * k);
        img.data[dst + x + 1] = Math.min(255, pixels[src + x + 1] * k);
        img.data[dst + x + 2] = Math.min(255, pixels[src + x + 2] * k);
        img.data[dst + x + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.geometry?.dispose?.();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) (mat as { dispose?: () => void })?.dispose?.();
        }
      });
      this.scene.environment?.dispose?.();
      this.renderer.dispose();
    } catch {
      /* ignore */
    }
  }
}
