import { scanPatterns } from '../../../engines/market-analysis/kline-patterns';
import { calcAllIndicators } from '../../../engines/market-analysis/technical-indicators';
import { scanStrategies } from '../../../engines/market-analysis/trading-strategies';
import { fetchCsi300Klines, fetchHistoricalCapitalFlow, fetchIndustryFlows, fetchMultiDayCapitalFlows,
  type HistoricalCapitalFlowPoint, type IndustryFlowRow, type MultiDayCapitalFlow } from '../../../infrastructure/market-data/pre-move-market-data-api';
import { fetchEastmoneyKLine, fetchStockQuotes, loadStockDirectory, type AStockDirectoryItem, type StockKLine, type StockQuote } from '../../../infrastructure/market-data/stock-api';
import { isAStockTradingDay } from '../a-share-trading-calendar';
import { loadMonitoringUniverse, type MonitoringUniverse } from '../stock-monitoring-universe';
import { buildPreMoveCandidateUniverse, type IndustryScreenInput } from './candidate-universe';
import { generateHistoricalCalibrationSamples } from './historical-calibration';
import { calibrateProbability } from './probability-calibrator';
import { preMoveRadarDb } from './radar-db';
import { PreMoveRadarRepository, type PreMovePredictionRecord, type PreMoveScanRecord } from './radar-repository';
import { calculatePreMoveSignal } from './signal-engine';
import type { CalibrationSample, IndustryRotationView, MarketRegime, PreMovePrediction, PreMoveStatus } from './types';

const MODEL_VERSION = 'pre-move-v1';
const CACHE_MS = 15 * 60 * 1000;

export interface PreMoveRadarScanResult {
  scanId: string;
  tradingDate: string;
  formal: boolean;
  marketRegime: MarketRegime;
  industries: IndustryRotationView[];
  predictions: PreMovePrediction[];
  errors: Array<{ source: string; code?: string; message: string }>;
  dataAsOf: string;
  cacheStatus: 'fresh' | 'cached';
}

export interface PreMoveRadarServiceDependencies {
  now: () => Date;
  loadWatchlistUniverse: () => MonitoringUniverse;
  loadDirectory: () => Promise<AStockDirectoryItem[]>;
  loadAllQuotes: () => Promise<StockQuote[]>;
  loadIndustryFlows: () => Promise<IndustryFlowRow[]>;
  loadCapitalFlows: (period: 3 | 5 | 10) => Promise<MultiDayCapitalFlow[]>;
  loadQuote: (code: string) => Promise<StockQuote | null>;
  loadBars: (code: string, days: number) => Promise<StockKLine[]>;
  loadCapitalFlowHistory: (code: string, days: number) => Promise<HistoricalCapitalFlowPoint[]>;
  loadBenchmarkBars: (days: number) => Promise<StockKLine[]>;
  repository: PreMoveRadarRepository;
}

interface CacheEntry { at: number; result: PreMoveRadarScanResult; }
const cache = new WeakMap<object, CacheEntry>();

async function mapLimit<T, R>(values: T[], limit: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor; cursor += 1;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => run()));
  return results;
}

function percentile(values: number[], value: number): number {
  if (!values.length) return 0;
  return values.filter(item => item <= value).length / values.length * 100;
}

