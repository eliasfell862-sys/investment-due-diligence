import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { SecuritiesRouteBoundary } from '../features/securities/cloud/SecuritiesRouteBoundary';
import { appRoutes as baseAppRoutes } from './router-base';

function isSecuritiesPath(path: string | undefined): boolean {
  return Boolean(path?.split('/').includes('securities'));
}

function isProtectedAccountPath(path: string | undefined): boolean {
  if (!path) return false;
  if (path === 'ai-agents' || path === '/ai-agents') return true;
  return isSecuritiesPath(path);
}

export function protectSecuritiesRoutes(routes: RouteObject[]): RouteObject[] {
  return routes.map(route => {
    const routeElement = route.element && isSecuritiesPath(route.path)
      ? <SecuritiesRouteBoundary>{route.element}</SecuritiesRouteBoundary>
      : route.element;
    const element = routeElement && isProtectedAccountPath(route.path)
      ? <RequireAuth>{routeElement}</RequireAuth>
      : routeElement;

    if ('children' in route && route.children) {
      return {
        ...route,
        element,
        children: protectSecuritiesRoutes(route.children),
      };
    }

    return { ...route, element };
  });
}

export const appRoutes: RouteObject[] = [
  ...protectSecuritiesRoutes(baseAppRoutes),
  { path: '/login', element: <LoginPage /> },
];

export const router = createBrowserRouter(appRoutes);
