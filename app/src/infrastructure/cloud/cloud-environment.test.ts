import { describe, expect, it } from 'vitest';
import { readCloudEnvironment } from './cloud-environment';

describe('readCloudEnvironment', () => {
  it('returns null when cloud monitoring is not configured', () => {
    expect(readCloudEnvironment({})).toBeNull();
  });

  it('returns the three public browser values', () => {
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

  it('rejects partially configured cloud monitoring', () => {
    expect(() => readCloudEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toThrow('Cloud monitoring environment is incomplete');
  });
});
