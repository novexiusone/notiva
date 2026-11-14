import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { App } from '@/App';
import { HomeView } from '@/features/home/HomeView';
import { PageView } from '@/features/pages/PageView';

const rootRoute = createRootRoute({ component: App });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeView,
});

/** What the address of a page can carry: the active view of a database. */
export type PageSearch = { view?: string };

/** Keeps a view id that is a non-empty string and drops anything else. */
export function validatePageSearch(search: Record<string, unknown>): PageSearch {
  return typeof search.view === 'string' && search.view !== '' ? { view: search.view } : {};
}

const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/page/$pageId',
  validateSearch: validatePageSearch,
  component: function PageRoute() {
    const { pageId } = pageRoute.useParams();
    return <PageView pageId={pageId} />;
  },
});

const routeTree = rootRoute.addChildren([homeRoute, pageRoute]);

/** Hash history works the same under Tauri's custom protocol and in a browser. */
export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({ routeTree, history });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