function buildIndustries(directory: AStockDirectoryItem[], quotes: StockQuote[], flows: IndustryFlowRow[]): {
  screens: IndustryScreenInput[]; views: IndustryRotationView[];
} {
  const quoteByCode = new Map(quotes.map(item => [item.code, item]));
  const breadthByIndustry = new Map<string, number>();
  for (const industry of new Set(directory.map(item => item.industry))) {
    const members = directory.filter(item => item.industry === industry).map(item => quoteByCode.get(item.code)).filter((item): item is StockQuote => Boolean(item));
    breadthByIndustry.set(industry, members.length ? members.filter(item => item.changePct > 0).length / members.length * 100 : 0);
  }
  const returns = flows.map(item => item.changePct1d);
  const fundFlows = flows.map(item => item.mainNet1d);
  const breadths = flows.map(item => breadthByIndustry.get(item.industryName) ?? 0);
  const slopes = flows.map(item => item.mainRatio1d - (item.mainRatio5d ?? item.mainRatio1d) + ((item.mainRatio5d ?? 0) - (item.mainRatio10d ?? 0)));
  const ranked = flows.map((flow, index) => {
    const screen = { industry: flow.industryName, rank: 0,
      returnPercentile: percentile(returns, flow.changePct1d), flowPercentile: percentile(fundFlows, flow.mainNet1d),
      breadthPercentile: percentile(breadths, breadthByIndustry.get(flow.industryName) ?? 0),
      relativeStrengthSlopePercentile: percentile(slopes, slopes[index]) };
    const composite = (screen.returnPercentile + screen.flowPercentile + screen.breadthPercentile + screen.relativeStrengthSlopePercentile) / 4;
    return { flow, screen, composite };
  }).sort((a, b) => b.composite - a.composite);
  ranked.forEach((item, index) => { item.screen.rank = index + 1; });
  const views = ranked.slice(0, 10).map(({ flow, screen, composite }) => {
    const stage: IndustryRotationView['stage'] = flow.changePct1d >= 5 ? 'overheated'
      : flow.mainNet1d > 0 && (flow.mainNet5d ?? 0) > 0 && flow.changePct1d > 1 ? 'starting'
      : flow.mainNet1d > 0 ? 'accumulating' : flow.changePct1d < 0 ? 'weakening' : 'watch';
    return { industry: flow.industryName, rank: screen.rank, compositeScore: composite,
      returnPct1d: flow.changePct1d, returnPct5d: null, returnPct10d: null,
      mainNet1d: flow.mainNet1d, mainNet5d: flow.mainNet5d, mainNet10d: flow.mainNet10d, stage };
  });
  return { screens: ranked.map(item => item.screen), views };
}

function mergeCapitalFlows(groups: MultiDayCapitalFlow[][]): MultiDayCapitalFlow[] {
  const merged = new Map<string, MultiDayCapitalFlow>();
  for (const group of groups) for (const item of group) merged.set(item.code, { ...(merged.get(item.code) ?? item), ...item });
  return [...merged.values()];
}

function shanghaiParts(now: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '0';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
}

function regime(benchmark: StockKLine[], quotes: StockQuote[]): MarketRegime {
  const change20 = benchmark.length > 20 ? (benchmark.at(-1)!.close / benchmark[benchmark.length - 21].close - 1) * 100 : 0;
  const breadth = quotes.length ? quotes.filter(item => item.changePct > 0).length / quotes.length : 0.5;
  if (change20 >= 2 && breadth >= 0.55) return 'strong';
  if (change20 <= -2 && breadth <= 0.45) return 'weak';
  return 'sideways';
}

async function defaultAllQuotes(): Promise<StockQuote[]> {
  const directory = await loadStockDirectory();
  const batches: string[][] = [];
  for (let index = 0; index < directory.length; index += 80) batches.push(directory.slice(index, index + 80).map(item => item.code));
  return (await mapLimit(batches, 4, batch => fetchStockQuotes(batch))).flat();
}

const defaultRepository = new PreMoveRadarRepository(preMoveRadarDb);
const defaultDependencies: PreMoveRadarServiceDependencies = {
  now: () => new Date(), loadWatchlistUniverse: () => loadMonitoringUniverse(), loadDirectory: () => loadStockDirectory(),
  loadAllQuotes: defaultAllQuotes,
  loadIndustryFlows: async () => { const result = await fetchIndustryFlows(); if (result.meta.status === 'error') throw new Error(result.meta.error); return result.data; },
  loadCapitalFlows: async period => { const result = await fetchMultiDayCapitalFlows(period); if (result.meta.status === 'error') throw new Error(result.meta.error); return result.data; },
  loadQuote: async code => (await fetchStockQuotes([code]))[0] ?? null,
  loadBars: (code, days) => fetchEastmoneyKLine(code, days),
  loadCapitalFlowHistory: async (code, days) => { const result = await fetchHistoricalCapitalFlow(code, days); if (result.meta.status === 'error') throw new Error(result.meta.error); return result.data; },
  loadBenchmarkBars: async days => { const result = await fetchCsi300Klines(days); if (result.meta.status === 'error') throw new Error(result.meta.error); return result.data; },
  repository: defaultRepository,
};

function capStatus(status: PreMoveStatus, industryAvailable: boolean): PreMoveStatus {
  return !industryAvailable && status === 'layout_ready' ? 'await_confirmation' : status;
}

