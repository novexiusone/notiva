import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Page } from '@/lib/commands';
import { createAppRouter } from '@/router';
import { installFakeBackend } from '@/test/fakeBackend';

type Options = { pages?: Page[]; path?: string };

/** Renders the whole app against the fake backend. */
export function renderApp({ pages = [], path = '/' }: Options = {}) {
  installFakeBackend({ pages });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { router, user: userEvent.setup() };
}

export function page(
  id: string,
  title: string,
  parentId: string | null = null,
  position = 0,
): Page {
  return { id, title, parentId, position };
}
