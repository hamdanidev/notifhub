import type { AdminProfile } from '@notifhub/js';

const STORAGE_KEY = 'notifhub.console.session';

export interface AdminSession {
  token: string;
  admin: AdminProfile;
  expiresAt: number;
}

export function loadSession(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);

    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      clearSession();
      return null;
    }

    const { token, admin, expiresAt } = parsed;

    if (
      typeof token !== 'string' ||
      typeof expiresAt !== 'number' ||
      expiresAt <= Date.now() ||
      !isAdminProfile(admin)
    ) {
      clearSession();
      return null;
    }

    return { token, admin, expiresAt };
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(
  token: string,
  expiresInSeconds: number,
  admin: AdminProfile,
): AdminSession {
  const session: AdminSession = {
    token,
    admin,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));

  return session;
}

export function clearSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function getToken(): string | undefined {
  return loadSession()?.token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAdminProfile(value: unknown): value is AdminProfile {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.email === 'string' &&
    typeof value.role === 'string' &&
    typeof value.tenantId === 'string'
  );
}