export async function scanPreMoveRadar(
  options: { force?: boolean } = {}, dependencies: PreMoveRadarServiceDependencies = defaultDependencies,
): Promise<PreMoveRadarScanResult> {
  const now = dependencies.now();
  const cached = cache.get(dependencies);
  if (!options.force && cached && now.getTime() - cached.at < CACHE_MS) return { ...cached.result, cacheStatus: 'cached' };

  const errors: PreMoveRadarScanResult['errors'] = [];
  const parts = shanghaiParts(now);
  const afterClose = parts.hour > 15 || (parts.hour === 15 && parts.minute >= 10);
  let tradingDay = false;
  try { tradingDay = isAStockTradingDay(parts.date); }
  catch {
    const weekday = new Date(parts.date + 'T12:00:00+08:00').getDay();
    tradingDay = weekday !== 0 && weekday !== 6;
  }
  const formal = afterClose && tradingDay;
  const universe = dependencies.loadWatchlistUniverse();
  const [directoryResult, quotesResult, industryResult, benchmarkResult, capitalResults] = await Promise.all([
    dependencies.loadDirectory().then(data => ({ data })).catch(error => ({ data: [] as AStockDirectoryItem[], error })),
    dependencies.loadAllQuotes().then(data => ({ data })).catch(error => ({ data: [] as StockQuote[], error })),
    dependencies.loadIndustryFlows().then(data => ({ data })).catch(error => ({ data: [] as IndustryFlowRow[], error })),
    dependencies.loadBenchmarkBars(300).then(data => ({ data })).catch(error => ({ data: [] as StockKLine[], error })),
    Promise.allSettled(([3, 5, 10] as const).map(period => dependencies.loadCapitalFlows(period))),
  ]);
  for (const [source, value] of [['directory', directoryResult], ['quotes', quotesResult], ['industry', industryResult], ['benchmark', benchmarkResult]] as const) {
    if ('error' in value) errors.push({ source, message: value.error instanceof Error ? value.error.message : String(value.error) });
  }
  const capitalGroups = capitalResults.flatMap((value, index) => {
    if (value.status === 'fulfilled') return [value.value];
    errors.push({ source: `capital-${[3, 5, 10][index]}`, message: value.reason instanceof Error ? value.reason.message : String(value.reason) });
    return [];
  });
  const capitalFlows = mergeCapitalFlows(capitalGroups);
  const industryData = buildIndustries(directoryResult.data, quotesResult.data, industryResult.data);
  const candidates = buildPreMoveCandidateUniverse({ watchlistCodes: universe.buyCodes, directory: directoryResult.data,
    quotes: quotesResult.data, industries: industryData.screens, capitalFlows, maxRotationCandidates: 200 });
  let samples = await dependencies.repository.listCalibrationSamples(MODEL_VERSION);

  if (samples.length < 200) {
    const bootstrapCodes = [...new Set([...universe.buyCodes, ...candidates.filter(item => item.source !== 'watchlist').slice(0, 50).map(item => item.code)])];
    const generated = (await mapLimit(bootstrapCodes, 4, async code => {
      try {
        const [stockBars, flowHistory] = await Promise.all([dependencies.loadBars(code, 250), dependencies.loadCapitalFlowHistory(code, 250)]);
        return generateHistoricalCalibrationSamples({ code, stockBars, benchmarkBars: benchmarkResult.data,
          flowHistory, modelVersion: MODEL_VERSION });
      } catch (error) {
        errors.push({ source: 'historical-calibration', code, message: error instanceof Error ? error.message : String(error) });
        return [] as CalibrationSample[];
      }
    })).flat();
    await dependencies.repository.saveCalibrationSamples(generated);
    samples = await dependencies.repository.listCalibrationSamples(MODEL_VERSION);
  }

  const quoteByCode = new Map(quotesResult.data.map(item => [item.code, item]));
  const flowByCode = new Map(capitalFlows.map(item => [item.code, item]));
  const industryScreenByName = new Map(industryData.screens.map(item => [item.industry, item]));
  const industryViewByName = new Map(industryData.views.map(item => [item.industry, item]));
  const marketRegime = regime(benchmarkResult.data, quotesResult.data);

  const analyzed = await mapLimit(candidates, 4, async candidate => {
    try {
      const quote = quoteByCode.get(candidate.code) ?? await dependencies.loadQuote(candidate.code);
      if (!quote) throw new Error('实时行情不可用');
      const [bars, flowHistory] = await Promise.all([dependencies.loadBars(candidate.code, 120), dependencies.loadCapitalFlowHistory(candidate.code, 60)]);
      const prepared = bars.map(bar => ({ ...bar })); calcAllIndicators(prepared);
      const industryScreen = candidate.industry ? industryScreenByName.get(candidate.industry) : undefined;
      const signal = calculatePreMoveSignal({ asOfDate: parts.date, formal, quote,
        industry: industryScreen ? { returnPercentile: industryScreen.returnPercentile, flowPercentile: industryScreen.flowPercentile,
          breadthPercentile: industryScreen.breadthPercentile, relativeStrengthSlopePercentile: industryScreen.relativeStrengthSlopePercentile,
          stage: industryViewByName.get(industryScreen.industry)?.stage ?? null }
          : { returnPercentile: null, flowPercentile: null, breadthPercentile: null, relativeStrengthSlopePercentile: null, stage: null },
        capitalFlow: flowByCode.get(candidate.code) ?? null, flowHistory, klines: prepared,
        benchmarkKlines: benchmarkResult.data, strategySignals: scanStrategies(prepared), patterns: scanPatterns(prepared),
        specialTreatment: /ST/i.test(quote.name), suspended: quote.price <= 0 });
      const calibrated = calibrateProbability({ score: signal.scores.total, marketRegime,
        featureCoverage: signal.featureCoverage, dataCompleteness: signal.dataCompleteness,
        hardRisks: signal.hardRisks, samples });
      const stage = candidate.industry ? industryViewByName.get(candidate.industry)?.stage : undefined;
      const expectedWindow: PreMovePrediction['expectedWindow'] = stage === 'starting' && signal.scores.relativeStrength >= 6 ? '3_5'
        : signal.scores.accumulation >= 15 ? '5_10' : '10_15';
      const prediction: PreMovePrediction = { code: candidate.code, name: candidate.name, industry: candidate.industry,
        source: candidate.source, currentPrice: quote.price, signalScore: signal.scores.total, scores: signal.scores,
        rawFeatures: signal.rawFeatures, featureCoverage: signal.featureCoverage, probability: calibrated.probability,
        confidence: calibrated.confidence, formalProbability: calibrated.formal, sampleSize: calibrated.sampleSize,
        similarSampleSize: calibrated.similarSampleSize, status: capStatus(calibrated.status, industryResult.data.length > 0),
        expectedWindow, positiveEvidence: signal.positiveEvidence, risks: signal.risks,
        invalidationConditions: signal.invalidationConditions, dataCompleteness: signal.dataCompleteness,
        dataSources: ['东方财富/腾讯行情', '东方财富资金流', '现有技术指标引擎'], dataAsOf: now.toISOString() };
      return { prediction, quote };
    } catch (error) {
      errors.push({ source: 'deep-scan', code: candidate.code, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });
  const predictions = analyzed.flatMap(value => value ? [value.prediction] : []).sort((a, b) => {
    const rank = { layout_ready: 0, await_confirmation: 1, avoid_layout: 2 };
    return rank[a.status] - rank[b.status] || b.probability - a.probability || b.confidence - a.confidence || b.signalScore - a.signalScore;
  });
  const scanId = `${MODEL_VERSION}-${parts.date}`;
  const result: PreMoveRadarScanResult = { scanId, tradingDate: parts.date, formal, marketRegime,
    industries: industryData.views, predictions, errors, dataAsOf: now.toISOString(), cacheStatus: 'fresh' };

  if (formal) {
    const scan: PreMoveScanRecord = { id: scanId, tradingDate: parts.date, createdAt: now.toISOString(),
      modelVersion: MODEL_VERSION, formal: true, marketRegime, dataSources: ['东方财富', '腾讯行情', 'InStock算法参考'] };
    const benchmarkSignalClose = benchmarkResult.data.at(-1)?.close ?? 0;
    const records: PreMovePredictionRecord[] = predictions.map(prediction => ({ ...prediction,
      id: `${scanId}-${prediction.code}`, scanId, tradingDate: parts.date, modelVersion: MODEL_VERSION,
      marketRegime, signalClose: prediction.currentPrice, benchmarkSignalClose }));
    await dependencies.repository.saveFormalScan(scan, records);
  }
  cache.set(dependencies, { at: now.getTime(), result });
  return result;
}
