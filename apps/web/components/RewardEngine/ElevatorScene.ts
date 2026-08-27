'use client';

/**
 * THE BO LIFT — a real elevator, in WebGL.
 *
 * ── WHAT IT HAS TO SELL ─────────────────────────────────────────────────────────────────────
 * A reward you can see arriving. The coins sit in the car with the doors open; the doors close
 * over them; the car RIDES — shaft streaming past, floor plates flicking by, the indicator
 * counting; it decelerates, settles on its springs; and the doors part on what it brought back.
 *
 * The coins going out of sight is not a fade. The doors physically occlude them, which is the
 * only version of that idea a viewer believes, and it is free: the doors were going to close
 * anyway.
 *
 * ── WHY THE SHAFT MOVES AND THE CAR DOES NOT ────────────────────────────────────────────────
 * A camera in the lobby watching a lift go up sees nothing move — the doors are shut and the
 * frame is the frame. A camera riding with the car sees the shaft stream past, which is the shot
 * that reads. Rather than fly a camera up a mile of shaft, the car and camera hold still and the
 * SHAFT is what travels: identical on screen, and it means the geometry is a few metres tall
 * instead of a hundred, with the rungs recycled through it as they leave the frame.
 *
 * Which decides where every part belongs, and the first cut got it wrong. The DOOR FRAME rides
 * with the car, because the camera rides with the car — a landing's doorway only exists at a
 * landing, and one that hung in view for the whole journey would be the one thing on screen
 * insisting nothing was moving. And the shaft has to be VISIBLE, which means it cannot be behind
 * the car: from in front, the car occludes everything behind it, so the first cut rendered a
 * shaft nobody could ever see and a ride that looked like a still photograph of a closed door.
 * The shaft is at the SIDES now, either side of the car, with ribbed walls streaming down past it.
 *
 * ── THE PERFORMANCE CONTRACT ────────────────────────────────────────────────────────────────
 * The rule for the whole store is that nothing here may cost the site anything, so:
 *
 *   NO SHADOW MAPS. A shadow map is the single most expensive thing a scene this small can ask
 *   for. The contact under the coins is a painted radial plane and reads better anyway, because
 *   it can be exactly as soft as it should be.
 *   ONE ENVIRONMENT, GENERATED ONCE. RoomEnvironment through a PMREM, which is what makes brushed
 *   metal look like metal. It is built at 0.04 roughness and disposed with the scene.
 *   INSTANCED COINS. Sixty coins are one draw call and one geometry.
 *   THE LOOP STOPS. It runs while the panel is open and pauses the moment the tab is hidden;
 *   `dispose()` takes the context, the geometries, the materials and the PMREM with it.
 *   DPR CAPPED AT 2. Past that it is heat, not detail.
 *
 * Nothing here imports three at module scope — the whole scene arrives with the panel.
 */

type ThreeNS = typeof import('three');

/** Six landings, one per reward tier, in the order the lift passes them. */
export const FLOORS = [0, 20, 40, 60, 80, 100] as const;

export type RidePhase = 'idle' | 'closing' | 'rising' | 'settling' | 'opening' | 'open';

export interface RideCallbacks {
  /** The coins have just gone out of sight behind the doors. */
  onClosed?: () => void;
  /** The car has stopped and settled; the doors are about to part. */
  onArrived?: () => void;
  /** The doors are fully open on the reward. */
  onOpen?: () => void;
  /** Each floor plate as it passes, for the indicator and the tick. */
  onFloor?: (n: number) => void;
}

/** Every duration in the ride, in seconds, in one place so the whole thing can be re-timed. */
const T = {
  close: 1.0,
  /** How long the car is actually travelling. The distance is derived from this, not the reverse. */
  rise: 2.9,
  settle: 0.75,
  hold: 0.28,
  open: 1.1,
} as const;

const FLOOR_GAP = 3.4;
const CAR_W = 2.35;
const CAR_H = 2.75;
const CAR_D = 2.2;

/* Cubic in-out for the doors, and a spring for the settle. Written out rather than pulled in:
   two easings do not justify a dependency, and these two are the whole motion vocabulary. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
/** A lift does not stop dead: it overshoots by a few millimetres and comes back on its springs. */
const settleSpring = (t: number) => 1 - Math.cos(t * Math.PI * 3.2) * Math.exp(-t * 5.2) * (1 - t);

