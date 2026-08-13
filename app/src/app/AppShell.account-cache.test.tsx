import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AppShellBase', () => ({ AppShell: () => <main>shell</main> }));
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    cloudEnabled: true,
    loading: false,
    user: { id: 'user-a', email: 'a@example.com' },
    signOut: vi.fn(),
  }),
}));

import { readCachedWatchlists, writeCachedWatchlists } from '../features/securities/securities-account-cache';
import { AppShell } from './AppShell';

describe('AppShell account cache control', () => {
  beforeEach(() => {
    localStorage.clear();
    writeCachedWatchlists('user-a', [{
      id: 'main', name: 'cached', createdAt: '2026-08-12', codes: ['000001'], groups: [], codeGroups: {},
    }]);
  });

  it('lets the signed-in account clear only its local securities cache', async () => {
    render(<AppShell />);

    await userEvent.click(screen.getByRole('button', { name: '清理本地证券缓存' }));

    expect(readCachedWatchlists('user-a')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('本地证券缓存已清理');
  });
});
