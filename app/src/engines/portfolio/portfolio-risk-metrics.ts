export interface DatedClose {
  date: string;
  close: number;
}

export interface DatedReturn {
  date: string;
  value: number;
}

export interface StockRiskMetrics {
  returns: DatedReturn[];
  annualizedVolatility: number;
  maximumDrawdown: number;
}

export interface PairCorrelation {
  leftCode: string;
  rightCode: string;
  commonDays: number;
  correlation: number | null;
}

function validClose(row: DatedClose): boolean {
  return typeof row.date === 'string' && row.date.length > 0
    && Number.isFinite(row.close) && row.close > 0;
}

function validReturn(row: DatedReturn): boolean {
  return typeof row.date === 'string' && row.date.length > 0 && Number.isFinite(row.value);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleCovariance(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += (left[index] - leftMean) * (right[index] - rightMean);
  }
  return total / (left.length - 1);
}

function byDate(series: DatedReturn[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of series) {
    if (validReturn(row)) result.set(row.date, row.value);
  }
  return result;
}

export function simpleDailyReturns(rows: DatedClose[]): DatedReturn[] {
  const sorted = rows.filter(validClose).sort((left, right) => left.date.localeCompare(right.date));
  const result: DatedReturn[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index].close / sorted[index - 1].close - 1;
    if (Number.isFinite(value)) result.push({ date: sorted[index].date, value });
  }
  return result;
}

export function calculateStockRiskMetrics(rows: DatedClose[]): StockRiskMetrics {
  const sorted = rows.filter(validClose).sort((left, right) => left.date.localeCompare(right.date));
  const returns = simpleDailyReturns(sorted);
  const values = returns.map(row => row.value);
  const variance = sampleCovariance(values, values);

  let peak = 0;
  let maximumDrawdown = 0;
  for (const row of sorted) {
    peak = Math.max(peak, row.close);
    if (peak > 0) maximumDrawdown = Math.max(maximumDrawdown, (peak - row.close) / peak);
  }

  return {
    returns,
    annualizedVolatility: Math.sqrt(Math.max(0, variance)) * Math.sqrt(252),
    maximumDrawdown,
  };
}

export function correlateAlignedReturns(
  left: DatedReturn[],
  right: DatedReturn[],
  minimumDays = 60,
): { commonDays: number; correlation: number | null } {
  const leftMap = byDate(left);
  const rightMap = byDate(right);
  const dates = [...leftMap.keys()].filter(date => rightMap.has(date)).sort();
  const commonDays = dates.length;
  if (commonDays < minimumDays) return { commonDays, correlation: null };

  const leftValues = dates.map(date => leftMap.get(date)!);
  const rightValues = dates.map(date => rightMap.get(date)!);
  const leftVariance = sampleCovariance(leftValues, leftValues);
  const rightVariance = sampleCovariance(rightValues, rightValues);
  if (leftVariance <= 0 || rightVariance <= 0) return { commonDays, correlation: null };
  const covariance = sampleCovariance(leftValues, rightValues);
  const correlation = covariance / Math.sqrt(leftVariance * rightVariance);
  return { commonDays, correlation: Math.max(-1, Math.min(1, correlation)) };
}

export function covarianceMatrix(
  seriesByCode: Record<string, DatedReturn[]>,
): { codes: string[]; matrix: number[][]; commonDays: number } {
  const codes = Object.keys(seriesByCode).sort();
  if (codes.length === 0) return { codes: [], matrix: [], commonDays: 0 };

  const maps = codes.map(code => byDate(seriesByCode[code]));
  const dates = [...maps[0].keys()]
    .filter(date => maps.every(map => map.has(date)))
    .sort();
  const values = maps.map(map => dates.map(date => map.get(date)!));
  const matrix = codes.map((_, row) => codes.map((__, column) => sampleCovariance(values[row], values[column])));
  return { codes, matrix, commonDays: dates.length };
}
