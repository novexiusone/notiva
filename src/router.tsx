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

const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/page/$pageId',
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
