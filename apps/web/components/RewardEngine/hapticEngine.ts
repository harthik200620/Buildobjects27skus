export function triggerHaptic(type: 'activation' | 'tick' | 'lock' | 'jackpot' | 'reward' | 'zero') {
  if (typeof window === 'undefined' || !('vibrate' in navigator)) return;

  try {
    switch (type) {
      case 'activation':
        navigator.vibrate([18, 40, 25]);
        break;
      case 'tick':
        navigator.vibrate(6);
        break;
      case 'lock':
        navigator.vibrate([28, 15, 45]);
        break;
      case 'jackpot':
        navigator.vibrate([40, 30, 60, 30, 90]);
        break;
      case 'reward':
        navigator.vibrate([30, 20, 40]);
        break;
      case 'zero':
        navigator.vibrate(15);
        break;
    }
  } catch {}
}
