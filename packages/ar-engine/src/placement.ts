import type { PlacementRule, SceneType, Surface } from './types';

export const PLACEMENT_RULES_VERSION = 2;

const INDOOR: SceneType[] = ['living_room', 'bedroom', 'kitchen', 'bathroom', 'office', 'corridor'];

/**
 * Per-category placement rules. The gate reads `scenes` / `surfaces`; the placer reads the
 * anchor, offset and orientation; the composite reads `integration`. Adding a category = one
 * entry here and a GLB in assets/3d.
 */
export const PLACEMENT_RULES: Record<string, PlacementRule> = {
  bulbs: {
    category: 'bulbs',
    surfaces: ['ceiling', 'wall'],
    scenes: 'any',
    orientation: 'hanging',
    anchor: 'top',
    mountOffsetMm: 40,
    heightBandMm: [2100, 2900],
    minClearanceMm: 50,
    surfaceLabel: 'ceiling or a wall light point',
    integration: 'recessed',
  },
  cctv: {
    category: 'cctv',
    surfaces: ['wall', 'ceiling'],
    scenes: 'any',
    orientation: 'wall_flush',
    anchor: 'back',
    mountOffsetMm: 0,
    heightBandMm: [2200, 3000],
    minClearanceMm: 100,
    surfaceLabel: 'wall or ceiling, high up',
    integration: 'mounted',
  },
  tiles: {
    category: 'tiles',
    surfaces: ['floor', 'wall'],
    scenes: 'any',
    orientation: 'flat',
    anchor: 'bottom',
    mountOffsetMm: 0,
    minClearanceMm: 0,
    surfaceLabel: 'floor or wall',
    integration: 'resurfaces',
  },
  glass: {
    category: 'glass',
    surfaces: ['window', 'wall'],
    scenes: 'any',
    orientation: 'wall_flush',
    anchor: 'back',
    mountOffsetMm: 0,
    minClearanceMm: 0,
    surfaceLabel: 'window or a wall opening',
    integration: 'replaces_pane',
  },
  'solar-panels': {
    category: 'solar-panels',
    surfaces: ['roof', 'ground'],
    scenes: ['roof', 'exterior', 'site'],
    rejectScenes: INDOOR,
    orientation: 'flat',
    anchor: 'bottom',
    mountOffsetMm: 150,
    minClearanceMm: 200,
    surfaceLabel: 'roof or open ground',
    integration: 'rests_on',
  },
  'fire-extinguishers': {
    category: 'fire-extinguishers',
    surfaces: ['wall', 'floor'],
    scenes: 'any',
    orientation: 'upright',
    anchor: 'back',
    mountOffsetMm: 20,
    heightBandMm: [800, 1200],
    minClearanceMm: 150,
    surfaceLabel: 'wall, about a metre up',
    integration: 'mounted',
  },
  cement: {
    category: 'cement',
    surfaces: ['floor', 'ground'],
    scenes: 'any',
    orientation: 'flat',
    anchor: 'bottom',
    mountOffsetMm: 0,
    minClearanceMm: 0,
    surfaceLabel: 'floor',
    integration: 'rests_on',
  },
  epoxy: {
    category: 'epoxy',
    surfaces: ['floor', 'table', 'ground'],
    scenes: 'any',
    orientation: 'upright',
    anchor: 'bottom',
    mountOffsetMm: 0,
    minClearanceMm: 0,
    surfaceLabel: 'floor or a table',
    integration: 'rests_on',
  },
  'total-stations': {
    category: 'total-stations',
    surfaces: ['ground', 'floor'],
    scenes: ['site', 'exterior', 'roof'],
    rejectScenes: ['bathroom', 'bedroom', 'kitchen'],
    orientation: 'upright',
    anchor: 'bottom',
    mountOffsetMm: 1500,
    minClearanceMm: 300,
    surfaceLabel: 'open ground or a site',
    integration: 'stands_on',
  },
  /** The spec's canonical refusal case: a bathtub does not belong in a living room. */
  bathtub: {
    category: 'bathtub',
    surfaces: ['floor'],
    scenes: ['bathroom'],
    rejectScenes: ['living_room', 'bedroom', 'kitchen', 'office', 'corridor', 'exterior', 'site', 'roof'],
    orientation: 'flat',
    anchor: 'bottom',
    mountOffsetMm: 0,
    minClearanceMm: 300,
    surfaceLabel: 'bathroom floor against a wall',
    integration: 'rests_on',
  },
};

export function ruleFor(category: string): PlacementRule {
  return (
    PLACEMENT_RULES[category] ?? {
      category,
      surfaces: ['floor'],
      scenes: 'any',
      orientation: 'upright',
      anchor: 'bottom',
      mountOffsetMm: 0,
      minClearanceMm: 0,
      surfaceLabel: 'floor',
      integration: 'rests_on',
    }
  );
}

export const SURFACE_LABEL: Record<Surface, string> = {
  floor: 'floor',
  wall: 'wall',
  ceiling: 'ceiling',
  window: 'window',
  roof: 'roof',
  ground: 'open ground',
  table: 'table',
};
export const SCENE_LABEL: Record<SceneType, string> = {
  living_room: 'Living room',
  bedroom: 'Bedroom',
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  office: 'Office',
  corridor: 'Corridor',
  exterior: 'Outside a building',
  site: 'Construction site',
  roof: 'Roof',
  unknown: 'Unknown',
};
