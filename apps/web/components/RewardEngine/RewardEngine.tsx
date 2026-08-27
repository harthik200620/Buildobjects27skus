'use client';

import React from 'react';
import { IconClose, IconCoin, IconVolumeOff, IconVolumeOn } from '@/components/icons';
import { addBoCoins, getBoCoins, markWheelSpun } from '@/lib/coins';
import { ElevatorScene, FLOORS } from './ElevatorScene';
import { triggerHaptic } from './hapticEngine';
import Odometer from './Odometer';
import { getSoundMuted, playActivationSound, playLockSound, playRewardSound, playTickSound, setSoundMuted } from './soundEngine';
import type { RewardTier } from './types';

/**
 * THE BO LIFT.
 *
 * ── THE SEQUENCE, WHICH IS THE WHOLE DESIGN ─────────────────────────────────────────────────
 * The coins are in the car with the doors open, turning under the light. You press the call
 * button. The doors close OVER them — they are occluded, not faded, which is the only version of
 * "and now you cannot see them" a viewer believes. The car rides: the shaft streams past, floor
 * plates flick by, the indicator counts. It decelerates, settles on its springs, and the doors
 * part on what it brought back.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────────────────────
 * A token orbiting six rooms of a cutaway house on a 2D SVG, with the reward decided by which
 * room it stopped in. It worked and it was a wheel wearing a floor plan: the motion was a loop,
 * so the ending was always "it went round again and this time it stopped". A lift has somewhere
 * to be. It goes there, and arriving is the event.
 *
 * ── THE STATE MACHINE IS THE SCENE'S ────────────────────────────────────────────────────────
 * This component owns no animation clock. ElevatorScene runs one rAF and calls back at the four
 * moments that matter — closed, each floor passed, arrived, open — and every sound, every haptic
 * and every UI change hangs off those. Two timelines that have to agree about when a door shut
 * is a bug waiting for a slow frame; there is one, and it is the one drawing the door.
 *
 * ── AND IT DEGRADES ─────────────────────────────────────────────────────────────────────────
 * No WebGL, or `prefers-reduced-motion`: the scene resolves straight to open on the result and
 * the panel is a card with a figure on it. Nobody is shown a black rectangle and nobody who has
 * asked for less motion is given a two-and-a-half-second ride.
 */

/** What the lift can bring back, and how often. Weighted so 0 is possible and 100 is rare. */
const ODDS: Array<{ tier: RewardTier; weight: number }> = [
  { tier: 0, weight: 6 },
  { tier: 20, weight: 30 },
  { tier: 40, weight: 26 },
  { tier: 60, weight: 20 },
  { tier: 80, weight: 12 },
  { tier: 100, weight: 6 },
];

function drawTier(): RewardTier {
  const total = ODDS.reduce((n, o) => n + o.weight, 0);
  let r = Math.random() * total;
  for (const o of ODDS) {
    r -= o.weight;
    if (r <= 0) return o.tier;
  }
  return 20;
}

type Phase = 'ready' | 'riding' | 'revealed';

