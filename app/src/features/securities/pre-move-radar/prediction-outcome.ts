import type { PredictionObservation, PredictionOutcome, PredictionOutcomeInput } from './types';

function pct(value: number, base: number): number {
  return base > 0 ? (value / base - 1) * 100 : 0;
}

export function evaluatePredictionOutcome(input: PredictionOutcomeInput): PredictionOutcome {
  const benchmarkByDate = new Map(
    input.benchmarkBars.filter(bar => bar.date > input.signalDate).map(bar => [bar.date, bar]),
  );
  const common = input.stockBars
    .filter(bar => bar.date > input.signalDate && benchmarkByDate.has(bar.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(stock => ({ stock, benchmark: benchmarkByDate.get(stock.date)! }));

  if (common.length < 15) {
    return { evaluated: false, success: null, firstSuccessTradingDay: null,
      maxReturnPct: null, maxExcessReturnPct: null, maxDrawdownPct: null, observations: [] };
  }

  const observations: PredictionObservation[] = [];
  let minimumLow = input.signalClose;
  let firstSuccessTradingDay: number | null = null;

  for (let index = 0; index < 15; index += 1) {
    const { stock, benchmark } = common[index];
    minimumLow = Math.min(minimumLow, stock.low);
    const observation: PredictionObservation = {
      tradingDay: index + 1,
      date: stock.date,
      returnPct: pct(stock.close, input.signalClose),
      excessReturnPct: pct(stock.close, input.signalClose) - pct(benchmark.close, input.benchmarkSignalClose),
      drawdownPct: pct(minimumLow, input.signalClose),
    };
    observations.push(observation);
    if (index + 1 >= 3 && observation.returnPct >= 5 && observation.excessReturnPct >= 3 && observation.drawdownPct >= -4) {
      firstSuccessTradingDay = index + 1;
      break;
    }
  }

  return {
    evaluated: true,
    success: firstSuccessTradingDay !== null,
    firstSuccessTradingDay,
    maxReturnPct: Math.max(...observations.map(item => item.returnPct)),
    maxExcessReturnPct: Math.max(...observations.map(item => item.excessReturnPct)),
    maxDrawdownPct: Math.min(...observations.map(item => item.drawdownPct)),
    observations,
  };
}