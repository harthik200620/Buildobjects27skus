'use client';

import { formatNumber } from '@buildobjects/catalog';
import React from 'react';
import { IconClose, IconCoin, IconEngine, IconSettings, IconVolumeOff, IconVolumeOn } from '@/components/icons';
import { addBoCoins, getBoCoins, resetWheelStatus } from '@/lib/coins';
import HouseScene from './HouseScene';
import { triggerHaptic } from './hapticEngine';
import { getSoundMuted, playActivationSound, playLockSound, playRewardSound, playTickSound, setSoundMuted } from './soundEngine';
import { calculateTokenTarget, getClosestRoomIndex, tokenKineticEase } from './spinMath';
import { type EngineState, type RewardTier, ROOM_WAYPOINTS, type RoomWaypoint } from './types';

/** How long the balance counter takes to roll to a new value. */
const BALANCE_ROLL_MS = 1_200;
/** Fraction of the journey after which the engine switches to its locking state. */
const LOCK_AT_PROGRESS = 0.75;
/** Pause between pressing the button and the token leaving, so the power-up sound lands first. */
const ACTIVATION_DELAY_MS = 340;

export default function RewardEngine({ onClose, initialBalance }: { onClose?: () => void; initialBalance?: number }) {
  const [balance, setBalance] = React.useState(initialBalance ?? 0);
  const [displayBalance, setDisplayBalance] = React.useState(initialBalance ?? 0);
  const [engineState, setEngineState] = React.useState<EngineState>('READY');
  const [currentStep, setCurrentStep] = React.useState(0);
  const [activeRoomIndex, setActiveRoomIndex] = React.useState(0);
  const [winningRoom, setWinningRoom] = React.useState<RoomWaypoint | null>(null);
  const [isBalancePulsing, setIsBalancePulsing] = React.useState(false);
  const [isMuted, setIsMutedState] = React.useState(false);
  const [showDebug, setShowDebug] = React.useState(false);

  React.useEffect(() => {
    const b = getBoCoins();
    setBalance(b);
    setDisplayBalance(b);
    setIsMutedState(getSoundMuted());
  }, []);

  /**
   * Odometer roll from the displayed balance to the real one.
   *
   * The starting value is read from a ref, not from `displayBalance` state: the effect writes
   * that state on every frame, so depending on it would tear the animation down and restart it
   * sixty times a second, each restart resetting the clock and never reaching the target.
   */
  const displayBalanceRef = React.useRef(displayBalance);
  displayBalanceRef.current = displayBalance;
  React.useEffect(() => {
    const from = displayBalanceRef.current;
    if (from === balance) return;

    const startTime = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / BALANCE_ROLL_MS);
      const eased = 1 - (1 - progress) ** 4;
      setDisplayBalance(Math.round(from + (balance - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [balance]);

  const orbitAnimationRef = React.useRef<number | null>(null);

  const startTokenJourney = (forceTier?: RewardTier) => {
    if (engineState !== 'READY' && engineState !== 'COMPLETE') return;

    setEngineState('POWERING');
    setWinningRoom(null);
    playActivationSound();
    triggerHaptic('activation');

    setTimeout(() => {
      const target = calculateTokenTarget(forceTier, currentStep);
      setEngineState('TRAVELING');

      const startStep = currentStep;
      const totalDelta = target.overshootStep - startStep;
      const startTime = performance.now();
      const duration = target.durationMs;

      let lastRoomIdx = -1;
      let locked = false;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);

        const eased = tokenKineticEase(progress);
        const newStep = startStep + totalDelta * eased;
        const velocity = (1 - progress) * 20;

        // Check active passing room for audio ratchet tick & visual illumination
        const currentRoomIdx = getClosestRoomIndex(newStep);
        setActiveRoomIndex(currentRoomIdx);

        if (currentRoomIdx !== lastRoomIdx) {
          lastRoomIdx = currentRoomIdx;
          playTickSound(Math.min(1, velocity / 10));
          triggerHaptic('tick');
        }

        setCurrentStep(newStep);

        if (progress < 1) {
          // `engineState` here is the value captured when the journey started, so it can never
          // read 'LOCKING'. The local flag is what actually makes this fire once.
          if (progress > LOCK_AT_PROGRESS && !locked) {
            locked = true;
            setEngineState('LOCKING');
          }
          orbitAnimationRef.current = requestAnimationFrame(animate);
        } else {
          // Final landing: Overshoot settle to exact target step
          settleToTarget(target.targetStep, target.room);
        }
      };

      orbitAnimationRef.current = requestAnimationFrame(animate);
    }, ACTIVATION_DELAY_MS);
  };

  const settleToTarget = (finalStep: number, room: RoomWaypoint) => {
    setEngineState('STILLNESS');
    setCurrentStep(finalStep);
    setWinningRoom(room);
    playLockSound();
    triggerHaptic('lock');

    // 220ms moment of stillness before reward emergence
    setTimeout(() => {
      setEngineState('REVEALED');
      playRewardSound(room.value);
      if (room.isMaxOutput) triggerHaptic('jackpot');
      else if (room.isZero) triggerHaptic('zero');
      else triggerHaptic('reward');

      // Credit balance and animate coin particles
      setTimeout(() => {
        if (!room.isZero) {
          const newBal = addBoCoins(room.value, `BO House Engine Reward (+${room.value} Coins)`);
          setBalance(newBal);
          setIsBalancePulsing(true);
          setTimeout(() => setIsBalancePulsing(false), 900);
        }
        setEngineState('COMPLETE');
      }, 1100);
    }, 220);
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMutedState(next);
    setSoundMuted(next);
  };

  const handleReset = () => {
    resetWheelStatus();
    setEngineState('READY');
    setWinningRoom(null);
    setCurrentStep(0);
    setActiveRoomIndex(0);
  };

  const isBusy = engineState !== 'READY' && engineState !== 'COMPLETE';

  const buttonText =
    engineState === 'READY'
      ? 'ACTIVATE ENGINE'
      : engineState === 'POWERING'
        ? 'POWERING UP…'
        : engineState === 'TRAVELING'
          ? 'TRAVELING ROOM TO ROOM…'
          : engineState === 'LOCKING'
            ? 'LOCKING ROOM…'
            : engineState === 'STILLNESS' || engineState === 'REVEALED'
              ? winningRoom?.isZero
                ? '0 BO COINS · CYCLE COMPLETE'
                : `+${winningRoom?.value} BO COINS CREDITED`
              : 'ACTIVATE ENGINE AGAIN';

  const formattedBalance = formatNumber(displayBalance);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '88vh',
        background: 'var(--color-ink)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '24px 16px',
        userSelect: 'none',
      }}
    >
      {/* ── Top Bar: Brand, Balance Odometer, Mute & Close ───────── */}
      <div
        style={{
          width: '100%',
          maxWidth: '1080px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          zIndex: 20,
        }}
      >
        {/* Brand & Concept Tag */}
        <div>
          <div
            style={{
              fontSize: '18px',
              fontWeight: 700,
              color: 'var(--color-canvas)',
              letterSpacing: '-0.02em',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>BO ENGINE</span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-teal-600)',
                background: 'rgb(30 74 85 / 10%)',
                border: '1px solid rgb(30 74 85 / 25%)',
                padding: '2px 8px',
                borderRadius: '999px',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              The House Is The Wheel
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--color-ink-3)', marginTop: '2px' }}>Watch the BO Engine travel room to room around the house.</div>
        </div>

        {/* Live Balance Pill & Audio Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Floating Balance Odometer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'var(--color-ink)',
              border: '1px solid var(--color-ink-2)',
              borderRadius: '999px',
              padding: '6px 16px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
              transform: isBalancePulsing ? 'scale(1.08)' : 'scale(1)',
              transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <IconCoin size={15} style={{ color: 'var(--color-canvas)' }} />
            <span
              style={{
                fontSize: '16px',
                fontWeight: 700,
                color: 'var(--color-canvas)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formattedBalance}
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-teal-600)',
                letterSpacing: '0.08em',
              }}
            >
              BO COINS
            </span>
          </div>

          {/* Audio Toggle */}
          <button
            type="button"
            onClick={toggleMute}
            style={{
              background: 'var(--color-ink)',
              border: '1px solid var(--color-ink-2)',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              fontSize: '13px',
              color: 'var(--color-line-strong)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
            }}
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isMuted ? <IconVolumeOff size={16} /> : <IconVolumeOn size={16} />}
          </button>

          {/* Close for Modal Mode */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'var(--color-ink)',
                border: '1px solid var(--color-ink-2)',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                fontSize: '14px',
                color: 'var(--color-line-strong)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              }}
              title="Close"
            >
              <IconClose size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── Center Hero: Clean Daylight Cutaway House & Physical Token ── */}
      <HouseScene
        currentStep={currentStep}
        engineState={engineState}
        onActivate={() => startTokenJourney()}
        activeRoomIndex={activeRoomIndex}
        winningRoom={winningRoom}
        balance={balance}
        isBalancePulsing={isBalancePulsing}
      />

      {/* ── Bottom Controls: Sleek ACTIVATE ENGINE Action Pill ───── */}
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          marginTop: '20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          zIndex: 20,
        }}
      >
        <button
          type="button"
          onClick={() => startTokenJourney()}
          disabled={isBusy}
          style={{
            width: '100%',
            height: '52px',
            borderRadius: '16px',
            background: isBusy
              ? 'linear-gradient(135deg, var(--color-line), var(--color-canvas-2))'
              : 'linear-gradient(135deg, var(--color-teal-600), var(--color-canvas-2))',
            border: 'none',
            color: 'var(--color-ink)',
            fontSize: '15px',
            fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: isBusy ? 'default' : 'pointer',
            boxShadow: isBusy ? 'none' : '0 10px 25px rgb(30 74 85 / 40%), 0 2px 6px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
          }}
        >
          <IconEngine size={16} />
          <span>{buttonText}</span>
        </button>

        <div style={{ fontSize: '11px', color: 'var(--color-ink-3)', fontWeight: 600 }}>1 BO Coin = ₹1 cash discount in your BO Cart at checkout</div>
      </div>

      {/*
        The QA panel — development only.
        
        It was shipping. A 23 px button at 25% black, captioned "Toggle QA Test Panel", sat in the
        corner of a modal that opens itself for every first-time visitor, and behind it was a
        FORCE ROOM row that hands out coins on demand. Internal tooling in front of customers is
        bad on its own; internal tooling that mints the store's currency is worse. The condition
        is checked at render rather than at import so the whole panel is dead code in a
        production bundle.
      */}
      {process.env.NODE_ENV !== 'production' && (
        <div style={{ position: 'absolute', bottom: '12px', right: '16px', zIndex: 100 }}>
          <button
            type="button"
            onClick={() => setShowDebug((d) => !d)}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(0,0,0,0.25)',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '4px',
            }}
            title="Toggle QA Test Panel"
          >
            <IconSettings size={15} />
          </button>

          {showDebug && (
            <div
              style={{
                position: 'absolute',
                bottom: '30px',
                right: '0',
                background: 'var(--color-ink)',
                border: '1px solid var(--color-ink-2)',
                borderRadius: '12px',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--color-ink-3)', fontWeight: 700 }}>FORCE ROOM:</span>
              {ROOM_WAYPOINTS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => startTokenJourney(r.value)}
                  disabled={isBusy}
                  style={{
                    background: 'var(--color-teal-600)',
                    border: 'none',
                    borderRadius: '6px',
                    color: 'var(--color-ink)',
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '4px 8px',
                    cursor: 'pointer',
                  }}
                >
                  {r.value}
                </button>
              ))}
              <button
                type="button"
                onClick={handleReset}
                style={{
                  background: 'var(--color-ink-3)',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'var(--color-ink)',
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '4px 8px',
                  cursor: 'pointer',
                }}
              >
                RESET
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
