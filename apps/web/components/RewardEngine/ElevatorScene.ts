'use client';

/**
 * The BO lift — a reward you can see arriving. Coins in the car, doors close over them, the car
 * rides with the shaft streaming past, and the doors part on what it brought back. The coins
 * going out of sight is occlusion by the doors, not a fade, which is the only version a viewer
 * believes.
 *
 * THE SHAFT MOVES AND THE CAR DOES NOT. Identical on screen to flying a camera up a mile of
 * shaft, and it means the geometry is a few metres tall with the rungs recycled as they leave
 * frame. Two consequences: the DOOR FRAME rides with the car (a landing's doorway only exists at
 * a landing), and the shaft sits at the SIDES, since from in front the car occludes anything
 * behind it.
 *
 * The performance contract — nothing here may cost the site anything:
 *
 *   NO SHADOW MAPS. The contact under the coins is a painted radial plane, which reads better
 *   anyway because it can be exactly as soft as it should be.
 *   ONE ENVIRONMENT, generated once: RoomEnvironment through a PMREM at 0.04 roughness.
 *   INSTANCED COINS. Sixty coins are one draw call.
 *   THE LOOP STOPS when the tab is hidden; `dispose()` takes the context, geometries, materials
 *   and PMREM with it.
 *   DPR CAPPED AT 2. Past that it is heat, not detail.
 *
 * Nothing imports three at module scope — the whole scene arrives with the panel.
 */

import { accelAt, buildProfile, type DriveProfile } from './liftMotion';

type ThreeNS = typeof import('three');

/**
 * Seven landings. Six pay coins; the top one pays something else.
 *
 * SURPRISE is the penthouse and it is deliberately the last stop on the strip — a floor above
 * the hundred is a floor you can see you have not reached yet, which is most of what makes it
 * worth reaching. It credits nothing, and that is the point: it is Customer of the Week.
 */
export const FLOORS = [0, 20, 40, 60, 80, 100] as const;
export const SURPRISE_FLOOR = FLOORS.length;
export const FLOOR_COUNT = FLOORS.length + 1;

/** What the indicator shows for each landing. */
export const FLOOR_LABEL = (i: number) => (i === SURPRISE_FLOOR ? 'SURPRISE' : String(FLOORS[i % FLOORS.length]).padStart(3, '0'));

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
  rise: 3.4,
  settle: 0.85,
  hold: 0.3,
  open: 1.15,
} as const;

const FLOOR_GAP = 3.4;
const CAR_W = 2.35;
const CAR_H = 2.75;
const CAR_D = 2.2;

