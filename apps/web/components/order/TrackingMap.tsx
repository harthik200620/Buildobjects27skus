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

interface Layers {
  map: L.Map;
  truck: L.Marker;
  ahead: L.Polyline;
  glow: L.Polyline;
  behind: L.Polyline;
  pins: [L.Marker, L.Marker];
}

type View = 'trip' | 'yard' | 'home' | 'door';

/** Frame what matters now: the whole trip before there is a truck, the leg being driven, the door at the end. */
function frame(r: Layers, plan: Plan, view: View, calm: boolean) {
  const { city, legs } = plan;
  const anim = { animate: !calm, duration: 1 };
  if (view === 'door') r.map.flyTo([city.drop.lat, city.drop.lng], 16, anim);
  else {
    const coords = view === 'trip' ? [...legs[0].coords, ...legs[1].coords] : legs[view === 'yard' ? 0 : 1].coords;
    /* Wider padding sideways than up and down, because a pin carries its name beside it and a
       pin fitted snugly against the edge has its label clipped by the map's own overflow. On a
       375px phone the yard's label ran off the right edge at the tightest fit. */
    r.map.fitBounds(L.latLngBounds(latLngs(coords)), { paddingTopLeft: [72, 40], paddingBottomRight: [72, 56], maxZoom: 16, ...anim });
  }
  r.behind.setLatLngs(latLngs(legs[view === 'yard' ? 0 : 1].coords));
  r.pins[0].getElement()?.classList.toggle('is-target', view === 'yard');
  r.pins[1].getElement()?.classList.toggle('is-target', view === 'home');
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

    const road = (cls: string, weight: number, opacity: number) =>
      L.polyline([], { className: cls, color: '#56d3d8', weight, opacity, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);
    const behind = road('tk-road-behind', 5, 0.22);
    const glow = road('tk-road-glow', 16, 0.16);
    const ahead = road('tk-road', 5, 0.95);

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
    layers.current = { map, truck, ahead, glow, behind, pins };
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

  /* Sixty times a second: move the truck, turn it, shorten the road ahead, keep it in view. */
  React.useEffect(() => {
    let lastPan = 0;
    return subscribe((f) => {
      const r = layers.current;
      if (!r || !f.at) return;
      const ll = L.latLng(f.at.lat, f.at.lng);
      if (!r.map.hasLayer(r.truck)) r.truck.addTo(r.map);
      r.truck.setLatLng(ll);
      const body = r.truck.getElement()?.firstElementChild as HTMLElement | null;
      if (body) body.style.transform = `rotate(${f.heading}deg)`;
      const rest = latLngs(f.remaining);
      r.ahead.setLatLngs(rest);
      r.glow.setLatLngs(rest);

      if (away.current || Date.now() - lastPan < 900) return;
      const p = r.map.latLngToContainerPoint(ll);
      const s = r.map.getSize();
      if (p.x < s.x * 0.18 || p.x > s.x * 0.82 || p.y < s.y * 0.18 || p.y > s.y * 0.82) {
        r.map.panTo(ll, { animate: !calm, duration: 0.8 });
        lastPan = Date.now();
      }
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
