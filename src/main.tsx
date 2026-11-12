import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/lib/i18n';
import { lastPage } from '@/lib/localState';
import { createAppRouter } from '@/router';
import '@/styles/globals.css';

// Development and tests can run the frontend in a browser without Tauri.
if (import.meta.env.VITE_FAKE_BACKEND) {
  const { installFakeBackend } = await import('@/test/fakeBackend');
  installFakeBackend({ persist: true });
}

// The app always starts at its entry page, so reopen what was open last.
const remembered = lastPage();
if (remembered !== null && (window.location.hash === '' || window.location.hash === '#/')) {
  window.location.hash = `#/page/${remembered}`;
}

const queryClient = new QueryClient();
const router = createAppRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
