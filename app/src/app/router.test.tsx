import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { appRoutes } from './router';

describe('application routes', () => {
  it('registers root and project pre-move radar routes', () => {
    const children = appRoutes[0]?.children ?? [];
    expect(children.some(route => route.path === 'securities/pre-move-radar')).toBe(true);
    expect(children.some(route => route.path === 'projects/:projectId/securities/pre-move-radar')).toBe(true);
  });

  it('renders the securities workbench at /securities', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/securities'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '证券项目工作台' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /证券项目/ })).toHaveAttribute('aria-current', 'page');
  });
});