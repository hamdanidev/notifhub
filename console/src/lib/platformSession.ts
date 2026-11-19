/**
 * Platform-admin session, stored separately from the tenant admin session.
 *
 * A platform admin is not bound to a tenant, so the profile intentionally has no `tenantId`
 * (the published `@notifhub/js` AdminProfile type stays untouched). Both sessions can coexist in
 * the same browser tab; each layout only reads its own.
 */
const STORAGE_KEY = 'notifhub.console.platform-session';

export interface PlatformAdminProfile {
  id: string;
  email: string;
  role: string;
}

export interface PlatformSession {
  token: string;
  admin: PlatformAdminProfile;
  expiresAt: number;
}

export function loadPlatformSession(): PlatformSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);

    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      clearPlatformSession();
      return null;
    }

    const { token, admin, expiresAt } = parsed;

    if (
      typeof token !== 'string' ||
      typeof expiresAt !== 'number' ||
      expiresAt <= Date.now() ||
      !isPlatformAdminProfile(admin)
    ) {
      clearPlatformSession();
      return null;
    }

    return { token, admin, expiresAt };
  } catch {
    clearPlatformSession();
    return null;
  }
}

export function savePlatformSession(
  token: string,
  expiresInSeconds: number,
  admin: PlatformAdminProfile,
): PlatformSession {
  const session: PlatformSession = {
    token,
    admin,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));

  return session;
}

export function clearPlatformSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function getPlatformToken(): string | undefined {
  return loadPlatformSession()?.token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlatformAdminProfile(value: unknown): value is PlatformAdminProfile {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.email === 'string' &&
    typeof value.role === 'string'
  );
}