export class ElevatorScene {
  private raf = 0;
  private disposed = false;
  private phase: RidePhase = 'idle';
  private phaseT = 0;
  private cb: RideCallbacks = {};
  private targetFloor = 0;
  private passed = 0;
  private shaftY = 0;
  private doorGap = 1;
  private coinSpin = 0;
  private last = 0;
  private indicatorFloor = -1;
  private coinsPresent = -1;
  private scratch: {
    m: import('three').Matrix4;
    q: import('three').Quaternion;
    e: import('three').Euler;
    pos: import('three').Vector3;
    scl: import('three').Vector3;
  } | null = null;

  private constructor(
    private readonly THREE: ThreeNS,
    private readonly renderer: import('three').WebGLRenderer,
    private readonly scene: import('three').Scene,
    private readonly camera: import('three').PerspectiveCamera,
    private readonly host: HTMLElement,
    private readonly parts: {
      shaft: import('three').Group;
      doorL: import('three').Mesh;
      doorR: import('three').Mesh;
      coins: import('three').InstancedMesh;
      carLight: import('three').PointLight;
      indicator: import('three').Mesh;
      indicatorCanvas: HTMLCanvasElement;
      indicatorTex: import('three').CanvasTexture;
      disposables: Array<{ dispose: () => void }>;
    },
    private readonly reduced: boolean,
  ) {}

  static async mount(host: HTMLElement, reduced: boolean): Promise<ElevatorScene | null> {
    const THREE = await import('three');

    let renderer: import('three').WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      /* No WebGL. The caller falls back to the flat panel rather than showing a black box. */
      return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    /* Back far enough that the shaft shows either side of the frame. At 5.35 the doorway filled
       the picture edge to edge and there was nowhere for the journey to happen. */
    const camera = new THREE.PerspectiveCamera(42, Math.max(host.clientWidth / Math.max(host.clientHeight, 1), 0.2), 0.1, 200);
    camera.position.set(0, 0.1, 7.1);
    camera.lookAt(0, 0.02, 0);

    /* The environment is what makes brushed steel read as steel. One PMREM, built once. */
    const pmrem = new THREE.PMREMGenerator(renderer);
    const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();

    const disposables: Array<{ dispose: () => void }> = [envRT.texture];
    const keep = <O extends { dispose: () => void }>(o: O) => {
      disposables.push(o);
      return o;
    };

    /* ── materials ───────────────────────────────────────────────────────── */
    const steel = keep(new THREE.MeshStandardMaterial({ color: 0x9fb4b8, metalness: 0.94, roughness: 0.29 }));
    const steelDark = keep(new THREE.MeshStandardMaterial({ color: 0x51686e, metalness: 0.9, roughness: 0.42 }));
    const carWall = keep(new THREE.MeshStandardMaterial({ color: 0x123039, metalness: 0.55, roughness: 0.5 }));
    const carFloor = keep(new THREE.MeshStandardMaterial({ color: 0x0b1f26, metalness: 0.4, roughness: 0.65 }));
    const shaftWall = keep(new THREE.MeshStandardMaterial({ color: 0x081b21, metalness: 0.2, roughness: 0.9 }));
    const gold = keep(new THREE.MeshStandardMaterial({ color: 0xf0b23c, metalness: 1, roughness: 0.24, emissive: 0x2a1601, emissiveIntensity: 0.5 }));
    const brandGlow = keep(new THREE.MeshStandardMaterial({ color: 0x0a2027, emissive: 0x23d1d9, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.5 }));

    /* ── the shaft: what actually moves ──────────────────────────────────── */
    const shaft = new THREE.Group();
    scene.add(shaft);

    /* Two walls, one either side of the car and angled slightly inward, which is all of the
       shaft the camera can actually see. */
    const sideGeo = keep(new THREE.PlaneGeometry(4.4, 120));
    for (const dir of [-1, 1]) {
      const w = new THREE.Mesh(sideGeo, shaftWall);
      w.position.set(dir * 3.55, 0, -1.1);
      w.rotation.y = -dir * (Math.PI / 2 - 0.16);
      shaft.add(w);
    }

    /* Guide rails, and the ribs that make the speed legible. A dark wall streaming past reads as
       nothing at all — the eye needs edges to count, and it needs them close enough together that
       there is always one in frame. One every third of a floor. */
    const railGeo = keep(new THREE.BoxGeometry(0.14, 120, 0.14));
    for (const x of [-2.78, 2.78]) {
      const rail = new THREE.Mesh(railGeo, steelDark);
      rail.position.set(x, 0, -0.95);
      shaft.add(rail);
    }

    const RIB = FLOOR_GAP / 3;
    const RIBS = Math.round(120 / RIB);
    /* Short and set back into the wall. At 1.5 wide and z −0.6 they projected past the car's
       frame and read as SHELVES bolted to the outside of the lift rather than as ribs on a wall
       going past. A rib is a line on a surface; the moment it has a visible depth in front of
       that surface it stops being one. */
    const ribGeo = keep(new THREE.BoxGeometry(0.8, 0.08, 0.1));
    const ribs = new THREE.InstancedMesh(ribGeo, steelDark, RIBS * 2);
    {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < RIBS; i += 1) {
        for (let sIdx = 0; sIdx < 2; sIdx += 1) {
          pos.set((sIdx ? 1 : -1) * 3.32, i * RIB - 60, -1.15);
          m.compose(pos, q, one);
          ribs.setMatrixAt(i * 2 + sIdx, m);
        }
      }
      ribs.instanceMatrix.needsUpdate = true;
    }
    shaft.add(ribs);

