import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('shows independent research and securities workbench links in order', () => {
    render(
      <MemoryRouter initialEntries={['/securities']}>
        <AppShell />
      </MemoryRouter>,
    );

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '01投研项目',
      '02证券项目',
    ]);
    expect(screen.getByRole('link', { name: /投研项目/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /证券项目/ })).toHaveAttribute('href', '/securities');
    expect(screen.getByRole('link', { name: /证券项目/ })).toHaveAttribute('aria-current', 'page');
  });
});