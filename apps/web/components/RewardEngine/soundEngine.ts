import type { RewardTier } from './types';

let audioCtx: AudioContext | null = null;
let isMuted = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function setSoundMuted(muted: boolean) {
  isMuted = muted;
  if (typeof window !== 'undefined') {
    localStorage.setItem('bo_engine_sound_muted', String(muted));
  }
}

export function getSoundMuted(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('bo_engine_sound_muted') === 'true';
}

/** Activation Sound: Low-frequency machine hum (55Hz) + solenoid latch click */
export function playActivationSound() {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Sub-bass machine power hum
  const humOsc = ctx.createOscillator();
  const humGain = ctx.createGain();
  humOsc.type = 'sine';
  humOsc.frequency.setValueAtTime(60, now);
  humOsc.frequency.exponentialRampToValueAtTime(35, now + 0.4);

  humGain.gain.setValueAtTime(0.28, now);
  humGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  humOsc.connect(humGain);
  humGain.connect(ctx.destination);

  humOsc.start(now);
  humOsc.stop(now + 0.4);

  // Precision solenoid latch snap
  const clickOsc = ctx.createOscillator();
  const clickGain = ctx.createGain();
  clickOsc.type = 'triangle';
  clickOsc.frequency.setValueAtTime(1900, now);
  clickOsc.frequency.exponentialRampToValueAtTime(140, now + 0.045);

  clickGain.gain.setValueAtTime(0.2, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

  clickOsc.connect(clickGain);
  clickGain.connect(ctx.destination);

  clickOsc.start(now);
  clickOsc.stop(now + 0.045);
}

/** Chamber Ratchet Tick: Crisp metallic sector click */
export function playTickSound(intensity = 1) {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  const freq = 950 + Math.random() * 200;
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(90, now + 0.024);

  const vol = Math.min(0.22, 0.06 + intensity * 0.14);
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.024);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.024);
}

/** Mechanical Lock Sound: Heavy precision latch stop */
export function playLockSound() {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Solid mechanical stop punch
  const punch = ctx.createOscillator();
  const punchGain = ctx.createGain();
  punch.type = 'sine';
  punch.frequency.setValueAtTime(160, now);
  punch.frequency.exponentialRampToValueAtTime(45, now + 0.2);

  punchGain.gain.setValueAtTime(0.35, now);
  punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  punch.connect(punchGain);
  punchGain.connect(ctx.destination);

  punch.start(now);
  punch.stop(now + 0.2);

  // High-frequency steel contact
  const click = ctx.createOscillator();
  const clickGain = ctx.createGain();
  click.type = 'square';
  click.frequency.setValueAtTime(2200, now);
  click.frequency.exponentialRampToValueAtTime(320, now + 0.035);

  clickGain.gain.setValueAtTime(0.15, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

  click.connect(clickGain);
  clickGain.connect(ctx.destination);

  click.start(now);
  click.stop(now + 0.035);
}

/** Output Generation Tonal Chime */
export function playRewardSound(tier: RewardTier) {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  if (tier === 100) {
    // 100 MAX OUTPUT: Deep industrial impact + crystalline teal harmonic shimmer
    const chord = [130.81, 196.0, 261.63, 329.63, 392.0, 523.25, 659.25, 1046.5];
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i < 2 ? 'sine' : 'triangle';
      const delay = now + i * 0.05;

      osc.frequency.setValueAtTime(freq, delay);
      gain.gain.setValueAtTime(0.16, delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, delay + 1.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(delay);
      osc.stop(delay + 1.4);
    });
  } else if (tier === 80) {
    // 80 BO COINS: Strong teal/silver resonance
    [261.63, 329.63, 392.0, 523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const delay = now + i * 0.06;

      osc.frequency.setValueAtTime(freq, delay);
      gain.gain.setValueAtTime(0.14, delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, delay + 0.95);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(delay);
      osc.stop(delay + 0.95);
    });
  } else if (tier === 60) {
    // 60 BO COINS
    [293.66, 369.99, 440.0, 587.33].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const delay = now + i * 0.065;

      osc.frequency.setValueAtTime(freq, delay);
      gain.gain.setValueAtTime(0.12, delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, delay + 0.85);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(delay);
      osc.stop(delay + 0.85);
    });
  } else if (tier === 40) {
    // 40 BO COINS
    [329.63, 415.3, 493.88].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const delay = now + i * 0.07;

      osc.frequency.setValueAtTime(freq, delay);
      gain.gain.setValueAtTime(0.11, delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, delay + 0.75);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(delay);
      osc.stop(delay + 0.75);
    });
  } else if (tier === 20) {
    // 20 BO COINS
    [392.0, 493.88].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const delay = now + i * 0.07;

      osc.frequency.setValueAtTime(freq, delay);
      gain.gain.setValueAtTime(0.1, delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, delay + 0.65);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(delay);
      osc.stop(delay + 0.65);
    });
  } else {
    // 0 BO COINS: Quiet, dignified confirmation tone (no punitive loss sound)
    [220.0, 329.63].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const delay = now + i * 0.09;

      osc.frequency.setValueAtTime(freq, delay);
      gain.gain.setValueAtTime(0.07, delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, delay + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(delay);
      osc.stop(delay + 0.55);
    });
  }
}
