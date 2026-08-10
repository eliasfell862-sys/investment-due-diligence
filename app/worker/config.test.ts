import { describe, expect, it } from 'vitest';
import { readWorkerConfig } from './config';

const complete = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  VAPID_PUBLIC_KEY: 'public',
  VAPID_PRIVATE_KEY: 'private',
  VAPID_SUBJECT: 'mailto:test@example.com',
  WORKER_INSTANCE_ID: 'worker-a',
};

describe('readWorkerConfig', () => {
  it('requires every server-side secret', () => {
    for (const key of Object.keys(complete)) {
      const env = { ...complete, [key]: '' };
      expect(() => readWorkerConfig(env)).toThrow(key);
    }
  });

  it('never accepts the browser anon key as the service-role key', () => {
    expect(() => readWorkerConfig({
      ...complete,
      SUPABASE_SERVICE_ROLE_KEY: '',
      VITE_SUPABASE_ANON_KEY: 'anon',
    })).toThrow('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('returns normalized worker settings', () => {
    expect(readWorkerConfig(complete)).toMatchObject({
      supabaseUrl: complete.SUPABASE_URL,
      workerInstanceId: 'worker-a',
      scanCadenceMs: 3_000,
    });
  });
});
