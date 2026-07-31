import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { appRoutes } from './router';

describe('application routes', () => {
  it('renders the securities workbench at /securities', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/securities'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '证券项目工作台' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /证券项目/ })).toHaveAttribute('aria-current', 'page');
  });
});