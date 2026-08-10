import { describe, expect, it, vi } from 'vitest';
import { isAshareTradingSession, runTradingScheduler } from './scheduler';

describe('worker trading scheduler', () => {
  it('recognizes morning and afternoon sessions but pauses for lunch and close', () => {
    expect(isAshareTradingSession(new Date('2026-08-07T01:30:00.000Z'))).toBe(true);
    expect(isAshareTradingSession(new Date('2026-08-07T03:31:00.000Z'))).toBe(false);
    expect(isAshareTradingSession(new Date('2026-08-07T05:00:00.000Z'))).toBe(true);
    expect(isAshareTradingSession(new Date('2026-08-07T07:01:00.000Z'))).toBe(false);
    expect(isAshareTradingSession(new Date('2026-08-08T02:00:00.000Z'))).toBe(false);
  });

  it('waits for a slow scan to finish instead of overlapping another scan', async () => {
    let nowMs = new Date('2026-08-07T01:30:00.000Z').getTime();
    let scans = 0;
    let active = 0;
    let maxActive = 0;
    const runScan = vi.fn(async () => {
      scans += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      nowMs += 5_000;
      active -= 1;
    });

    await runTradingScheduler({
      cadenceMs: 3_000,
      now: () => new Date(nowMs),
      sleep: async milliseconds => { nowMs += milliseconds; },
      claimLease: async () => true,
      runScan,
      writeHeartbeat: async () => undefined,
      shouldStop: () => scans >= 2,
    });

    expect(runScan).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });
});
