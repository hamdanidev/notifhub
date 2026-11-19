import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { loadPlatformSession } from '../lib/platformSession';
import { useAuth } from './AuthContext';

/**
 * Protects tenant console routes. A platform admin session belongs to `/platform/*`, so it is
 * redirected there instead of to the tenant login form.
 */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { session } = useAuth();

  if (session === null) {
    if (loadPlatformSession() !== null) {
      return <Navigate to="/platform/tenants" replace />;
    }

    return <Navigate to="/login" replace />;
  }

  if (session.admin.role !== 'tenant_admin') {
    return <Navigate to="/platform/tenants" replace />;
  }

  return <>{children}</>;
}
