import type { AdminProfile } from '@notifhub/js';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession } from './session';

const admin: AdminProfile = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'tenant_admin',
  tenantId: 'default',
};

const STORAGE_KEY = 'notifhub.console.session';

beforeEach(() => {
  sessionStorage.clear();
});

describe('session storage', () => {
  it('saves and reloads a valid session', () => {
    saveSession('token-1', 3600, admin);

    expect(loadSession()).toMatchObject({
      token: 'token-1',
      admin: { email: 'admin@example.com', tenantId: 'default' },
    });
  });

  it('drops an expired session', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: 'expired', admin, expiresAt: Date.now() - 1 }),
    );

    expect(loadSession()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('drops malformed JSON', () => {
    sessionStorage.setItem(STORAGE_KEY, '{');

    expect(loadSession()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clears the session explicitly', () => {
    saveSession('token-1', 3600, admin);
    clearSession();

    expect(loadSession()).toBeNull();
  });
});
