import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ cloud: true }));
vi.mock('../../infrastructure/cloud/cloud-environment', () => ({
  readCloudEnvironment: () => state.cloud
    ? { supabaseUrl: 'https://example.test', supabaseAnonKey: 'anon', vapidPublicKey: 'vapid' }
    : null,
}));
vi.mock('./SignalInboxBase', () => ({ SignalInbox: () => <div>本地信号收件箱</div> }));
vi.mock('./cloud/CloudSignalInbox', () => ({ CloudSignalInbox: () => <div>云端信号收件箱</div> }));

import { SignalInboxModeSwitch } from './SignalInboxModeSwitch';

describe('SignalInboxModeSwitch', () => {
  beforeEach(() => { state.cloud = true; });

  it('preserves the local inbox when Supabase is configured', () => {
    render(<SignalInboxModeSwitch />);
    expect(screen.getByText('本地信号收件箱')).toBeInTheDocument();
    expect(screen.queryByText('云端信号收件箱')).not.toBeInTheDocument();
  });

  it('preserves the existing local inbox when cloud is not configured', () => {
    state.cloud = false;
    render(<SignalInboxModeSwitch />);
    expect(screen.getByText('本地信号收件箱')).toBeInTheDocument();
  });
});
