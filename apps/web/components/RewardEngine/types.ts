export type RewardTier = 0 | 20 | 40 | 60 | 80 | 100;

export interface RoomWaypoint {
  id: string;
  name: string;
  value: RewardTier;
  label: string;
  subLabel: string;
  xPct: number; // Percentage coordinate inside the cutaway house
  yPct: number;
  isMaxOutput?: boolean;
  isZero?: boolean;
}

export type EngineState = 'READY' | 'POWERING' | 'TRAVELING' | 'LOCKING' | 'STILLNESS' | 'REVEALED' | 'COMPLETE';

/**
 * The 6 Rooms of the Real Cutaway Indian Home
 * Loop order: Top-Center (100) -> Top-Right (20) -> Bottom-Right (40) -> Bottom-Center (0) -> Bottom-Left (60) -> Top-Left (80)
 */
export const ROOM_WAYPOINTS: RoomWaypoint[] = [
  {
    id: 'master-bedroom',
    name: 'Master Bedroom',
    value: 100,
    label: '100',
    subLabel: 'BO COINS',
    xPct: 50,
    yPct: 36,
    isMaxOutput: true,
  },
  {
    id: 'home-office',
    name: 'Home Office',
    value: 20,
    label: '20',
    subLabel: 'BO COINS',
    xPct: 76,
    yPct: 36,
  },
  {
    id: 'living-room',
    name: 'Living Room',
    value: 40,
    label: '40',
    subLabel: 'BO COINS',
    xPct: 76,
    yPct: 72,
  },
  {
    id: 'entrance-foyer',
    name: 'Main Entrance',
    value: 0,
    label: '0',
    subLabel: 'BO COINS',
    xPct: 50,
    yPct: 72,
    isZero: true,
  },
  {
    id: 'kitchen-dining',
    name: 'Kitchen & Dining',
    value: 60,
    label: '60',
    subLabel: 'BO COINS',
    xPct: 24,
    yPct: 72,
  },
  {
    id: 'library-study',
    name: 'Library & Study',
    value: 80,
    label: '80',
    subLabel: 'BO COINS',
    xPct: 24,
    yPct: 36,
  },
];
