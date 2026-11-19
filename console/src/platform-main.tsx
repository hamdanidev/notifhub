import { QueryClientProvider } from '@tanstack/react-query';
import 'bootstrap/dist/css/bootstrap.min.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { platformRouter } from './PlatformApp';
import { platformQueryClient } from './lib/platformQueryClient';
import './styles.css';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('root element not found');
}

createRoot(container).render(
  <React.StrictMode>
    <QueryClientProvider client={platformQueryClient}>
      <RouterProvider router={platformRouter} />
    </QueryClientProvider>
  </React.StrictMode>,
);
