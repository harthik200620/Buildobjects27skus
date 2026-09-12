'use client';

import L from 'leaflet';
import React from 'react';
import type { Plan } from '@/lib/tracking/simulate';
import type { Snapshot } from '@/lib/tracking/types';

/*
 * OpenStreetMap's own tiles, turned dark by a filter on the tile pane (see `.tk-map
 * .leaflet-tile-pane` in order.css). Only the tiles are filtered — the route, the pins and the
 * truck live in other panes and keep their real colours.
 *
 * CARTO's dark_all basemap was here first and looks better out of the box. It now watermarks
 * "API KEY REQUIRED" across every keyless tile, which arrives as an HTTP 200 and is therefore
 * invisible to every check except looking at it. OSM's standard tiles are the free source that
 * does not do that.
 *
 * BEFORE THIS CARRIES REAL TRAFFIC: OSM's tile policy covers modest use only. A store doing real
 * delivery volume needs a paid tile provider — swap this URL, the attribution, and the one
 * `img-src` entry in next.config.ts, and nothing else changes.
 */
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/* A mini truck seen from above, nose up. Rotated to the heading each frame. */
const TRUCK = `<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
  <ellipse cx="22" cy="24" rx="11" ry="15" fill="rgb(0 0 0 / 40%)"/>
  <rect x="13" y="17" width="18" height="21" rx="3" fill="#eef7f8" stroke="#06181d" stroke-width="1.5"/>
  <rect x="14" y="5" width="16" height="13" rx="4" fill="#56d3d8" stroke="#06181d" stroke-width="1.5"/>
  <rect x="16.5" y="7.5" width="11" height="4" rx="1.5" fill="#06181d" opacity=".85"/>
  <rect x="10" y="9" width="3" height="6" rx="1" fill="#06181d"/><rect x="31" y="9" width="3" height="6" rx="1" fill="#06181d"/>
  <rect x="10" y="29" width="3" height="7" rx="1" fill="#06181d"/><rect x="31" y="29" width="3" height="7" rx="1" fill="#06181d"/>
  <circle cx="17.5" cy="5.5" r="1.4" fill="#fff6c2"/><circle cx="26.5" cy="5.5" r="1.4" fill="#fff6c2"/>
</svg>`;

/* The two pins: a teardrop with a glyph. Yard is teal, the door is white. */
const pinSvg = (fill: string, glyph: string) =>
  `<svg viewBox="0 0 36 44" width="36" height="44" aria-hidden="true"><path d="M18 42C12 34 4 27.5 4 18A14 14 0 0 1 32 18c0 9.5-8 16-14 24z" fill="${fill}" stroke="#06181d" stroke-width="2"/>${glyph}</svg>`;
const YARD = pinSvg('#56d3d8', '<path d="M10 14h16l-2-4H12z" fill="#06181d"/><rect x="11" y="14" width="14" height="10" rx="1.5" fill="#06181d"/>');
const HOME = pinSvg('#f2f8f9', '<path d="M18 8l9 8h-3v8h-4v-5h-4v5h-4v-8h-3z" fill="#06181d"/>');

const latLngs = (coords: [number, number][]) => coords.map(([lng, lat]) => L.latLng(lat, lng));

/**
 * Share of the remaining distance the camera closes each SECOND while chasing the truck.
 *
 * Per second, not per frame, for the reason spelled out in heading.ts: a fraction applied once a
 * frame is a different speed on a 30 Hz display than on a 120 Hz one, and the two should look
 * alike. This file had the per-frame form until the heading was fixed and the same bug was found
 * sitting here.
 */
const CAMERA_CATCH_UP = 0.92;
/** How far into the frame the truck may drift before the camera starts to follow, as a share of the smaller side. */
const DEAD_ZONE = 0.3;

interface Layers {
  map: L.Map;
  truck: L.Marker;
  /** The stretch still to drive, painted twice: a bright line and a soft halo under it. */
  ahead: [L.Polyline, L.Polyline];
  /** The whole leg, faint, so the shape of the trip is visible before it is driven. */
  behind: L.Polyline;
  pins: [L.Marker, L.Marker];
}

type View = 'trip' | 'yard' | 'home' | 'door';

/** Which leg a view is looking at. The whole-trip view is framed on both but tracks the first. */
const legOf = (view: View): 0 | 1 => (view === 'trip' || view === 'yard' ? 0 : 1);