    /* A landing every floor: a lit band across the shaft wall, so a floor going by is an EVENT
       rather than one more rib. This is what the indicator is counting. */
    const landingGeo = keep(new THREE.BoxGeometry(0.95, 0.05, 0.11));
    const landings = new THREE.InstancedMesh(landingGeo, brandGlow, 72);
    {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < 36; i += 1) {
        for (let sIdx = 0; sIdx < 2; sIdx += 1) {
          pos.set((sIdx ? 1 : -1) * 3.32, i * FLOOR_GAP - 60, -1.1);
          m.compose(pos, q, one);
          landings.setMatrixAt(i * 2 + sIdx, m);
        }
      }
      landings.instanceMatrix.needsUpdate = true;
    }
    shaft.add(landings);

    /* ── the car ─────────────────────────────────────────────────────────── */
    const car = new THREE.Group();
    scene.add(car);

    const shellGeo = keep(new THREE.BoxGeometry(CAR_W, CAR_H, CAR_D));
    const shell = new THREE.Mesh(shellGeo, carWall);
    shell.material.side = THREE.BackSide;
    shell.position.set(0, 0, -1.05);
    car.add(shell);

    const floorGeo = keep(new THREE.PlaneGeometry(CAR_W, CAR_D));
    const floorMesh = new THREE.Mesh(floorGeo, carFloor);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, -CAR_H / 2 + 0.001, -1.05);
    car.add(floorMesh);

    /* The soft pool the coins stand in. A painted gradient, not a shadow map. */
    const poolCanvas = document.createElement('canvas');
    poolCanvas.width = poolCanvas.height = 128;
    const pctx = poolCanvas.getContext('2d');
    if (pctx) {
      const g = pctx.createRadialGradient(64, 64, 4, 64, 64, 62);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      pctx.fillStyle = g;
      pctx.fillRect(0, 0, 128, 128);
    }
    const poolTex = keep(new THREE.CanvasTexture(poolCanvas));
    const poolMat = keep(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false }));
    const poolGeo = keep(new THREE.PlaneGeometry(1.9, 1.5));
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, -CAR_H / 2 + 0.004, -1.0);
    car.add(pool);

    /* The car's own downlight, warm, so the interior is a place rather than a box. */
    const carLight = new THREE.PointLight(0xffd9a0, 26, 6.5, 2);
    carLight.position.set(0, CAR_H / 2 - 0.28, -0.95);
    car.add(carLight);
    const ceilGeo = keep(new THREE.PlaneGeometry(1.15, 0.75));
    const ceilMat = keep(new THREE.MeshBasicMaterial({ color: 0xffeccd }));
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, CAR_H / 2 - 0.02, -1.0);
    car.add(ceil);

    /* ── the coins ───────────────────────────────────────────────────────── */
    const COINS = 64;
    const coinGeo = keep(new THREE.CylinderGeometry(0.17, 0.17, 0.028, 26));
    const coins = new THREE.InstancedMesh(coinGeo, gold, COINS);
    coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    coins.position.set(0, -CAR_H / 2 + 0.02, -1.0);
    car.add(coins);

    /* ── the doorway ─────────────────────────────────────────────────────────
       The doors sit BEHIND the jamb plane (z −0.03 against the jamb's front at +0.01) and the
       jambs are wide enough to swallow them whole when open. A lift whose doors slide out past
       the frame and stand in the lobby is the single fastest way to make a lift look like two
       rectangles that move. */
    const doorGeo = keep(new THREE.BoxGeometry(CAR_W / 2, CAR_H, 0.07));
    const doorL = new THREE.Mesh(doorGeo, steel);
    const doorR = new THREE.Mesh(doorGeo, steel);
    doorL.position.set(-CAR_W / 4, 0, -0.03);
    doorR.position.set(CAR_W / 4, 0, -0.03);
    car.add(doorL, doorR);

    /* A hairline of brand teal down the join, which is the one place the lift is allowed colour. */
    const seamGeo = keep(new THREE.BoxGeometry(0.012, CAR_H, 0.02));
    for (const [m, x] of [
      [doorL, CAR_W / 4 - 0.006],
      [doorR, -CAR_W / 4 + 0.006],
    ] as Array<[import('three').Mesh, number]>) {
      const seam = new THREE.Mesh(seamGeo, brandGlow);
      seam.position.set(x, 0, 0.045);
      m.add(seam);
    }

    /* The surround. Wide enough that a fully retracted door is entirely behind it — the door
       travels CAR_W/2 and the jamb spans from the doorway edge to well past where it lands. */
    const jambGeo = keep(new THREE.BoxGeometry(1.55, CAR_H + 0.9, 0.26));
    for (const x of [-CAR_W / 2 - 0.775, CAR_W / 2 + 0.775]) {
      const jamb = new THREE.Mesh(jambGeo, steel);
      jamb.position.set(x, 0, 0.14);
      car.add(jamb);
    }
    const lintelGeo = keep(new THREE.BoxGeometry(CAR_W + 3.1, 0.62, 0.26));
    const lintel = new THREE.Mesh(lintelGeo, steel);
    lintel.position.set(0, CAR_H / 2 + 0.31, 0.14);
    car.add(lintel);
    const sillGeo = keep(new THREE.BoxGeometry(CAR_W + 3.1, 0.16, 0.26));
    const sill = new THREE.Mesh(sillGeo, steelDark);
    sill.position.set(0, -CAR_H / 2 - 0.08, 0.14);
    car.add(sill);

    /* The car's own fittings. A handrail and a waistline are what the eye reads as "this is a
       room somebody stands in" rather than "this is a box" — two boxes, and worth both. */
    const railGeoCar = keep(new THREE.BoxGeometry(CAR_W - 0.26, 0.045, 0.045));
    const rail = new THREE.Mesh(railGeoCar, steel);
    rail.position.set(0, -0.34, -2.06);
    car.add(rail);
    const waistGeo = keep(new THREE.BoxGeometry(CAR_W - 0.02, 0.02, 0.02));
    const waist = new THREE.Mesh(waistGeo, steelDark);
    waist.position.set(0, 0.24, -2.13);
    car.add(waist);

    /* ── the indicator ───────────────────────────────────────────────────── */
    const indicatorCanvas = document.createElement('canvas');
    indicatorCanvas.width = 512;
    indicatorCanvas.height = 128;
    const indicatorTex = keep(new THREE.CanvasTexture(indicatorCanvas));
    indicatorTex.colorSpace = THREE.SRGBColorSpace;
    const indMat = keep(new THREE.MeshBasicMaterial({ map: indicatorTex, transparent: true }));
    const indGeo = keep(new THREE.PlaneGeometry(1.5, 0.375));
    const indicator = new THREE.Mesh(indGeo, indMat);
    /* z 0.30 clears the lintel's front face at 0.27. At 0.26 it was buried inside it and the
       floor counter — the one part of this that says where the lift IS — never appeared. */
    indicator.position.set(0, CAR_H / 2 + 0.31, 0.3);
    car.add(indicator);

    /* ── lights ──────────────────────────────────────────────────────────── */
    scene.add(new THREE.HemisphereLight(0xbfe9ee, 0x04121a, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2.4, 3.4, 4.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x59d6de, 0.8);
    rim.position.set(-3.2, 1.2, -2.4);
    scene.add(rim);

    const inst = new ElevatorScene(
      THREE,
      renderer,
      scene,
      camera,
      host,
      { shaft, doorL, doorR, coins, carLight, indicator, indicatorCanvas, indicatorTex, disposables },
      reduced,
    );
    inst.layoutCoins(0);
    inst.drawIndicator(0, 'READY');
    inst.doorGap = 1;
    inst.applyDoors();
    inst.resize();
    inst.start();
    return inst;
  }

  /* ── the ride ──────────────────────────────────────────────────────────── */

  ride(floorIndex: number, cb: RideCallbacks = {}): void {
    if (this.disposed) return;
    this.cb = cb;
    this.targetFloor = floorIndex;
    this.passed = 0;
    this.indicatorFloor = -1;
    if (this.reduced) {
      /* No ride. The doors are simply open on the result, which is the frame that carries the
         meaning — the same contract the coin's spin keeps under the same query. */
      this.phase = 'open';
      this.doorGap = 1;
      this.applyDoors();
      this.drawIndicator(FLOORS[floorIndex], 'ARRIVED');
      cb.onClosed?.();
      cb.onArrived?.();
      cb.onOpen?.();
      return;
    }
    this.phase = 'closing';
    this.phaseT = 0;
  }

  private step(dt: number) {
    const p = this.parts;
    this.coinSpin += dt * 0.35;

    switch (this.phase) {
      case 'closing': {
        this.phaseT += dt / T.close;
        this.doorGap = 1 - easeInOut(Math.min(1, this.phaseT));
        if (this.phaseT >= 1) {
          this.doorGap = 0;
          this.phase = 'rising';
          this.phaseT = 0;
          this.cb.onClosed?.();
          this.drawIndicator(0, 'RISING');
        }
        break;
      }
      case 'rising': {
        this.phaseT += dt / T.rise;
        const t = Math.min(1, this.phaseT);
        /* Accelerate, cruise, begin to slow — the shape of a real drive, not a linear slide. */
        const eased = t < 0.42 ? (t / 0.42) ** 2 * 0.34 : 0.34 + easeOutCubic((t - 0.42) / 0.58) * 0.66;
        const floors = this.targetFloor + 6;
        this.shaftY = -eased * floors * FLOOR_GAP;
        const reached = Math.floor(eased * floors);
        if (reached > this.passed) {
          this.passed = reached;
          this.cb.onFloor?.(reached);
          this.drawIndicator(FLOORS[Math.min(reached, FLOORS.length - 1) % FLOORS.length], 'RISING');
        }
        if (this.phaseT >= 1) {
          this.phase = 'settling';
          this.phaseT = 0;
        }
        break;
      }
      case 'settling': {
        this.phaseT += dt / T.settle;
        const t = Math.min(1, this.phaseT);
        /* The car rocks on its springs; the shaft is already home. */
        const bob = (1 - settleSpring(t)) * 0.055;
        p.shaft.position.y = this.shaftY - bob;
        if (this.phaseT >= 1) {
          p.shaft.position.y = this.shaftY;
          this.phase = 'opening';
          this.phaseT = -T.hold / T.open;
          this.cb.onArrived?.();
          this.drawIndicator(FLOORS[this.targetFloor], 'ARRIVED');
        }
        break;
      }
      case 'opening': {
        this.phaseT += dt / T.open;
        if (this.phaseT > 0) {
          this.doorGap = easeInOut(Math.min(1, this.phaseT));
          /* The car's light spills out as they part. */
          p.carLight.intensity = 26 + this.doorGap * 18;
        }
        if (this.phaseT >= 1) {
          this.doorGap = 1;
          this.phase = 'open';
          this.cb.onOpen?.();
        }
        break;
      }
      default:
        break;
    }

    if (this.phase !== 'settling') p.shaft.position.y = this.shaftY;
    this.applyDoors();
    this.layoutCoins(this.phase === 'open' || this.phase === 'idle' ? 1 : 0);
  }

  private applyDoors() {
    const open = this.doorGap * (CAR_W / 2 - 0.02);
    this.parts.doorL.position.x = -CAR_W / 4 - open;
    this.parts.doorR.position.x = CAR_W / 4 + open;
  }

  /**
   * The coins, laid out as a scatter on the car floor.
   *
   * `present` is 0 while the car is shut, and the instances are scaled to nothing rather than the
   * mesh being hidden — one uniform write beats a visibility change that reshuffles the draw list.
   * They are behind two steel doors either way; this only saves the rasteriser the trouble.
   */
  private layoutCoins(present: number) {
    /* Nothing to do while they are shut behind two steel doors and already at zero scale. Sixty-
       four matrix composes a frame for something nobody can see is the definition of the kind of
       cost this scene is not allowed to have. */
    if (present === 0 && this.coinsPresent === 0) return;
    this.coinsPresent = present;

    /* The scratch objects are built ONCE. This runs every frame it runs at all, and five
       allocations a frame is 300 objects a second of garbage for a five-second animation —
       exactly the sort of thing that shows up as a stutter on a mid-range phone and nowhere else. */
    if (!this.scratch) {
      const T = this.THREE;
      this.scratch = { m: new T.Matrix4(), q: new T.Quaternion(), e: new T.Euler(), pos: new T.Vector3(), scl: new T.Vector3() };
    }
    const { m, q, e, pos, scl } = this.scratch;
    const coins = this.parts.coins;
    const n = coins.count;
    for (let i = 0; i < n; i += 1) {
      /* A fixed pseudo-random scatter — same every time, so the pile is a designed object rather
         than a different accident on every open. */
      const a = (i * 2.3999632) % (Math.PI * 2);
      const r = 0.13 + Math.sqrt((i % 17) / 17) * 0.68;
      const layer = Math.floor(i / 22);
      pos.set(Math.cos(a) * r, 0.016 + layer * 0.03, Math.sin(a) * r * 0.78);
      e.set(Math.PI / 2 + Math.sin(i * 1.7) * 0.22, this.coinSpin * (0.4 + (i % 5) * 0.12) + i, Math.cos(i * 2.1) * 0.2);
      q.setFromEuler(e);
      const s = present * (0.86 + ((i * 7) % 5) * 0.05);
      scl.set(s, s, s);
      m.compose(pos, q, scl);
      coins.setMatrixAt(i, m);
    }
    coins.instanceMatrix.needsUpdate = true;
  }

  /** The floor indicator, drawn to a canvas — the only text in the scene. */
  private drawIndicator(floor: number, state: 'READY' | 'RISING' | 'ARRIVED') {
    if (this.indicatorFloor === floor && state === 'RISING') return;
    this.indicatorFloor = floor;
    const c = this.parts.indicatorCanvas;
    const x = c.getContext('2d');
    if (!x) return;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(4,16,20,0.92)';
    x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = 'rgba(35,209,217,0.35)';
    x.lineWidth = 3;
    x.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);
    x.fillStyle = state === 'ARRIVED' ? '#f0b23c' : '#23d1d9';
    x.font = '700 74px ui-monospace, "SFMono-Regular", Menlo, monospace';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(state === 'READY' ? 'BO' : String(floor).padStart(3, '0'), c.width / 2, c.height / 2 + 4);
    this.parts.indicatorTex.needsUpdate = true;
  }

  /* ── loop and lifecycle ────────────────────────────────────────────────── */

  private start() {
    const tick = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      if (document.hidden) {
        this.last = now;
        return;
      }
      /* Clamped: a tab that was backgrounded for a minute must not deliver a minute of dt and
         teleport the car through the whole shaft in one frame. */
      const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
      this.last = now;
      this.step(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(tick);
  }

  resize() {
    if (this.disposed) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    /* Framed to the doorway however narrow the panel gets: on a phone the camera steps back
       rather than the lift being cropped, which is the difference between a portrait shot and a
       mistake. */
    this.camera.position.z = 7.1 * Math.max(1, 1.42 / this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const d of this.parts.disposables) d.dispose();
    this.scene.traverse((o) => {
      const mesh = o as import('three').Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
