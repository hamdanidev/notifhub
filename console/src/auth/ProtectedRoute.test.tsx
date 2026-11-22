import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute, approverCanAccess } from './ProtectedRoute';

const state = vi.hoisted(() => ({ role: 'tenant_approver' as string }));

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    session: { admin: { role: state.role } },
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <div>dashboard</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <div>notifications</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reviews"
          element={
            <ProtectedRoute>
              <div>review queue</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('redirects an approver from the dashboard and admin-only pages to the review queue', () => {
    state.role = 'tenant_approver';
    renderAt('/');

    expect(screen.getByText('review queue')).toBeVisible();
    expect(screen.queryByText('dashboard')).toBeNull();
  });

  it('redirects an approver away from notifications', () => {
    state.role = 'tenant_approver';
    renderAt('/notifications');

    expect(screen.getByText('review queue')).toBeVisible();
  });

  it('lets a tenant admin open the dashboard', () => {
    state.role = 'tenant_admin';
    renderAt('/');

    expect(screen.getByText('dashboard')).toBeVisible();
  });
});

describe('approverCanAccess', () => {
  it('allows only review, template read views, and account', () => {
    expect(approverCanAccess('/reviews')).toBe(true);
    expect(approverCanAccess('/templates')).toBe(true);
    expect(approverCanAccess('/templates/abc/edit')).toBe(true);
    expect(approverCanAccess('/templates/abc/history')).toBe(true);
    expect(approverCanAccess('/templates/abc/compare')).toBe(true);
    expect(approverCanAccess('/account')).toBe(true);

    expect(approverCanAccess('/')).toBe(false);
    expect(approverCanAccess('/notifications')).toBe(false);
    expect(approverCanAccess('/templates/new')).toBe(false);
    expect(approverCanAccess('/templates/assets')).toBe(false);
    expect(approverCanAccess('/api-keys')).toBe(false);
    expect(approverCanAccess('/audit')).toBe(false);
  });
});
