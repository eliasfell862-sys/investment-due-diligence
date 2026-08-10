import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/cloud/cloud-environment', () => ({
  readCloudEnvironment: () => ({ supabaseUrl: 'https://example.test' }),
}));
vi.mock('./SignalInboxBase', () => ({
  SignalInbox: () => <div data-testid="local-inbox" />,
}));
vi.mock('./cloud/CloudSignalInbox', () => ({
  CloudSignalInbox: () => <div data-testid="cloud-inbox" />,
}));

import { SignalInboxModeSwitch } from './SignalInboxModeSwitch';

describe('local-first signal inbox', () => {
  it('keeps the original local inbox when cloud notification is configured', () => {
    render(<SignalInboxModeSwitch />);
    expect(screen.getByTestId('local-inbox')).toBeInTheDocument();
    expect(screen.queryByTestId('cloud-inbox')).not.toBeInTheDocument();
  });
});
