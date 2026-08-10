import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

beforeEach(() => { localStorage.clear(); });

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
      '03AI Agent 配置',
    ]);
    expect(screen.getByRole('link', { name: /投研项目/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /证券项目/ })).toHaveAttribute('href', '/securities');
    expect(screen.getByRole('link', { name: /证券项目/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /AI Agent 配置/ })).toHaveAttribute('href', '/ai-agents');
  });

  it('collapses the sidebar to give content full width, then expands it back', async () => {
    render(
      <MemoryRouter initialEntries={['/securities']}>
        <AppShell />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /投研项目/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /折叠侧栏/ }));
    expect(screen.queryByRole('link', { name: /投研项目/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /展开侧栏/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /展开侧栏/ }));
    expect(screen.getByRole('link', { name: /投研项目/ })).toBeInTheDocument();
  });
});