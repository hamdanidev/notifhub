export const API_BASE_URL: string =
  import.meta.env.VITE_NOTIFHUB_API_URL ?? 'http://localhost:3000';

/**
 * Public origin of the platform console, used by the tenant console to redirect `/platform/*`
 * when the two consoles are deployed on separate hosts. Empty disables the redirect.
 */
export const PLATFORM_CONSOLE_URL: string = (
  import.meta.env.VITE_PLATFORM_CONSOLE_URL ?? ''
).replace(/\/+$/, '');
