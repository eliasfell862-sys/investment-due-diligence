import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { appRoutes as baseAppRoutes } from './router-base';

function protectSecuritiesRoute(route: RouteObject): RouteObject {
  const securitiesRoute = typeof route.path === 'string' && route.path.includes('securities');
  const protectedElement = securitiesRoute && route.element
    ? <RequireAuth>{route.element}</RequireAuth>
    : route.element;

  if ('children' in route && route.children) {
    return {
      ...route,
      element: protectedElement,
      children: route.children.map(protectSecuritiesRoute),
    };
  }

  return { ...route, element: protectedElement };
}

export const appRoutes: RouteObject[] = [
  ...baseAppRoutes.map(protectSecuritiesRoute),
  { path: '/login', element: <LoginPage /> },
];

export const router = createBrowserRouter(appRoutes);
