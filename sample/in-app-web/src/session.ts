const STORAGE_KEY = 'notifhub.in-app-sample.session.v1';

export interface SampleSession {
  token: string;
  tokenType: 'Bearer';
  recipientId: string;
  tenant: string;
  expiresAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSession(value: unknown): SampleSession | null {
  if (!isRecord(value)) {
    return null;
  }

  const { token, tokenType, recipientId, tenant, expiresAt } = value;

  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    tokenType !== 'Bearer' ||
    typeof recipientId !== 'string' ||
    recipientId.length === 0 ||
    typeof tenant !== 'string' ||
    tenant.length === 0 ||
    typeof expiresAt !== 'string' ||
    Number.isNaN(Date.parse(expiresAt))
  ) {
    return null;
  }

  return { token, tokenType, recipientId, tenant, expiresAt };
}

export function loadStoredSession(): SampleSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);

    if (raw === null) {
      return null;
    }

    const session = parseSession(JSON.parse(raw) as unknown);

    if (session === null) {
      sessionStorage.removeItem(STORAGE_KEY);
    }

    return session;
  } catch {
    return null;
  }
}

export function storeSession(session: SampleSession): boolean {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in hardened browser profiles; in-memory state still clears.
  }
}

export function isSessionExpired(session: SampleSession, now = Date.now()): boolean {
  const expiresAt = Date.parse(session.expiresAt);

  return Number.isNaN(expiresAt) || expiresAt <= now;
}
