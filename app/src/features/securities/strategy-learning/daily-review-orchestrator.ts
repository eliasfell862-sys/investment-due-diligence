import { isAStockTradingDay } from '../a-share-trading-calendar';
import { loadSignalRuntime } from '../backtest-signal-inbox-store';
import { loadMonitoringUniverse, type MonitoringUniverse } from '../stock-monitoring-universe';
import { loadStockLedger, type StockPositionLedger } from '../stock-position-ledger';
import type { VirtualTradingLedger } from '../virtual-trading-ledger';
import { fetchEastmoneyKLine, type StockKLine } from '../../../infrastructure/market-data/stock-api';
import { buildDailyReviewSnapshot } from './daily-snapshot-builder';
import { runDailyStrategyReview } from './daily-review-engine';
import { StrategyApprovalService } from './strategy-approval-service';
import { strategyLearningDb } from './strategy-learning-db';
import { StrategyLearningRepository } from './strategy-learning-repository';
import type { TechnicalStrategyConfig } from './technical-strategy-config';
import type { DailyStrategyReview, TradeDecisionReview } from './types';

export interface DailyReviewOrchestratorDependencies {
  repository: StrategyLearningRepository;
  now: () => Date;
  getStrategyConfig: () => Promise<TechnicalStrategyConfig>;
  loadUniverse: () => MonitoringUniverse;
  loadActualLedger: () => StockPositionLedger;
  loadVirtualLedger: () => VirtualTradingLedger;
  loadBars: (code: string, limit: number) => Promise<StockKLine[]>;
}

export interface DailyReviewCloudStateSource {
  loadWatchlists(): Promise<Array<{ codes: string[] }>>;
  loadPositionLedger(): Promise<StockPositionLedger>;
  loadSignalRuntime(): Promise<{ virtualLedger: VirtualTradingLedger }>;
}
export interface DailyReviewSecuritiesSnapshot {
  watchlists: Array<{ codes: string[] }>;
  positionLedger: StockPositionLedger;
}

export type DailyReviewRuntimeSource = Pick<DailyReviewCloudStateSource, 'loadSignalRuntime'>;
export interface DailyReviewCatchUpResult {
  status: 'created' | 'existing';
  review: DailyStrategyReview;
  decisions: TradeDecisionReview[];
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function shanghaiClock(value: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

export function latestClosedAStockTradingDate(now: Date): string {
  const clock = shanghaiClock(now);
  const afterClose = clock.hour > 15 || (clock.hour === 15 && clock.minute >= 10);
  let candidate = afterClose ? clock.date : addCalendarDays(clock.date, -1);
  while (!isAStockTradingDay(candidate)) candidate = addCalendarDays(candidate, -1);
  return candidate;
}

const defaultRepository = new StrategyLearningRepository(strategyLearningDb);
const defaultApprovalService = new StrategyApprovalService(defaultRepository);

function defaultDependencies(): DailyReviewOrchestratorDependencies {
  return {
    repository: defaultRepository,
    now: () => new Date(),
    getStrategyConfig: async () => {
      const active = await defaultApprovalService.getActiveStrategy('realtime-technical');
      return active.config as TechnicalStrategyConfig;
    },
    loadUniverse: () => loadMonitoringUniverse(),
    loadActualLedger: () => loadStockLedger(),
    loadVirtualLedger: () => loadSignalRuntime().virtualLedger,
    loadBars: fetchEastmoneyKLine,
  };
}

export async function runDailyReviewCatchUp(
  overrides: DailyReviewOrchestratorDependencies = defaultDependencies(),
): Promise<DailyReviewCatchUpResult> {
  const tradingDate = latestClosedAStockTradingDate(overrides.now());
  const config = await overrides.getStrategyConfig();
  const existing = await overrides.repository.db.dailyReviews
    .where('[tradingDate+strategyId+strategyVersion]')
    .equals([tradingDate, config.strategyId, config.version])
    .first();
  if (existing) {
    return {
      status: 'existing', review: structuredClone(existing),
      decisions: await overrides.repository.listDecisionReviews(existing.id),
    };
  }

  const universe = overrides.loadUniverse();
  const actualLedger = overrides.loadActualLedger();
  const virtualLedger = overrides.loadVirtualLedger();
  const snapshot = await buildDailyReviewSnapshot({
    tradingDate,
    strategyConfig: config,
    watchlistCodes: universe.buyCodes,
    actualPositions: actualLedger.positions,
    virtualLedger,
    actualLedger,
    marketRegime: 'not_evaluated',
    dataSources: ['eastmoney-kline', 'watchlists', 'actual-position-ledger', 'virtual-trading-ledger'],
    loadBars: overrides.loadBars,
    capturedAt: overrides.now().toISOString(),
  });
  const result = await runDailyStrategyReview({
    repository: overrides.repository,
    snapshot,
    ledger: virtualLedger,
  });
  return { status: 'created', ...result };
}
export async function runDailyReviewCatchUpFromSnapshot(
  snapshot: DailyReviewSecuritiesSnapshot,
  source: DailyReviewRuntimeSource,
  overrides: DailyReviewOrchestratorDependencies = defaultDependencies(),
): Promise<DailyReviewCatchUpResult> {
  const runtime = await source.loadSignalRuntime();
  const buyCodes = [...new Set(snapshot.watchlists.flatMap(watchlist => watchlist.codes))].sort();
  const heldCodes = [...new Set(snapshot.positionLedger.positions.map(position => position.code))].sort();
  return runDailyReviewCatchUp({
    ...overrides,
    loadUniverse: () => ({
      buyCodes,
      heldCodes,
      allCodes: [...new Set([...buyCodes, ...heldCodes])].sort(),
    }),
    loadActualLedger: () => snapshot.positionLedger,
    loadVirtualLedger: () => runtime.virtualLedger,
  });
}
export async function runDailyReviewCatchUpFromCloudState(
  source: DailyReviewCloudStateSource,
  overrides: DailyReviewOrchestratorDependencies = defaultDependencies(),
): Promise<DailyReviewCatchUpResult> {
  const [watchlists, positionLedger] = await Promise.all([
    source.loadWatchlists(),
    source.loadPositionLedger(),
  ]);
  return runDailyReviewCatchUpFromSnapshot({ watchlists, positionLedger }, source, overrides);
}
