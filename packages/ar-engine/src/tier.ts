import type { DeviceClass } from './types';

export type ArTier = 'L' | 'C' | 'Q' | 'P';

/**
 * Route by capability, never show a dead button:
 *   L — Live AR: WebXR immersive-ar with hit-test (Android Chrome and friends).
 *   C — Live camera: getUserMedia on the video element in a secure context, our own pose +
 *       plane maths (iPhone Safari, Android without WebXR, laptop webcams). The default tier
 *       on every camera device that lacks WebXR.
 *   Q — Quick Look: iOS Safari, USDZ via rel="ar" (a secondary chip when C is the default).
 *   P — Photo Mode: every device, including desktop; also the fallback when L/C/Q are unsupported.
 * `?tier=L|C|Q|P` in the page's query string forces a tier for device testing.
 */
export interface TierDetection {
  tier: ArTier;
  webxr: boolean;
  quickLook: boolean;
  /** `navigator.mediaDevices.getUserMedia` exists (it still needs `secureContext` to actually open). */
  camera: boolean;
  reason: string;
  /** The DeviceOrientationEvent API exists on a device class that fires it (phones/tablets; laptops expose the constructor but never fire). */
  orientationSensors: boolean;
  secureContext: boolean;
  deviceClass: DeviceClass;
  /** Set when `?tier=` forced the result; the capability booleans stay truthful. */
  override: ArTier | null;
}

export interface TierDetectOptions {
  /** The query string to read `?tier=` from; defaults to `location.search` when available. */
  search?: string;
  /** Override the secure-context check (tests, or a host that knows better). */
  secureContext?: boolean;
  /** Override the orientation-sensor check. */
  orientationSensors?: boolean;
}

type NavLike = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> & { userAgentData?: { mobile?: boolean } };

/** Phone = mobile UA (incl. iPadOS's desktop UA with touch); laptop = a desktop OS UA; otherwise unknown. */
export function deviceClassFor(nav: NavLike | undefined): DeviceClass {
  if (!nav) return 'unknown';
  const ua = nav.userAgent || '';
  if (/iPad|iPhone|iPod|Android|Mobile|Windows Phone/i.test(ua)) return 'phone';
  if (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1) return 'phone';
  if (nav.userAgentData?.mobile === true) return 'phone';
  if (/Windows NT|Macintosh|X11|Linux|CrOS/i.test(ua) || nav.userAgentData?.mobile === false) return 'laptop';
  return 'unknown';
}

/** Parse a `?tier=` override out of a query string; anything but L/C/Q/P is ignored. */
export function tierOverrideFrom(search: string | undefined | null): ArTier | null {
  if (!search) return null;
  try {
    const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('tier');
    const t = raw?.trim().toUpperCase();
    return t === 'L' || t === 'C' || t === 'Q' || t === 'P' ? t : null;
  } catch {
    return null;
  }
}

/** Pass `null` to force the server result (Node ≥ 21 has a global `navigator`, so `undefined` alone picks it up). */
export async function detectTier(
  nav: Navigator | null | undefined = typeof navigator !== 'undefined' ? navigator : undefined,
  opts: TierDetectOptions = {},
): Promise<TierDetection> {
  if (!nav)
    return {
      tier: 'P',
      webxr: false,
      quickLook: false,
      camera: false,
      reason: 'server',
      orientationSensors: false,
      secureContext: false,
      deviceClass: 'unknown',
      override: null,
    };
  const ua = nav.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  const quickLook =
    isIOS &&
    (() => {
      try {
        const a = document.createElement('a');
        return a.relList?.supports?.('ar') ?? true;
      } catch {
        return true;
      }
    })();
  let webxr = false;
  try {
    const xr = (nav as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr;
    if (xr) webxr = await xr.isSessionSupported('immersive-ar');
  } catch {
    webxr = false;
  }
  const camera = !!nav.mediaDevices?.getUserMedia;
  const deviceClass = deviceClassFor(nav as NavLike);
  const secureContext = opts.secureContext ?? (typeof isSecureContext === 'boolean' ? isSecureContext : false);
  const orientationSensors = opts.orientationSensors ?? (typeof DeviceOrientationEvent !== 'undefined' && deviceClass === 'phone');
  const base = { webxr, quickLook, camera, orientationSensors, secureContext, deviceClass };
  const override = tierOverrideFrom(opts.search ?? (typeof location !== 'undefined' ? location.search : ''));
  if (override) return { tier: override, ...base, reason: `Forced by ?tier=${override}`, override };
  if (webxr) return { tier: 'L', ...base, reason: 'WebXR immersive-ar supported', override: null };
  if (camera && secureContext) return { tier: 'C', ...base, reason: 'Live camera (getUserMedia in a secure context)', override: null };
  if (quickLook) return { tier: 'Q', ...base, reason: 'iOS Quick Look', override: null };
  return { tier: 'P', ...base, reason: camera ? 'Photo mode with camera' : 'Photo mode with upload', override: null };
}
