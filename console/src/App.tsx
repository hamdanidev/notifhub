import { createBrowserRouter } from 'react-router-dom';
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
 * Data router (rather than <BrowserRouter>) so the template editor can use useBlocker for its
 * unsaved-changes guard. Route structure and URLs are unchanged.
 */
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
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