/** Frame what matters now: the whole trip before there is a truck, the leg being driven, the door at the end. */
function frame(r: Layers, plan: Plan, view: View, calm: boolean) {
  const { city, legs } = plan;
  const move = { animate: !calm, duration: 1 };

  if (view === 'door') {
    r.map.flyTo([city.drop.lat, city.drop.lng], 16, move);
  } else {
    const shown = view === 'trip' ? [...legs[0].coords, ...legs[1].coords] : legs[legOf(view)].coords;
    /* Wider padding sideways than up and down, because a pin carries its name beside it and a pin
       fitted snugly against the edge has its label clipped by the map's own overflow. On a 375px
       phone the yard's label ran off the right edge at the tightest fit. */
    r.map.fitBounds(L.latLngBounds(latLngs(shown)), { paddingTopLeft: [72, 40], paddingBottomRight: [72, 56], maxZoom: 16, ...move });
  }

  r.behind.setLatLngs(latLngs(legs[legOf(view)].coords));
  r.pins[0].getElement()?.classList.toggle('is-target', view === 'yard');
  r.pins[1].getElement()?.classList.toggle('is-target', view === 'home');
}

/**
 * Nudge the map so the truck stays inside the middle of the frame.
 *
 * The dead zone is what stops it being seasick: inside it the camera does not move at all and the
 * truck drifts across a still map, which is how a person reads where it is going. Only when it
 * reaches the edge does the map start to travel, and then it eases rather than jumps.
 */
function follow(map: L.Map, at: L.LatLng, dt: number) {
  const size = map.getSize();
  const p = map.latLngToContainerPoint(at);
  const margin = Math.min(size.x, size.y) * DEAD_ZONE;
  const dx = Math.max(0, margin - p.x) - Math.max(0, p.x - (size.x - margin));
  const dy = Math.max(0, margin - p.y) - Math.max(0, p.y - (size.y - margin));
  if (!dx && !dy) return;

  const k = 1 - (1 - CAMERA_CATCH_UP) ** dt;
  const centre = map.latLngToContainerPoint(map.getCenter());
  map.panTo(map.containerPointToLatLng(L.point(centre.x - dx * k, centre.y - dy * k)), { animate: false });
}

