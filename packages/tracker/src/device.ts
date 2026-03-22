import type { DeviceType } from './constants';

export function getDeviceType(): DeviceType {
  const ua = navigator.userAgent;

  // Signal 1: Client Hints API (Chromium only, most reliable)
  if ('userAgentData' in navigator) {
    const uad = (navigator as any).userAgentData;
    if (uad?.mobile === true) {
      return /Mobile/.test(ua) ? 'mobile' : 'tablet';
    }
  }

  // Signal 2: iPad detection (iPadOS 13+ reports as Mac)
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) {
    return 'tablet';
  }

  // Signal 3: iOS devices (iPhone/iPod)
  if (/iPhone|iPod/.test(ua)) return 'mobile';

  // Signal 4: Android devices
  if (/Android/.test(ua)) {
    return /Mobile/.test(ua) ? 'mobile' : 'tablet';
  }

  // Signal 5: Windows/Mac/Linux/CrOS -> desktop
  return 'desktop';
}

export function getScreenDimensions() {
  return {
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}