/* Cubic in-out for the doors and a spring for the settle. The DRIVE does not use an easing at
   all — it integrates a velocity curve, in liftMotion.ts, which is where a lift's motion belongs. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
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
  private indicatorFloor = -2;
  private coinsPresent = -1;
  private profile: DriveProfile = buildProfile();
  /** Line speed and signed acceleration this frame — the sway, the blur and the light all read them. */
  private speed = 0;
  private accel = 0;
  private confettiT = -1;
  /** Customer of the Week opens on an empty car — see celebrate(). */
  private hideCoins = false;
  /** The burst is over and the paper it left is frozen on the floor — see stepConfetti(). */
  private confettiSettled = false;
  private phaseStart = 0;
  private hiddenAt = 0;
  private ribStretch = -1;
  private ribScratch: { m: import('three').Matrix4; q: import('three').Quaternion; pos: import('three').Vector3; scl: import('three').Vector3 } | null = null;
  private confettiScratch: {
    m: import('three').Matrix4;
    q: import('three').Quaternion;
    e: import('three').Euler;
    pos: import('three').Vector3;
    scl: import('three').Vector3;
  } | null = null;
  private confettiState: {
    px: Float32Array;
    py: Float32Array;
    pz: Float32Array;
    vx: Float32Array;
    vy: Float32Array;
    vz: Float32Array;
    sp: Float32Array;
    /** Launch delay. A popper fires a ragged volley, not one frame. */
    dl: Float32Array;
    /** 1 once the piece has come to rest on the car floor. */
    rest: Float32Array;
  } | null = null;
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
      confetti: import('three').InstancedMesh;
      pool: import('three').Mesh;
      ribs: import('three').InstancedMesh;
      car: import('three').Group;
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
    /* Kept, because it has to be hidden along with the coins — a shadow under nothing. */
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

    /* ── the coins ─────────────────────────────────────────────────────────
       Struck metal, not counters. Three things do the work and none of them costs a draw call:

       A MILLED RIM. 40 radial segments and a rim slightly proud of the faces, so the edge catches
       the downlight as a bright ring instead of going dark like a flat disc does.

       PER-COIN COLOUR. `setColorAt` tints each instance a little differently — brass, rose gold,
       worn — which is the difference between a pile of coins and sixty copies of one coin. Free:
       instance colour rides in the same buffer the matrices do.

       A PILE THAT SITS. Three layers, each smaller and more tilted than the one beneath it,
       because coins tipped off a stack come to rest leaning on each other. */
    const COINS = 72;
    const coinGeo = keep(new THREE.CylinderGeometry(0.168, 0.168, 0.03, 40, 1));
    const coins = new THREE.InstancedMesh(coinGeo, gold, COINS);
    coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    coins.position.set(0, -CAR_H / 2 + 0.02, -1.0);
    {
      const c = new THREE.Color();
      for (let i = 0; i < COINS; i += 1) {
        /* Hue barely moves; saturation and lightness carry the variation, which is how real
           worn brass differs from real new brass. */
        c.setHSL(0.1 + ((i * 13) % 7) * 0.004, 0.62 + ((i * 7) % 5) * 0.05, 0.46 + ((i * 11) % 6) * 0.035);
        coins.setColorAt(i, c);
      }
      if (coins.instanceColor) coins.instanceColor.needsUpdate = true;
    }
    car.add(coins);

    /* ── the crackers ────────────────────────────────────────────────────────
       For the surprise floor. One InstancedMesh of small quads with per-instance colour and a
       hand-rolled integrator — position, velocity, gravity, drag, spin. Particles are the one
       place a physics library earns nothing: six lines of Euler is the whole simulation, and
       running it on 140 instances is cheaper than the library's import. */
    const CONFETTI = 260;
    const confettiGeo = keep(new THREE.PlaneGeometry(0.075, 0.115));
    const confettiMat = keep(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, toneMapped: false }));
    const confetti = new THREE.InstancedMesh(confettiGeo, confettiMat, CONFETTI);
    confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    confetti.position.set(0, 0, -0.6);
    confetti.visible = false;
    {
      const c = new THREE.Color();
      const palette = [0x23d1d9, 0xf0b23c, 0xffffff, 0x56d3d8, 0xf7c85a];
      for (let i = 0; i < CONFETTI; i += 1) {
        c.setHex(palette[i % palette.length]);
        confetti.setColorAt(i, c);
      }
      if (confetti.instanceColor) confetti.instanceColor.needsUpdate = true;
    }
    car.add(confetti);

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
      { shaft, doorL, doorR, coins, confetti, pool, ribs, car, carLight, indicator, indicatorCanvas, indicatorTex, disposables },
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
    this.hideCoins = false;
    this.confettiT = -1;
    this.confettiSettled = false;
    if (this.reduced) {
      /* No ride. The doors are simply open on the result, which is the frame that carries the
         meaning — the same contract the coin's spin keeps under the same query. */
      this.phase = 'open';
      this.doorGap = 1;
      this.applyDoors();
      /* An INDEX, not a value — FLOORS[6] is undefined and the surprise floor is 6. */
      this.drawIndicator(floorIndex, 'ARRIVED');
      cb.onClosed?.();
      cb.onArrived?.();
      cb.onOpen?.();
      return;
    }
    this.phase = 'closing';
    this.phaseT = 0;
    /* performance.now(), the same clock requestAnimationFrame hands the loop. */
    this.phaseStart = performance.now();
  }

  /** Move to a phase and stamp when it began. */
  private enter(phase: RidePhase, at: number) {
    this.phase = phase;
    this.phaseT = 0;
    this.phaseStart = at;
  }

  private step(dt: number, now: number) {
    const p = this.parts;
    this.coinSpin += dt * 0.35;
    /* Every phase below reads this instead of summing dt — see start(). */
    const since = (d: number) => (now - this.phaseStart) / 1000 / d;

    switch (this.phase) {
      case 'closing': {
        this.phaseT = since(T.close);
        this.doorGap = 1 - easeInOut(Math.min(1, this.phaseT));
        if (this.phaseT >= 1) {
          this.doorGap = 0;
          this.enter('rising', now);
          this.cb.onClosed?.();
          this.drawIndicator(0, 'RISING');
        }
        break;
      }
      case 'rising': {
        this.phaseT = since(T.rise);
        const t = Math.min(1, this.phaseT);
        /* Position is the INTEGRAL of a jerk-limited velocity curve — see liftMotion.ts. Quick
           away, a long glide in, and no step in acceleration at either end. */
        const travelled = this.profile.at(t);
        this.speed = this.profile.speed(t);
        this.accel = accelAt(t);

        const floors = this.targetFloor + FLOOR_COUNT + 5;
        this.shaftY = -travelled * floors * FLOOR_GAP;

        /* Which landing is level with the car right now. Counted off the DISTANCE, so a floor
           ticks when it actually passes rather than on a timer that drifts from the geometry. */
        const reached = Math.floor(travelled * floors);
        if (reached > this.passed) {
          this.passed = reached;
          this.cb.onFloor?.(reached);
          this.drawIndicator(reached % FLOOR_COUNT, 'RISING');
        }
        if (this.phaseT >= 1) {
          this.enter('settling', now);
          this.speed = 0;
          this.accel = 0;
        }
        break;
      }
      case 'settling': {
        this.phaseT = since(T.settle);
        const t = Math.min(1, this.phaseT);
        /* The car rocks on its springs; the shaft is already home. */
        const bob = (1 - settleSpring(t)) * 0.055;
        p.shaft.position.y = this.shaftY - bob;
        if (this.phaseT >= 1) {
          p.shaft.position.y = this.shaftY;
          /* The hold before the doors part is bought by starting the opening phase in the past. */
          this.enter('opening', now + T.hold * 1000);
          this.cb.onArrived?.();
          this.drawIndicator(this.targetFloor, 'ARRIVED');
        }
        break;
      }
      case 'opening': {
        this.phaseT = since(T.open);
        if (this.phaseT > 0) this.doorGap = easeInOut(Math.min(1, this.phaseT));
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
    this.layoutCoins(!this.hideCoins && (this.phase === 'open' || this.phase === 'idle') ? 1 : 0);
    this.applyRide(dt);
    this.stepConfetti(dt);
  }

  /**
   * What the drive does to everything that is not the position.
   *
   * THE CAR SETTLES BACK as it takes up speed and leans into the stop — the whole group shifts a
   * couple of centimetres against the acceleration, exactly the way a passenger's weight does.
   * This is why the profile exposes acceleration at all: without it, a car travelling at line
   * speed and a car standing still look identical, and the drive has no weight.
   *
   * THE RIBS STRETCH with speed. Scaling an instanced rib along Y is the cheapest honest motion
   * blur there is — a real camera would smear them exactly this way, it costs one matrix write
   * per rib, and it is the difference between "the wall is moving" and "the wall is fast".
   *
   * THE LIGHT DIPS on the hard acceleration, the way a cabin light does when the motor pulls.
   */
  private applyRide(_dt: number) {
    const p = this.parts;
    const a = this.accel;
    p.car.position.y = -a * 0.055;
    p.car.rotation.x = a * 0.006;

    const stretch = 1 + this.speed * 5.5;
    if (this.ribStretch !== stretch) {
      this.ribStretch = stretch;
      if (!this.ribScratch) {
        const T3 = this.THREE;
        this.ribScratch = { m: new T3.Matrix4(), q: new T3.Quaternion(), pos: new T3.Vector3(), scl: new T3.Vector3() };
      }
      const { m, q, pos, scl } = this.ribScratch;
      const ribs = p.ribs;
      for (let i = 0; i < ribs.count; i += 1) {
        ribs.getMatrixAt(i, m);
        pos.setFromMatrixPosition(m);
        scl.set(1, stretch, 1);
        m.compose(pos, q, scl);
        ribs.setMatrixAt(i, m);
      }
      ribs.instanceMatrix.needsUpdate = true;
    }

    p.carLight.intensity = (this.phase === 'opening' || this.phase === 'open' ? 44 : 26) - Math.abs(a) * 7;
  }

  /**
   * The crackers, integrated by hand.
   *
   * Euler with drag, which is the right amount of physics for paper: it is light enough that drag
   * dominates gravity almost immediately, so an accurate integrator would look WRONG — confetti
   * does not arc like a thrown ball, it bursts, stalls and flutters down. The flutter is the spin
   * running faster than the fall.
   */
  private stepConfetti(dt: number) {
    const c = this.parts.confetti;
    /* Frozen: the paper on the floor is still drawn, and not one matrix is written for it again.
       It stays until the next ride, because a car that has just been showered in confetti has
       confetti in it — clearing the floor on a timer undoes the thing that just happened. */
    if (this.confettiSettled) return;
    if (this.confettiT < 0) {
      if (c.visible) c.visible = false;
      return;
    }
    const first = this.confettiT === 0;
    this.confettiT += dt;
    if (this.confettiT > 5.6) {
      /* Every airborne piece has faded to nothing by now — the fade below reaches zero at exactly
         5.6 — so what is left on screen is the settled layer. Stop simulating, keep drawing. */
      this.confettiSettled = true;
      return;
    }
    c.visible = true;

    if (!this.confettiState) {
      this.confettiState = {
        px: new Float32Array(c.count),
        py: new Float32Array(c.count),
        pz: new Float32Array(c.count),
        vx: new Float32Array(c.count),
        vy: new Float32Array(c.count),
        vz: new Float32Array(c.count),
        sp: new Float32Array(c.count),
        dl: new Float32Array(c.count),
        rest: new Float32Array(c.count),
      };
    }
    const st = this.confettiState;
    if (first) {
      /* THREE EMITTERS, because one is a screensaver and two is a pair of fountains.

         POPPERS, two of them, at the doorway edges pointing up and inward — where a person would
         actually hold them. They are fired hard enough to REACH THE CEILING; a burst that stalls
         at head height is a burst you can see the maths in.
         A SHOWER from the ceiling, already falling, so the car keeps filling after the poppers
         have spent themselves. Without it the whole thing is over in a second and a half, and
         what makes a celebration read as a celebration is that it does not stop when you expect.

         The angle is stepped by the golden angle, which distributes directions without ever
         repeating a fan — the giveaway pattern when a burst is laid out on a plain modulus. */
      const TOP = CAR_H / 2 - 0.12;
      const FLOORY = -CAR_H / 2 + 0.1;
      for (let i = 0; i < c.count; i += 1) {
        const a = (i * 2.3999632) % (Math.PI * 2);
        st.sp[i] = 5 + ((i * 5) % 9);
        st.rest[i] = 0;
        /* Staggered over a third of a second. Fired on one frame, every piece reaches its apex
           on the same frame too, and 170 of them draw a horizontal STRIPE across the car — which
           is the exact tell that this is a particle system and not a room full of paper. */
        st.dl[i] = ((i * 29) % 23) * 0.015;
        if (i % 3 === 2) {
          /* the shower */
          st.px[i] = (((i * 37) % 100) / 100 - 0.5) * (CAR_W - 0.3);
          st.py[i] = TOP + ((i * 17) % 13) * 0.09;
          /* Kept in front of the back wall — the group already sits at z −0.6. */
          st.pz[i] = -0.45 + (((i * 23) % 100) / 100) * 0.6;
          st.vx[i] = Math.cos(a) * 0.5;
          st.vy[i] = -0.5 - ((i * 11) % 7) * 0.1;
          st.vz[i] = Math.sin(a) * 0.35;
          /* The shower starts after the poppers have gone up, so it falls into their fall. */
          st.dl[i] = 0.25 + ((i * 19) % 31) * 0.03;
          continue;
        }
        /* the poppers */
        const side = i % 3 === 0 ? -1 : 1;
        st.px[i] = side * (CAR_W / 2 - 0.08);
        st.py[i] = FLOORY;
        st.pz[i] = -0.25;
        const spd = 3.4 + ((i * 7) % 11) * 0.3;
        st.vx[i] = -side * (0.45 + Math.abs(Math.cos(a)) * 0.85) * spd * 0.5;
        st.vy[i] = 5.3 + ((i * 13) % 9) * 0.3;
        st.vz[i] = Math.sin(a * 1.7) * 0.9 - 0.25;
      }
    }

    if (!this.confettiScratch) {
      const T3 = this.THREE;
      this.confettiScratch = { m: new T3.Matrix4(), q: new T3.Quaternion(), e: new T3.Euler(), pos: new T3.Vector3(), scl: new T3.Vector3(1, 1, 1) };
    }
    const { m, q, e, pos, scl } = this.confettiScratch;
    /* Paper has almost no mass and a great deal of surface, so DRAG DOMINATES GRAVITY within a
       few frames of the apex. Model it honestly and confetti does what confetti does: it bursts,
       stalls, and then comes down slowly, which is the whole reason the moment lasts. Model it as
       a projectile and it drops like gravel — that was the first cut, and it emptied the car in
       under two seconds. */
    const drag = 0.955 ** (dt * 60);
    const fade = Math.max(0, 1 - Math.max(0, this.confettiT - 4.0) / 1.6);
    const REST_Y = -CAR_H / 2 + 0.02;
    for (let i = 0; i < c.count; i += 1) {
      const age = this.confettiT - st.dl[i];
      if (age <= 0) {
        /* Not fired yet. Scale zero rather than a second draw call to hide it. */
        m.compose(pos.set(st.px[i], st.py[i], st.pz[i]), q.identity(), scl.setScalar(0));
        c.setMatrixAt(i, m);
        continue;
      }
      if (st.rest[i] === 0) {
        st.vy[i] -= 4.2 * dt;
        st.vx[i] *= drag;
        st.vy[i] *= drag;
        st.vz[i] *= drag;
        /* The flutter. A falling rectangle does not go straight down — it slips sideways off each
           face in turn, and that sway is most of what the eye reads as "paper". Free: a sine of a
           per-piece phase, no extra state. */
        const sway = Math.sin(age * 3.4 + st.sp[i]) * 0.42;
        st.px[i] += (st.vx[i] + sway) * dt;
        st.py[i] += st.vy[i] * dt;
        st.pz[i] += (st.vz[i] + Math.cos(age * 2.7 + st.sp[i]) * 0.2) * dt;
        /* THE CAR HAS A FLOOR. Without this the burst falls through the sill and out of the
           bottom of the frame, which is the one thing that would say "particles" out loud. */
        if (st.py[i] <= REST_Y) {
          st.py[i] = REST_Y;
          st.rest[i] = 1;
        }
      }
      pos.set(st.px[i], st.py[i], st.pz[i]);
      if (st.rest[i] === 1) {
        /* Settled: lying flat, at whatever angle it happened to land. */
        e.set(-Math.PI / 2, 0, st.sp[i] * 1.7);
      } else {
        e.set(age * st.sp[i] * 0.7, age * st.sp[i], age * st.sp[i] * 0.4);
      }
      q.setFromEuler(e);
      /* Only what is still in the air fades. What has landed has landed. */
      scl.setScalar(st.rest[i] === 1 ? 1 : fade);
      m.compose(pos, q, scl);
      c.setMatrixAt(i, m);
    }
    c.instanceMatrix.needsUpdate = true;
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
    this.parts.pool.visible = present > 0;

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

  /**
   * The floor indicator. The only text in the scene, and it has to hold a three-digit number and
   * the word SURPRISE in the same bar — so the type is fitted to the plate rather than the plate
   * to the type. A word that overflows its own housing is the detail that says "mock-up".
   */
  private drawIndicator(floorIndex: number, state: 'READY' | 'RISING' | 'ARRIVED') {
    if (this.indicatorFloor === floorIndex && state === 'RISING') return;
    this.indicatorFloor = floorIndex;
    const c = this.parts.indicatorCanvas;
    const x = c.getContext('2d');
    if (!x) return;
    const surprise = floorIndex === SURPRISE_FLOOR;
    const text = state === 'READY' ? 'BO' : FLOOR_LABEL(floorIndex);

    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(4,16,20,0.94)';
    x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = surprise ? 'rgba(240,178,60,0.55)' : 'rgba(35,209,217,0.35)';
    x.lineWidth = 3;
    x.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);

    const ink = surprise ? '#f7c85a' : state === 'ARRIVED' ? '#f0b23c' : '#23d1d9';
    x.fillStyle = ink;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    /* Shrink to fit. SURPRISE is eight characters where 000 is three, and a fixed size would
       either clip the word or waste two thirds of the plate on the number. */
    let size = 74;
    do {
      x.font = `700 ${size}px ui-monospace, "SFMono-Regular", Menlo, monospace`;
      if (x.measureText(text).width <= c.width - 56) break;
      size -= 3;
    } while (size > 22);
    /* A landing plate is lit from behind, so the glyphs bloom slightly into the housing. */
    x.shadowColor = ink;
    x.shadowBlur = surprise ? 26 : 14;
    x.fillText(text, c.width / 2, c.height / 2 + 3);
    x.shadowBlur = 0;
    this.parts.indicatorTex.needsUpdate = true;
  }

  /** Set off the crackers. Called by the panel when the car lands on SURPRISE. */
  /**
   * Set off the crackers. Called by the panel when the car lands on SURPRISE.
   *
   * It also EMPTIES THE CAR. Customer of the Week pays no coins, and a doorway full of gold on
   * the one reveal that credits nothing is the picture contradicting the words underneath it.
   * The prize here is that there is no pile — just the burst.
   *
   * `reduced` is a real exit, not a corner cut: someone who has asked their system for less motion
   * has asked for exactly this, and the reveal still reads because the plate and the card carry it.
   * (Headless Chromium reports `reduce` by default, so this branch is the one every screenshot
   * test takes unless the harness says otherwise.)
   */
  celebrate() {
    if (this.disposed || this.reduced) return;
    this.confettiT = 0;
    this.confettiSettled = false;
    this.hideCoins = true;
  }

  /* ── loop and lifecycle ────────────────────────────────────────────────── */

  /**
   * Phases run on the wall clock, not on accumulated frame time.
   *
   * Summing a clamped `dt` stretches time on a slow device: at 15fps every real frame is 66ms and
   * every clamped frame advances 50, so a ride specified at 6.7s measured over 9 on software GL.
   * A slow device is supposed to drop frames, not run in slow motion. Each phase records when it
   * began and its progress is `(now - start) / duration`.
   *
   * `dt` survives for things that genuinely integrate — confetti, coin spin — still clamped,
   * because those integrate FORWARD and a huge step would fling them. A hidden tab pushes the
   * phase start forward by exactly the time it was hidden.
   */
  private start() {
    const tick = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      if (document.hidden) {
        this.hiddenAt = this.hiddenAt || now;
        this.last = now;
        return;
      }
      if (this.hiddenAt) {
        this.phaseStart += now - this.hiddenAt;
        this.hiddenAt = 0;
      }
      const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
      this.last = now;
      this.step(dt, now);
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
