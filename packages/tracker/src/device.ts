import type { DeviceType } from './constants';
import { DEVICE_BREAKPOINTS } from './constants';

export function getDeviceType(width: number): DeviceType {
  if (width < DEVICE_BREAKPOINTS.mobile) return 'mobile';
  if (width < DEVICE_BREAKPOINTS.tablet) return 'tablet';
  return 'desktop';
}

export function getScreenDimensions() {
  return {
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}
