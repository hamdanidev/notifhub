import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { ExternalRedirect } from './components/ExternalRedirect';
import { PLATFORM_CONSOLE_URL } from './env';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppLayout } from './layout/AppLayout';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { DashboardPage } from './pages/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotificationDetailPage } from './pages/NotificationDetailPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SubscriberDetailPage } from './pages/SubscriberDetailPage';
import { SubscribersPage } from './pages/SubscribersPage';
import { TemplateAssetsPage } from './pages/TemplateAssetsPage';
import { TemplateFormPage } from './pages/TemplateFormPage';
import { TemplateHistoryPage } from './pages/TemplateHistoryPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { TopicDetailPage } from './pages/TopicDetailPage';
import { TopicsPage } from './pages/TopicsPage';

/**
 * Sends `/platform/*` requests on the tenant host to the platform console origin.
 *
 * When `VITE_PLATFORM_CONSOLE_URL` is not configured (single-host deployments and local
 * development) the route falls back to NotFound, so the tenant build never embeds platform pages.
 */
function PlatformConsoleRedirect(): JSX.Element {
  const location = useLocation();

  if (PLATFORM_CONSOLE_URL.length === 0) {
    return <NotFoundPage />;
  }

  return (
    <ExternalRedirect to={`${PLATFORM_CONSOLE_URL}${location.pathname}${location.search}`} />
  );
}

/**
 * Tenant console router. Data router (rather than <BrowserRouter>) so the template editor can
 * use useBlocker for its unsaved-changes guard.
 */
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/platform/*',
    element: <PlatformConsoleRedirect />,
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
