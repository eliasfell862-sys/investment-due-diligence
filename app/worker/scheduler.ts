import {
  isAStockTradingDay,
  shanghaiDateKey,
  UnsupportedTradingCalendarYearError,
} from '../src/features/securities/a-share-trading-calendar';

export type WorkerHeartbeatStatus = 'starting' | 'running' | 'degraded' | 'stopping';

export interface TradingSchedulerDependencies {
  cadenceMs: number;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  claimLease: () => Promise<boolean>;
  runScan: () => Promise<void>;
  writeHeartbeat: (status: WorkerHeartbeatStatus, details?: Record<string, unknown>) => Promise<void>;
  shouldStop: () => boolean;
}

const shanghaiTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function minutesAndSeconds(value: Date): number {
  const parts = Object.fromEntries(
    shanghaiTime.formatToParts(value)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  );
  return (parts.hour ?? 0) * 3_600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0);
}

export function isAshareTradingSession(value: Date): boolean {
  try {
    if (!isAStockTradingDay(shanghaiDateKey(value))) return false;
  } catch (error) {
    if (error instanceof UnsupportedTradingCalendarYearError) return false;
    throw error;
  }
  const seconds = minutesAndSeconds(value);
  const morning = seconds >= 9 * 3_600 + 30 * 60 && seconds <= 11 * 3_600 + 30 * 60;
  const afternoon = seconds >= 13 * 3_600 && seconds <= 15 * 3_600;
  return morning || afternoon;
}

export async function runTradingScheduler(deps: TradingSchedulerDependencies): Promise<void> {
  await deps.writeHeartbeat('starting');
  while (!deps.shouldStop()) {
    const iterationStartedAt = deps.now().getTime();
    if (!isAshareTradingSession(deps.now())) {
      await deps.writeHeartbeat('running', { market: 'closed' });
      await deps.sleep(30_000);
      continue;
    }

    const ownsLease = await deps.claimLease();
    if (!ownsLease) {
      await deps.writeHeartbeat('degraded', { lease: 'not_acquired' });
      await deps.sleep(deps.cadenceMs);
      continue;
    }

    try {
      await deps.runScan();
      await deps.writeHeartbeat('running', { market: 'trading' });
    } catch (error) {
      await deps.writeHeartbeat('degraded', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const elapsed = Math.max(0, deps.now().getTime() - iterationStartedAt);
    await deps.sleep(Math.max(0, deps.cadenceMs - elapsed));
  }
  await deps.writeHeartbeat('stopping');
}
