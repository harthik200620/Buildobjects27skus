'use client';

import React from 'react';

/**
 * getUserMedia on a <video> with the iOS single-gesture order: (1) `DeviceOrientationEvent.
 * requestPermission()` when the browser has it, (2) `getUserMedia`, (3) `video.play()` — all
 * inside the same user gesture, so `start()` must be called from a tap on iOS (laptops and
 * Android auto-start, see `needsGesture`). Re-acquires the stream when the track ends or the
 * page comes back from the background, locks portrait on phones best-effort, and stops every
 * track on unmount.
 */
export type CameraStatus = 'idle' | 'requesting' | 'streaming' | 'denied' | 'error' | 'stopped';
export type OrientationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface CameraSettings {
  width: number;
  height: number;
  facingMode: string | null;
  frameRate: number | null;
  label: string;
}

export interface CameraStream {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: string | null;
  settings: CameraSettings | null;
  orientationPermission: OrientationPermission;
  /** Start (or restart) the stream. Pass `orientation: true` to ask for motion-sensor permission first (iOS). */
  start: (opts?: { orientation?: boolean; facingMode?: 'environment' | 'user' }) => Promise<boolean>;
  stop: () => void;
  /** True when this browser requires a tap before the sensors/camera can be opened (iOS Safari). */
  needsGesture: boolean;
}

type DOEWithPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export function hasOrientationPermissionApi(): boolean {
  return typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as DOEWithPermission).requestPermission === 'function';
}

/** iOS 13+: must run inside a user gesture. Elsewhere resolves 'unsupported' (no prompt exists — the events simply fire). */
export async function requestOrientationPermission(): Promise<OrientationPermission> {
  if (!hasOrientationPermissionApi()) return 'unsupported';
  try {
    const r = await (DeviceOrientationEvent as DOEWithPermission).requestPermission!();
    return r === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

const constraintsFor = (facingMode: 'environment' | 'user'): MediaStreamConstraints => ({
  video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } },
  audio: false,
});

function describeError(e: unknown): { status: CameraStatus; message: string } {
  const err = e as { name?: string; message?: string };
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError')
    return { status: 'denied', message: 'Camera permission denied — allow the camera in the browser settings, or use a photo' };
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return { status: 'error', message: 'No camera found on this device — use a photo instead' };
  if (name === 'NotReadableError' || name === 'TrackStartError')
    return { status: 'error', message: 'The camera is in use by another app — close it and try again' };
  if (name === 'OverconstrainedError') return { status: 'error', message: 'The camera does not support the requested mode' };
  if (typeof navigator !== 'undefined' && !navigator.mediaDevices?.getUserMedia)
    return { status: 'error', message: 'Camera needs HTTPS — open the https:// address (next dev --experimental-https) or use a photo' };
  return { status: 'error', message: `Camera unavailable (${err?.message ?? String(e)})` };
}

export function useCameraStream(): CameraStream {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const wantedRef = React.useRef<{ facingMode: 'environment' | 'user' } | null>(null);
  const [status, setStatus] = React.useState<CameraStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<CameraSettings | null>(null);
  const [orientationPermission, setOrientationPermission] = React.useState<OrientationPermission>(() =>
    typeof window !== 'undefined' && hasOrientationPermissionApi() ? 'prompt' : 'unsupported',
  );
  const needsGesture = typeof window !== 'undefined' && hasOrientationPermissionApi();

  const stop = React.useCallback(() => {
    wantedRef.current = null;
    streamRef.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch {
        /* ignore */
      }
      v.srcObject = null;
    }
    setStatus('stopped');
  }, []);

  const open = React.useCallback(async (facingMode: 'environment' | 'user'): Promise<boolean> => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      const d = describeError(new Error('no mediaDevices'));
      setStatus(d.status);
      setError(d.message);
      return false;
    }
    setStatus('requesting');
    setError(null);
    try {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraintsFor(facingMode));
      } catch (e1) {
        // Retry with generic constraints (works reliably on laptop webcams & edge browsers)
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch {
          throw e1;
        }
      }
      if (!stream) throw new Error('Could not acquire video stream');
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const s = track?.getSettings() ?? {};
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        v.autoplay = true;

        const markStreaming = () => {
          setSettings({
            width: s.width ?? v?.videoWidth ?? 0,
            height: s.height ?? v?.videoHeight ?? 0,
            facingMode: (s as { facingMode?: string }).facingMode ?? null,
            frameRate: s.frameRate ?? null,
            label: track?.label ?? '',
          });
          setStatus('streaming');
        };

        v.onloadedmetadata = () => {
          v.play().catch(() => {});
          markStreaming();
        };
        v.oncanplay = () => {
          v.play().catch(() => {});
          markStreaming();
        };
        v.onplaying = () => {
          markStreaming();
        };

        try {
          await v.play();
          if (v.readyState >= 2) {
            markStreaming();
          }
        } catch {
          /* autoplay policy */
        }
      }

      if (track) {
        track.onended = () => {
          if (wantedRef.current) {
            setStatus('requesting');
            setTimeout(() => {
              if (wantedRef.current) void open(wantedRef.current.facingMode);
            }, 500);
          }
        };
      }
      return true;
    } catch (e) {
      const d = describeError(e);
      setStatus(d.status);
      setError(d.message);
      streamRef.current = null;
      return false;
    }
  }, []);

  const start = React.useCallback(
    async (opts: { orientation?: boolean; facingMode?: 'environment' | 'user' } = {}): Promise<boolean> => {
      const facingMode = opts.facingMode ?? 'environment';
      wantedRef.current = { facingMode };
      if (opts.orientation !== false) {
        const p = await requestOrientationPermission();
        setOrientationPermission(p);
      }
      const ok = await open(facingMode);
      // Portrait lock is a nicety, never a requirement (only full-screen documents may lock).
      try {
        const so = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
        if (ok && /Android|iPhone|iPad/i.test(navigator.userAgent) && so?.lock) so.lock('portrait').catch(() => {});
      } catch {
        /* ignore */
      }
      return ok;
    },
    [open],
  );

  // Background → foreground: re-acquire a stream the OS may have killed; keep the element playing.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !wantedRef.current) return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') void open(wantedRef.current.facingMode);
      else videoRef.current?.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [open]);

  React.useEffect(
    () => () => {
      wantedRef.current = null;
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
    },
    [],
  );

  return { videoRef, status, error, settings, orientationPermission, start, stop, needsGesture };
}
