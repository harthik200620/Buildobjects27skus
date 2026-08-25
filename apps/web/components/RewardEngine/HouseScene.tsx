'use client';

import { formatNumber } from '@buildobjects/catalog';
import React from 'react';
import { getTokenPosition } from './spinMath';
import { type EngineState, ROOM_WAYPOINTS, type RoomWaypoint } from './types';

export default function HouseScene({
  currentStep,
  engineState,
  onActivate,
  activeRoomIndex,
  winningRoom,
  balance,
  isBalancePulsing,
}: {
  currentStep: number;
  engineState: EngineState;
  onActivate: () => void;
  activeRoomIndex: number;
  winningRoom: RoomWaypoint | null;
  balance: number;
  isBalancePulsing: boolean;
}) {
  const isBusy = engineState !== 'READY' && engineState !== 'COMPLETE';
  const isLocked = engineState === 'STILLNESS' || engineState === 'REVEALED' || engineState === 'COMPLETE';

  // Compute exact physical coordinates of the small traveling BO Engine token
  const tokenPos = getTokenPosition(currentStep);

  // Live animated rolling counter for the Total Coins HUD display
  const [hudDisplayValue, setHudDisplayValue] = React.useState(balance);
  const animRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const startVal = hudDisplayValue;
    const targetVal = balance;
    if (startVal === targetVal) return;

    const startTime = performance.now();
    const duration = 1200; // ms

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = 1 - (1 - progress) ** 4;
      const current = Math.round(startVal + (targetVal - startVal) * ease);
      setHudDisplayValue(current);

      if (progress < 1) {
        animRef.current = requestAnimationFrame(step);
      }
    };

    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [balance, hudDisplayValue]);

  // Canvas for coin particles flying from winning room to top HUD counter
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (engineState !== 'REVEALED' || !winningRoom) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    if (winningRoom.isZero) return;

    // Origin: Selected Room
    const originX = (canvas.offsetWidth * winningRoom.xPct) / 100;
    const originY = (canvas.offsetHeight * winningRoom.yPct) / 100;

    // Target: Center of the Total BO Coins HUD counter at top center
    const targetX = canvas.offsetWidth * 0.5;
    const targetY = 38;

    const particles: Array<{
      x: number;
      y: number;
      progress: number;
      speed: number;
      controlX: number;
      controlY: number;
      size: number;
      color: string;
      delay: number;
    }> = [];

    const colors = ['#12AFA9', '#45D7CF', '#087F80', '#FFFFFF', '#E5EAEB'];
    const count = winningRoom.isMaxOutput ? 36 : 24;

    for (let i = 0; i < count; i++) {
      const spreadX = (Math.random() - 0.5) * 80;
      const spreadY = (Math.random() - 0.5) * 60;
      particles.push({
        x: originX,
        y: originY,
        progress: 0,
        speed: 0.018 + Math.random() * 0.012,
        controlX: (originX + targetX) / 2 + spreadX,
        controlY: Math.min(originY, targetY) - 50 + spreadY,
        size: 3 + Math.random() * 3.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        delay: i * 24,
      });
    }

    const startTime = performance.now();
    let animId: number;

    const render = (now: number) => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      let anyAlive = false;

      for (const p of particles) {
        const elapsed = now - startTime;
        if (elapsed < p.delay) {
          anyAlive = true;
          continue;
        }

        p.progress += p.speed;
        if (p.progress <= 1) {
          anyAlive = true;
          const t = p.progress;
          const oneMinusT = 1 - t;
          p.x = oneMinusT * oneMinusT * originX + 2 * oneMinusT * t * p.controlX + t * t * targetX;
          p.y = oneMinusT * oneMinusT * originY + 2 * oneMinusT * t * p.controlY + t * t * targetY;

          ctx.save();
          ctx.globalAlpha = Math.min(1, Math.sin(t * Math.PI) * 1.5);
          ctx.fillStyle = p.color;
          ctx.shadowColor = '#45D7CF';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      if (anyAlive) {
        animId = requestAnimationFrame(render);
      }
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [engineState, winningRoom]);

  const formattedHudBalance = formatNumber(hudDisplayValue);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '1080px',
        aspectRatio: '16 / 9',
        borderRadius: '28px',
        overflow: 'hidden',
        boxShadow: '0 30px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)',
        background: '#FFFFFF',
      }}
    >
      {/* ── 1. Clean Photorealistic Daylight Cutaway Indian House Background ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/bo-house-clean.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          zIndex: 1,
        }}
      />

      {/* Subtle Ambient Sunlight Depth Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,0.12) 100%)',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />

      {/* ── 2. Prominent TOTAL BO COINS Live Odometer HUD Counter (Always Visible at Top Center) ── */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '50%',
          transform: isBalancePulsing ? 'translateX(-50%) scale(1.1)' : 'translateX(-50%) scale(1)',
          zIndex: 35,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'linear-gradient(135deg, rgba(6, 63, 66, 0.92), rgba(5, 9, 10, 0.95))',
          border: isBalancePulsing ? '2px solid #45D7CF' : '1.5px solid rgba(18, 175, 169, 0.6)',
          borderRadius: '999px',
          padding: '8px 24px',
          boxShadow: isBalancePulsing
            ? '0 0 35px rgba(69, 215, 207, 0.9), 0 8px 24px rgba(0,0,0,0.6)'
            : '0 8px 25px rgba(0,0,0,0.4), 0 0 15px rgba(18, 175, 169, 0.3)',
          backdropFilter: 'blur(12px)',
          transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          pointerEvents: 'none',
        }}
      >
        <span style={{ fontSize: '18px' }}>🪙</span>
        <span style={{ fontSize: '11px', fontWeight: 800, color: '#BFC7C9', letterSpacing: '0.14em', textTransform: 'uppercase' }}>TOTAL COINS:</span>
        <span
          style={{
            fontSize: '22px',
            fontWeight: 900,
            color: '#FFFFFF',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em',
            textShadow: '0 0 12px #45D7CF',
          }}
        >
          {formattedHudBalance}
        </span>
        <span style={{ fontSize: '11px', fontWeight: 800, color: '#45D7CF', letterSpacing: '0.08em' }}>BO COINS</span>
      </div>

      {/* ── 3. Subtle Glowing Circuit Track Connecting the 6 Rooms ── */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1000 562"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        {/* Rounded Continuous Orbital Circuit */}
        <path
          d="M 500 202 L 760 202 Q 800 202 800 242 L 800 364 Q 800 404 760 404 L 240 404 Q 200 404 200 364 L 200 242 Q 200 202 240 202 Z"
          fill="none"
          stroke="#087F80"
          strokeWidth="2.5"
          strokeDasharray="6 6"
          opacity={isBusy ? 0.8 : 0.35}
          style={{
            filter: isBusy ? 'drop-shadow(0 0 8px rgba(18, 175, 169, 0.7))' : 'none',
            transition: 'opacity 0.3s ease, filter 0.3s ease',
          }}
        />

        {/* Room Node Measurement Markers on Track */}
        {ROOM_WAYPOINTS.map((room) => (
          <circle key={room.id} cx={`${room.xPct * 10}`} cy={`${room.yPct * 5.62}`} r="4" fill="#12AFA9" opacity={isBusy ? 0.9 : 0.45} />
        ))}
      </svg>

      {/* ── 4. Six Integrated Architectural Room Reward Plaques ── */}
      {ROOM_WAYPOINTS.map((room, idx) => {
        const isCurrentPassing = idx === activeRoomIndex && isBusy;
        const isWinner = winningRoom?.id === room.id && isLocked;

        return (
          <div
            key={room.id}
            style={{
              position: 'absolute',
              top: `${room.yPct}%`,
              left: `${room.xPct}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 20,
              pointerEvents: 'none',
            }}
          >
            {/* Room Warm Illumination Aura only active during spin / reveal, removed once count is complete */}
            {(isCurrentPassing || (isWinner && engineState !== 'COMPLETE')) && (
              <div
                style={{
                  position: 'absolute',
                  inset: '-28px',
                  borderRadius: '20px',
                  background: isWinner
                    ? 'radial-gradient(circle, rgba(69, 215, 207, 0.5) 0%, transparent 70%)'
                    : 'radial-gradient(circle, rgba(18, 175, 169, 0.35) 0%, transparent 70%)',
                  pointerEvents: 'none',
                  animation: engineState === 'REVEALED' ? 'pulse 1.2s infinite' : 'none',
                }}
              />
            )}

            {/* Architectural Deep Teal / Silver Plaque Inside Room */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '5px 12px',
                minWidth: '72px',
                borderRadius: '10px',
                background: isWinner
                  ? 'linear-gradient(135deg, rgba(8, 127, 128, 0.95), rgba(6, 63, 66, 0.95))'
                  : isCurrentPassing
                    ? 'linear-gradient(135deg, rgba(8, 127, 128, 0.85), rgba(6, 63, 66, 0.85))'
                    : 'linear-gradient(135deg, rgba(6, 63, 66, 0.85), rgba(5, 9, 10, 0.85))',
                border: isWinner ? '2px solid #45D7CF' : isCurrentPassing ? '1.5px solid #12AFA9' : '1px solid rgba(191, 199, 201, 0.35)',
                boxShadow: isWinner
                  ? '0 0 30px rgba(69, 215, 207, 0.8), 0 8px 20px rgba(0,0,0,0.6)'
                  : isCurrentPassing
                    ? '0 0 16px rgba(18, 175, 169, 0.6)'
                    : '0 4px 12px rgba(0,0,0,0.4)',
                transform: isWinner ? 'scale(1.15)' : isCurrentPassing ? 'scale(1.06)' : 'scale(1)',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span
                style={{
                  fontSize: '17px',
                  fontWeight: 900,
                  color: isWinner ? '#FFFFFF' : '#E5EAEB',
                  letterSpacing: '-0.02em',
                  lineHeight: '1.1',
                  textShadow: isWinner ? '0 0 12px #45D7CF' : '0 1px 4px rgba(0,0,0,0.8)',
                }}
              >
                {room.label}
              </span>
              <span
                style={{
                  fontSize: '7px',
                  fontWeight: 800,
                  color: isWinner ? '#45D7CF' : '#BFC7C9',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  marginTop: '1px',
                }}
              >
                {room.subLabel}
              </span>
            </div>
          </div>
        );
      })}

      {/* ── 5. The Small, Physical BO ENGINE Traveling Token (~44px) ── */}
      <button
        type="button"
        aria-label="Activate the BO Engine"
        disabled={isBusy}
        onClick={onActivate}
        style={{
          position: 'absolute',
          top: `${tokenPos.y}%`,
          left: `${tokenPos.x}%`,
          transform: 'translate(-50%, -50%)',
          zIndex: 35,
          cursor: isBusy ? 'default' : 'pointer',
          background: 'none',
          border: 'none',
          padding: 0,
        }}
      >
        {/* Subtle Ambient Laser Glow Aura */}
        <div
          style={{
            position: 'absolute',
            inset: '-10px',
            borderRadius: '50%',
            background: isBusy
              ? 'radial-gradient(circle, rgba(69, 215, 207, 0.7) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(18, 175, 169, 0.35) 0%, transparent 70%)',
            pointerEvents: 'none',
            animation: isBusy ? 'pulse 0.5s infinite' : 'none',
          }}
        />

        {/* The Precision Physical Marker Token (~44px) */}
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, #0f2b2e 0%, #030809 100%)',
            border: '2px solid #45D7CF',
            boxShadow: isBusy
              ? '0 0 25px rgba(69, 215, 207, 0.9), 0 8px 20px rgba(0,0,0,0.8), inset 0 0 10px rgba(6, 63, 66, 0.9)'
              : '0 0 12px rgba(18, 175, 169, 0.5), 0 8px 20px rgba(0,0,0,0.8), inset 0 0 10px rgba(6, 63, 66, 0.9)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {/* Inner Silver Ring */}
          <div
            style={{
              position: 'absolute',
              inset: '3px',
              borderRadius: '50%',
              border: '1px solid rgba(191, 199, 201, 0.35)',
              pointerEvents: 'none',
            }}
          />

          {/* Center Brand Typography */}
          <span
            style={{
              fontSize: '11px',
              fontWeight: 900,
              color: '#FFFFFF',
              letterSpacing: '0.04em',
              lineHeight: '1',
              textShadow: '0 1px 3px rgba(0,0,0,0.9)',
            }}
          >
            BO
          </span>
        </div>
      </button>

      {/* ── 6. Canvas for Coin Flight Animation from Winning Room ──── */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 40,
        }}
      />
    </div>
  );
}
