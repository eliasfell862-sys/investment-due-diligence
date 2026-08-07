import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { appRoutes as baseAppRoutes } from './router-base';

function isSecuritiesPath(path: string | undefined): boolean {
  return path?.split('/').includes('securities') ?? false;
}

export function protectSecuritiesRoutes(routes: RouteObject[]): RouteObject[] {
  return routes.map(route => {
    const element = route.element && isSecuritiesPath(route.path)
      ? <RequireAuth>{route.element}</RequireAuth>
      : route.element;

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
