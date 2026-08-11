import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authenticated: true }));
vi.mock('../auth/AuthProvider', () => ({
  useOptionalAuth: () => state.authenticated
    ? { cloudEnabled: true, user: { id: 'user-a' }, loading: false }
    : { cloudEnabled: true, user: null, loading: false },
}));
vi.mock('./SignalInboxBase', () => ({
  SignalInbox: () => <div data-testid="local-inbox" />,
}));
vi.mock('./cloud/CloudSignalInbox', () => ({
  CloudSignalInbox: () => <div data-testid="cloud-inbox" />,
}));

import { SignalInboxModeSwitch } from './SignalInboxModeSwitch';

describe('SignalInboxModeSwitch', () => {
  beforeEach(() => { state.authenticated = true; });

  it('uses the cloud inbox for an authenticated cloud user', () => {
    render(<SignalInboxModeSwitch />);
    expect(screen.getByTestId('cloud-inbox')).toBeInTheDocument();
    expect(screen.queryByTestId('local-inbox')).not.toBeInTheDocument();
  });

  it('uses the local inbox for an anonymous user', () => {
    state.authenticated = false;
    render(<SignalInboxModeSwitch />);
    expect(screen.getByTestId('local-inbox')).toBeInTheDocument();
  });
});
