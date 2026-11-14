import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CellValue, Page, Property, View } from '@/lib/commands';
import { createAppRouter } from '@/router';
import { installFakeBackend } from '@/test/fakeBackend';

type Options = {
  pages?: Page[];
  properties?: Property[];
  views?: View[];
  /** Cell values by row id, then by property id. */
  cells?: Record<string, Record<string, CellValue>>;
  path?: string;
};

/** Renders the whole app against the fake backend. */
export function renderApp({ path = '/', ...data }: Options = {}) {
  installFakeBackend(data);

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
  return { id, title, parentId, position, kind: 'page', databaseId: null };
}

export function database(
  id: string,
  title: string,
  parentId: string | null = null,
  position = 0,
): Page {
  return { id, title, parentId, position, kind: 'database', databaseId: null };
}

/** A row of the database `databaseId`. */
export function row(id: string, title: string, databaseId: string, position = 0): Page {
  return { id, title, parentId: databaseId, position, kind: 'page', databaseId };
}
