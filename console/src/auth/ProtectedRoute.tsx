import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

/** Protects tenant console routes. The platform console is a separate entry/deployment. */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { session } = useAuth();

  if (
    session === null ||
    (session.admin.role !== 'tenant_admin' && session.admin.role !== 'tenant_approver')
  ) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