export default function TrackingMap({ plan, snap, subscribe }: { plan: Plan; snap: Snapshot; subscribe: (fn: (f: Snapshot) => void) => () => void }) {
  const box = React.useRef<HTMLDivElement>(null);
  const layers = React.useRef<Layers | null>(null);
  /* Set when the reader drags the map; the camera stops following until they ask it back. */
  const away = React.useRef(false);
  const [awayUi, setAwayUi] = React.useState(false);
  const calm = React.useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const view: View = snap.phase === 'confirmed' ? 'trip' : snap.phase === 'delivered' ? 'door' : snap.legIndex === 0 ? 'yard' : 'home';

  /* The map, once per order. */
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    /*
     * A VIEW AT CONSTRUCTION, NOT AFTER.
     *
     * Leaflet throws "Set map center and zoom first" from anything that has to project a
     * coordinate before a view exists — `flyTo` reads `getCenter()` on its first line, and that
     * is the path a page taken straight to a DELIVERED order walks. Layers are luckier: `addTo`
     * defers them to the map's `load` event, so the tile layer and the pins survive it and only
     * the camera blows up, which is why this took a delivered order to show. Centring on the drop
     * makes every later move a refinement of a live view rather than the first one.
     */
    const map = L.map(el, { center: [plan.city.drop.lat, plan.city.drop.lng], zoom: 13, zoomControl: false, scrollWheelZoom: false, zoomSnap: 0.25 });
    map.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(map);

    /*
     * `smoothFactor: 0` — DRAW EVERY POINT THE ROUTER GAVE US.
     *
     * Leaflet's default of 1 runs Douglas–Peucker over the polyline before painting and threw
     * away more than half of a 130-point leg. What that looks like on screen is a line that
     * shaves the corner off a junction and crosses the block beside it: the data is on the road
     * and the drawing is not, which is precisely "it is going on some other road". A hundred and
     * thirty points is nothing to paint, and the honesty is worth far more than the saving.
     */
    const road = (cls: string, weight: number, opacity: number) =>
      L.polyline([], { className: cls, color: '#56d3d8', weight, opacity, lineCap: 'round', lineJoin: 'round', interactive: false, smoothFactor: 0 }).addTo(
        map,
      );
    const behind = road('tk-road-behind', 5, 0.22);
    /* Halo first so the bright line sits on top of it. */
    const ahead: Layers['ahead'] = [road('tk-road-glow', 16, 0.16), road('tk-road', 5, 0.95)];

    /*
     * `keyboard: false` ON EVERY MARKER HERE, and it is not a nicety.
     *
     * Leaflet's marker defaults to `keyboard: true`, which gives the icon `tabindex="0"` AND
     * `role="button"`. These three markers are pictures — the pins and the truck do nothing when
     * pressed — so the default put three focusable controls in the tab order that announce
     * themselves as buttons and then have no action. Turning it off is what makes
     * `interactive: false` true all the way down rather than only for the mouse.
     */
    const pin = (p: { lat: number; lng: number }, html: string, label: string) =>
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: 'tk-pin', html, iconSize: [36, 44], iconAnchor: [18, 42] }),
        interactive: false,
        keyboard: false,
      })
        .bindTooltip(label, { permanent: true, direction: 'bottom', offset: [0, 2], className: 'tk-tip' })
        .addTo(map);
    const pins: [L.Marker, L.Marker] = [pin(plan.city.yard, YARD, plan.city.yard.name), pin(plan.city.drop, HOME, 'Your site')];
    const truck = L.marker([0, 0], {
      icon: L.divIcon({ className: 'tk-truck', html: `<div class="tk-truck-in">${TRUCK}</div>`, iconSize: [44, 44], iconAnchor: [22, 22] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    });

    map.on('dragstart', () => {
      away.current = true;
      setAwayUi(true);
    });
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    layers.current = { map, truck, ahead, behind, pins };
    return () => {
      ro.disconnect();
      map.remove();
      layers.current = null;
    };
  }, [plan]);

  React.useEffect(() => {
    const r = layers.current;
    if (!r) return;
    frame(r, plan, view, calm);
    away.current = false;
    setAwayUi(false);
  }, [plan, view, calm]);

  /*
   * Every frame: place the truck, turn it, shorten the road ahead, and ease the camera after it.
   *
   * THE CAMERA IS DRIVEN FROM HERE RATHER THAN HANDED TO `panTo`'s ANIMATION. Leaflet's pan
   * transforms the map pane over its own 800 ms while this callback keeps repositioning the
   * marker inside that pane on every frame. Two clocks, so through every pan the truck visibly
   * slid off the road and back on — the defect that reads as "it is driving through the
   * buildings". Placing the truck and moving the map in the same tick is what makes them agree.
   */
  React.useEffect(() => {
    /* The road ahead is only re-set when it actually changes shape. Re-projecting 130 points
       sixty times a second, for a difference of one, is most of a frame's budget for nothing. */
    let drawnPoints = -1;
    let last = performance.now();

    return subscribe((f) => {
      const r = layers.current;
      if (!r || !f.at) return;

      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const at = L.latLng(f.at.lat, f.at.lng);
      if (!r.map.hasLayer(r.truck)) r.truck.addTo(r.map);
      r.truck.setLatLng(at);

      /* rotate3d, not rotate: it keeps the sprite on the compositor instead of repainting the
         marker layer on every one of sixty frames. */
      const body = r.truck.getElement()?.firstElementChild as HTMLElement | null;
      if (body) body.style.transform = `rotate3d(0,0,1,${f.heading.toFixed(1)}deg)`;

      if (f.remaining.length !== drawnPoints) {
        drawnPoints = f.remaining.length;
        const rest = latLngs(f.remaining);
        for (const line of r.ahead) line.setLatLngs(rest);
      }

      if (!away.current && !calm) follow(r.map, at, dt);
    });
  }, [subscribe, calm]);

  return (
    <div className="tk-map">
      <div ref={box} className="tk-canvas" role="img" aria-label={`Map of the truck's route from the ${plan.city.yard.name} to ${plan.city.drop.name}`} />
      <div className="tk-wash" aria-hidden="true" />
      {awayUi && (
        <button
          type="button"
          className="tk-recentre"
          onClick={() => {
            if (layers.current) frame(layers.current, plan, view, calm);
            away.current = false;
            setAwayUi(false);
          }}
        >
          Recentre
        </button>
      )}
    </div>
  );
}
