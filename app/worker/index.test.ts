import { describe, expect, it, vi } from 'vitest';
import { runWorker } from './index';

describe('worker process lifecycle', () => {
  it('starts, acquires the lease, scans, writes heartbeats, and stops cleanly', async () => {
    let stop = false;
    const statuses: string[] = [];
    const repository = {
      claimLease: vi.fn(async () => true),
      writeHeartbeat: vi.fn(async (status: string) => { statuses.push(status); }),
    };
    const scan = vi.fn(async () => { stop = true; });

    await runWorker({
      repository,
      scan,
      cadenceMs: 3_000,
      now: () => new Date('2026-08-07T01:30:00.000Z'),
      sleep: async () => undefined,
      shouldStop: () => stop,
    });

    expect(repository.claimLease).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledOnce();
    expect(statuses).toEqual(['starting', 'running', 'stopping']);
  });
});
