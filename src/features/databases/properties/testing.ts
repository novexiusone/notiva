import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { Property, PropertyType } from '@/lib/commands';

/** A property of the database "db" for tests. */
export function testProperty(type: PropertyType, more: Partial<Property> = {}): Property {
  return {
    id: 'p',
    databaseId: 'db',
    name: 'Field',
    type,
    position: 0,
    options: [],
    targetId: null,
    ...more,
  };
}

/** A `render` wrapper that provides a fresh query client. */
export function withQueryClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}
