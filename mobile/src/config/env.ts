/**
 * Application Environment Configuration
 * Follows industry-standard 12-Factor App and enterprise mobile system design.
 */

export const APP_ENV =
  process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'development' : 'production');

export const IS_PRODUCTION = APP_ENV === 'production';
export const IS_DEVELOPMENT = APP_ENV === 'development';

/**
 * Developer tooling flag (Local Server IP / Wi-Fi switcher).
 * Strictly disabled in production builds.
 */
export const SHOW_DEV_SERVER_CONFIG =
  !IS_PRODUCTION && (__DEV__ || process.env.EXPO_PUBLIC_ENABLE_DEV_TOOLS === 'true');
