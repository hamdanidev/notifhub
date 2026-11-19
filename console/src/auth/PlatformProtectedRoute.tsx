import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { loadPlatformSession } from '../lib/platformSession';

/** Protects `/platform/*`: requires a live platform admin session. */
export function PlatformProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const session = loadPlatformSession();

  if (session === null || session.admin.role !== 'platform_admin') {
    return <Navigate to="/platform/login" replace />;
  }

  return <>{children}</>;
}
