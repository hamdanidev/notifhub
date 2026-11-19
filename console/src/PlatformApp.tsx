import { createBrowserRouter, Navigate } from 'react-router-dom';
import { PlatformLoginPage } from './auth/PlatformLoginPage';
import { PlatformProtectedRoute } from './auth/PlatformProtectedRoute';
import { PlatformLayout } from './layout/PlatformLayout';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlatformAuditPage } from './pages/platform/PlatformAuditPage';
import { PlatformTenantDetailPage } from './pages/platform/PlatformTenantDetailPage';
import { PlatformTenantsPage } from './pages/platform/PlatformTenantsPage';

/**
 * Router for the platform console entry (`platform.html`).
 *
 * It only knows platform routes: the tenant console's pages are not imported here, and this
 * bundle is deployed to its own origin. URLs keep the `/platform/*` prefix in v1 so bookmarks
 * and documentation stay stable across both hosts.
 */
export const platformRouter = createBrowserRouter([
  {
    path: '/platform/login',
    element: <PlatformLoginPage />,
  },
  {
    path: '/platform',
    element: (
      <PlatformProtectedRoute>
        <PlatformLayout />
      </PlatformProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/platform/tenants" replace /> },
      { path: 'tenants', element: <PlatformTenantsPage /> },
      { path: 'tenants/:id', element: <PlatformTenantDetailPage /> },
      { path: 'audit', element: <PlatformAuditPage /> },
    ],
  },
  {
    path: '/',
    element: <Navigate to="/platform/tenants" replace />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
