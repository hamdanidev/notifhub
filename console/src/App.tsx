import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { PlatformLoginPage } from './auth/PlatformLoginPage';
import { PlatformProtectedRoute } from './auth/PlatformProtectedRoute';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppLayout } from './layout/AppLayout';
import { PlatformLayout } from './layout/PlatformLayout';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { DashboardPage } from './pages/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotificationDetailPage } from './pages/NotificationDetailPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PlatformAuditPage } from './pages/platform/PlatformAuditPage';
import { PlatformTenantDetailPage } from './pages/platform/PlatformTenantDetailPage';
import { PlatformTenantsPage } from './pages/platform/PlatformTenantsPage';
import { SubscriberDetailPage } from './pages/SubscriberDetailPage';
import { SubscribersPage } from './pages/SubscribersPage';
import { TemplateAssetsPage } from './pages/TemplateAssetsPage';
import { TemplateFormPage } from './pages/TemplateFormPage';
import { TemplateHistoryPage } from './pages/TemplateHistoryPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { TopicDetailPage } from './pages/TopicDetailPage';
import { TopicsPage } from './pages/TopicsPage';

/**
 * Data router (rather than <BrowserRouter>) so the template editor can use useBlocker for its
 * unsaved-changes guard. Route structure and URLs are unchanged.
 */
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
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
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/notifications/:id', element: <NotificationDetailPage /> },
      { path: '/templates', element: <TemplatesPage /> },
      { path: '/templates/new', element: <TemplateFormPage /> },
      { path: '/templates/assets', element: <TemplateAssetsPage /> },
      { path: '/templates/:id/edit', element: <TemplateFormPage /> },
      { path: '/templates/:id/history', element: <TemplateHistoryPage /> },
      { path: '/subscribers', element: <SubscribersPage /> },
      { path: '/subscribers/:externalId', element: <SubscriberDetailPage /> },
      { path: '/topics', element: <TopicsPage /> },
      { path: '/topics/:key', element: <TopicDetailPage /> },
      { path: '/api-keys', element: <ApiKeysPage /> },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
