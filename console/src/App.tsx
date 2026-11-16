import { Route, Routes } from 'react-router-dom';
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
import { TemplateFormPage } from './pages/TemplateFormPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { TopicDetailPage } from './pages/TopicDetailPage';
import { TopicsPage } from './pages/TopicsPage';

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/notifications/:id" element={<NotificationDetailPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/templates/new" element={<TemplateFormPage />} />
        <Route path="/templates/:id/edit" element={<TemplateFormPage />} />
        <Route path="/subscribers" element={<SubscribersPage />} />
        <Route path="/subscribers/:externalId" element={<SubscriberDetailPage />} />
        <Route path="/topics" element={<TopicsPage />} />
        <Route path="/topics/:key" element={<TopicDetailPage />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