export default function RewardEngine({ onClose, initialBalance }: { onClose?: () => void; initialBalance?: number }) {
  const [balance, setBalance] = React.useState(initialBalance ?? 0);
  const [phase, setPhase] = React.useState<Phase>('ready');
  const [won, setWon] = React.useState<RewardTier | null>(null);
  const [floor, setFloor] = React.useState(0);
  const [muted, setMuted] = React.useState(false);
  const [webgl, setWebgl] = React.useState(true);

  const host = React.useRef<HTMLDivElement>(null);
  const scene = React.useRef<ElevatorScene | null>(null);

  React.useEffect(() => {
    setBalance(getBoCoins());
    setMuted(getSoundMuted());
  }, []);

  /* The scene is mounted once and lives for the panel's lifetime. Its own loop pauses when the
     tab is hidden and stops entirely on dispose, so an open panel behind another tab costs
     nothing at all. */
  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let live = true;
    ElevatorScene.mount(el, reduced).then((s) => {
      if (!live) {
        s?.dispose();
        return;
      }
      if (!s) setWebgl(false);
      scene.current = s;
    });
    /* A ResizeObserver, not a window listener: the stage is a flex child whose height comes from
       whatever the chrome above it leaves, so it changes size when the RESULT LINE grows by a
       line — an event `resize` never fires for, and one that would otherwise leave the canvas
       stretched at the old aspect for the rest of the session. */
    const ro = new ResizeObserver(() => scene.current?.resize());
    ro.observe(el);
    return () => {
      live = false;
      ro.disconnect();
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  const call = React.useCallback(() => {
    if (phase !== 'ready') return;
    const tier = drawTier();
    const index = FLOORS.indexOf(tier);
    setWon(null);
    setPhase('riding');
    playActivationSound();
    triggerHaptic('activation');

    const finish = () => {
      setWon(tier);
      setPhase('revealed');
      playRewardSound(tier);
      triggerHaptic(tier === 100 ? 'jackpot' : tier === 0 ? 'zero' : 'reward');
      /* Record and credit are two calls on purpose — see lib/coins.ts. A zero floor still
         counts as the ride having happened; it just pays nothing. */
      markWheelSpun();
      if (tier > 0) setBalance(addBoCoins(tier, `BO Lift — ${tier} coins`));
    };

    if (!scene.current) {
      /* No scene to ride. Still a reward, just without the journey. */
      finish();
      return;
    }

    scene.current.ride(index, {
      onFloor: (n) => {
        setFloor(n);
        playTickSound(0.55);
        triggerHaptic('tick');
      },
      onArrived: () => {
        playLockSound();
        triggerHaptic('lock');
      },
      onOpen: finish,
    });
  }, [phase]);

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
  };

  return (
    <div className="bolift" data-phase={phase}>
      <header className="bolift-head">
        <div>
          <p className="micro bolift-eyebrow">BO Coins</p>
          <h2 className="bolift-title">The lift</h2>
        </div>
        <div className="bolift-tools">
          <button type="button" className="bolift-tool" onClick={toggleSound} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>
            {muted ? <IconVolumeOff size={17} /> : <IconVolumeOn size={17} />}
          </button>
          {onClose && (
            <button type="button" className="bolift-tool" onClick={onClose} aria-label="Close">
              <IconClose size={17} />
            </button>
          )}
        </div>
      </header>

      {/* ── the balance ─────────────────────────────────────────────────────
          It sits ABOVE the lift and stays there the whole time, because the number going up is
          the point of the machine and hiding it until the end would make the ride the point. */}
      <div className="bolift-balance">
        <span className="bolift-balance-label micro">
          <IconCoin size={14} accent="var(--amber-700)" /> Your balance
        </span>
        <span className="bolift-balance-fig">
          <Odometer value={balance} min={2} aria-label={`${balance} BO Coins`} />
        </span>
        {/* The credit flies off the odometer as it rolls. Keyed on the win so it re-mounts and
            replays even when the same tier comes up twice running. */}
        {phase === 'revealed' && won !== null && won > 0 && (
          <span key={`${won}-${balance}`} className="bolift-credit fig">
            +{won}
          </span>
        )}
      </div>

      <div className="bolift-stage" ref={host} aria-hidden="true">
        {!webgl && <div className="bolift-nogl" />}
      </div>

      {/* ── what it brought back ────────────────────────────────────────── */}
      <div className="bolift-result" aria-live="polite">
        {phase === 'ready' && <p className="bolift-say">Call the lift. Whatever is in it is yours.</p>}
        {phase === 'riding' && <p className="bolift-say bolift-say--live">Rising · floor {String(floor).padStart(2, '0')}</p>}
        {phase === 'revealed' && won !== null && (
          <p className="bolift-say bolift-say--win">
            {won === 0 ? 'Empty this time. The lift runs again tomorrow.' : `${won} BO Coins — added to your balance.`}
          </p>
        )}
      </div>

      <div className="bolift-actions">
        {phase === 'revealed' ? (
          <button type="button" className="btn btn-primary bolift-go" onClick={onClose}>
            Done
          </button>
        ) : (
          <button type="button" className="btn btn-primary bolift-go" onClick={call} disabled={phase === 'riding'}>
            {phase === 'riding' ? 'Rising…' : 'Call the lift'}
          </button>
        )}
        <p className="bolift-fine micro">One coin is worth one rupee off any order.</p>
      </div>
    </div>
  );
}
