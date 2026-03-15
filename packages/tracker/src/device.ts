import type { DeviceType } from '@analytics-platform/shared';
import { DEVICE_BREAKPOINTS } from '@analytics-platform/shared';

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
