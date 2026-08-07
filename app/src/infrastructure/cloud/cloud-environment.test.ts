import { describe, expect, it } from 'vitest';
import {
  assertProductionAuthEnvironment,
  readAuthEnvironment,
  readCloudEnvironment,
  readPushEnvironment,
} from './cloud-environment';

describe('readAuthEnvironment', () => {
  it('returns null when authentication is not configured', () => {
    expect(readAuthEnvironment({})).toBeNull();
  });

  it('does not require VAPID for authentication', () => {
    expect(readAuthEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    });
  });

  it('rejects partial authentication configuration', () => {
    expect(() => readAuthEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
    })).toThrow('Authentication environment is incomplete');
  });
});

describe('readPushEnvironment', () => {
  it('allows push to remain disabled while auth is enabled', () => {
    expect(readPushEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toBeNull();
  });

  it('returns the public VAPID key when configured', () => {
    expect(readPushEnvironment({ VITE_VAPID_PUBLIC_KEY: 'public-key' }))
      .toEqual({ vapidPublicKey: 'public-key' });
  });
});

describe('readCloudEnvironment', () => {
  it('keeps existing push monitoring disabled until all public values exist', () => {
    expect(readCloudEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toBeNull();
  });

  it('returns the combined monitoring environment', () => {
    expect(readCloudEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
      VITE_VAPID_PUBLIC_KEY: 'public-key',
    })).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      vapidPublicKey: 'public-key',
    });
  });
});

describe('assertProductionAuthEnvironment', () => {
  it.each([
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
  ])('rejects loopback Supabase URL %s', supabaseUrl => {
    expect(() => assertProductionAuthEnvironment({
      VITE_SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toThrow('Production Supabase URL must not use a loopback host');
  });

  it('rejects a browser service role variable', () => {
    expect(() => assertProductionAuthEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
      VITE_SUPABASE_SERVICE_ROLE_KEY: 'secret',
    })).toThrow('Service role credentials must not be exposed to the browser');
  });

  it('accepts a hosted Supabase URL and anon key', () => {
    expect(assertProductionAuthEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    }).supabaseUrl).toBe('https://example.supabase.co');
  });
});
