import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Protects tenant console routes. The platform console is a separate entry/deployment.
 *
 * Approvers only need the review queue, read-only template views, the compare page, and their
 * account. Any other route (dashboard, notifications, subscribers, API keys, assets, new template)
 * redirects to the review queue instead of rendering a page whose API calls would return 403.
 */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { session } = useAuth();
  const location = useLocation();

  if (session === null) {
    return <Navigate to="/login" replace />;
  }

  const role = session.admin.role;

  if (role !== 'tenant_admin' && role !== 'tenant_approver') {
    return <Navigate to="/login" replace />;
  }

  if (role === 'tenant_approver' && !approverCanAccess(location.pathname)) {
    return <Navigate to="/reviews" replace />;
  }

  return <>{children}</>;
}

export function approverCanAccess(pathname: string): boolean {
  if (pathname === '/' || pathname === '') {
    return false;
  }

  if (pathname === '/reviews' || pathname.startsWith('/reviews/')) {
    return true;
  }

  if (pathname === '/templates') {
    return true;
  }

  if (/^\/templates\/[^/]+\/(edit|history|compare)$/.test(pathname)) {
    return true;
  }

  return pathname === '/account';
}
