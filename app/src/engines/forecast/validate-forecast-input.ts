import type Decimal from 'decimal.js';
import {
  AnalysisDecimal,
  canonicalDecimal,
  parseDecimalString,
} from '../../domain/analysis/decimal';
import type { EngineIssue } from '../../domain/analysis/engine-result';
import type { TraceInput } from '../../domain/analysis/calculation-trace';
import { SCENARIO_IDS, validateScenarioSet } from '../../domain/analysis/scenario';
import type { ScenarioId } from '../../domain/analysis/scenario';
import type { AnalysisUnit } from '../../domain/analysis/value';
import { DomainContractError } from '../../domain/analysis/value';
import { snapshotForecastInput } from './snapshot-forecast-input';
import type {
  ForecastHorizonMonths,
  NormalizedAmountGrowthRule,
  NormalizedForecastInput,
  NormalizedForecastScenarioAssumptions,
  NormalizedGeneratedValueRule,
  NormalizedOperatingCostRule,
  NormalizedRevenueModel,
  NormalizedScalar,
  NormalizedScenario,
  NormalizedSeasonalityPattern,
} from './forecast-types';

export type ForecastValidation =
  | {
      readonly status: 'valid';
      readonly input: NormalizedForecastInput;
      readonly warnings: readonly EngineIssue[];
      readonly traceInputs: readonly TraceInput[];
    }
  | {
      readonly status: 'blocked';
      readonly reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful';
      readonly issues: readonly EngineIssue[];
      readonly traceInputs: readonly TraceInput[];
    };

type RecordValue = Record<string, unknown>;
type ExpectedUnit =
  | { readonly kind: 'currency'; readonly currency: string }
  | { readonly kind: 'ratio'; readonly rateKind: 'signed-rate' | 'non-negative-rate' | 'unit-interval' }
  | { readonly kind: 'count'; readonly countKind: 'customer' | 'user' | 'unit' }
  | { readonly kind: 'currency-per-count'; readonly currency: string; readonly countKind: 'customer' | 'user' | 'unit'; readonly perPeriod?: 'month' }
  | { readonly kind: 'any' };

interface Context {
  readonly currency: string;
  readonly forecastStartMonth: string;
  readonly horizonMonths: number;
  readonly issues: EngineIssue[];
  readonly warnings: EngineIssue[];
  readonly valueRefs: Set<string>;
  readonly traceInputs: TraceInput[];
}

function invalidDto(): never {
  throw new DomainContractError('invalid_dto');
}

function record(value: unknown): RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : invalidDto();
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalidDto();
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : invalidDto();
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : invalidDto();
}

function exactKeys(value: RecordValue, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    return invalidDto();
  }
}

function issue(
  code: EngineIssue['code'],
  path: string,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): EngineIssue {
  return {
    code,
    path,
    message: `${path}: ${code}`,
    details,
  };
}

function addIssue(context: Context, code: EngineIssue['code'], path: string): void {
  if (context.issues.length === 0) {
    context.issues.push(issue(code, path));
  }
}

function parseUnit(value: unknown): AnalysisUnit {
  const input = record(value);
  const kind = string(input.kind);
  switch (kind) {
    case 'currency':
      exactKeys(input, ['kind', 'currency']);
      return { kind, currency: string(input.currency) };
    case 'ratio': {
      exactKeys(input, ['kind', 'rateKind']);
      const rateKind = string(input.rateKind);
      if (!['unit-interval', 'non-negative-rate', 'signed-rate', 'return-rate'].includes(rateKind)) {
        return invalidDto();
      }
      return { kind, rateKind: rateKind as 'unit-interval' | 'non-negative-rate' | 'signed-rate' | 'return-rate' };
    }
    case 'multiple':
      exactKeys(input, ['kind']);
      return { kind };
    case 'duration': {
      exactKeys(input, ['kind', 'durationUnit']);
      const durationUnit = string(input.durationUnit);
      if (!['months', 'days', 'years'].includes(durationUnit)) return invalidDto();
      return { kind, durationUnit: durationUnit as 'months' | 'days' | 'years' };
    }
    case 'count': {
      exactKeys(input, ['kind', 'countKind']);
      const countKind = string(input.countKind);
      if (!['customer', 'user', 'unit', 'share', 'order'].includes(countKind)) return invalidDto();
      return { kind, countKind: countKind as 'customer' | 'user' | 'unit' | 'share' | 'order' };
    }
    case 'currency-per-count': {
      const hasPeriod = Object.hasOwn(input, 'perPeriod');
      exactKeys(input, hasPeriod ? ['kind', 'currency', 'countKind', 'perPeriod'] : ['kind', 'currency', 'countKind']);
      const countKind = string(input.countKind);
      if (!['customer', 'user', 'unit', 'share', 'order'].includes(countKind)) return invalidDto();
      const perPeriod = hasPeriod ? string(input.perPeriod) : undefined;
      if (perPeriod !== undefined && perPeriod !== 'month' && perPeriod !== 'year') return invalidDto();
      return {
        kind,
        currency: string(input.currency),
        countKind: countKind as 'customer' | 'user' | 'unit' | 'share' | 'order',
        ...(perPeriod === undefined ? {} : { perPeriod }),
      };
    }
    default:
      return invalidDto();
  }
}

function unitsEqual(actual: AnalysisUnit, expected: ExpectedUnit): boolean {
  if (expected.kind === 'any') return true;
  if (actual.kind !== expected.kind) return false;
  switch (expected.kind) {
    case 'currency':
      return actual.kind === 'currency' && actual.currency === expected.currency;
    case 'ratio':
      return actual.kind === 'ratio' && actual.rateKind === expected.rateKind;
    case 'count':
      return actual.kind === 'count' && actual.countKind === expected.countKind;
    case 'currency-per-count':
      return actual.kind === 'currency-per-count' &&
        actual.currency === expected.currency &&
        actual.countKind === expected.countKind &&
        (expected.perPeriod === undefined || actual.perPeriod === expected.perPeriod);
  }
}

function parseConflict(value: unknown): NormalizedScalar['conflict'] {
  const input = record(value);
  const status = string(input.status);
  if (status === 'conservative-selected') {
    exactKeys(input, ['status', 'selectionReason']);
    const selectionReason = string(input.selectionReason);
    if (selectionReason.length === 0) return invalidDto();
    return { status, selectionReason };
  }
  if (!['none', 'resolved', 'blocking'].includes(status)) return invalidDto();
  exactKeys(input, ['status']);
  return { status: status as 'none' | 'resolved' | 'blocking' };
}

function sourceRefs(value: unknown): readonly string[] {
  const input = array(value);
  if (input.length > 32) return invalidDto();
  return input.map((sourceRef) => {
    const parsed = string(sourceRef);
    return parsed.length === 0 ? invalidDto() : parsed;
  });
}

function parseScalar(
  value: unknown,
  path: string,
  expected: ExpectedUnit,
  context: Context,
  options: { readonly nonNegative?: boolean; readonly unitInterval?: boolean; readonly minimum?: string } = {},
): NormalizedScalar {
  const input = record(value);
  exactKeys(input, ['valueRef', 'metricId', 'value', 'sourceRefs', 'conflict']);
  const valueRef = string(input.valueRef);
  const metricId = string(input.metricId);
  if (valueRef.length === 0 || metricId.length === 0) return invalidDto();

  const metric = record(input.value);
  exactKeys(metric, ['value', 'unit']);
  const raw = string(metric.value);
  const unit = parseUnit(metric.unit);
  const sources = sourceRefs(input.sourceRefs);
  const conflict = parseConflict(input.conflict);

  let decimal: Decimal | undefined;
  try {
    decimal = new AnalysisDecimal(parseDecimalString(raw));
  } catch {
    addIssue(context, 'invalid_decimal', path);
  }
  if (
    decimal !== undefined &&
    ((options.nonNegative === true && decimal.isNegative()) ||
      (options.unitInterval === true && (decimal.isNegative() || decimal.greaterThan(1))) ||
      (options.minimum !== undefined && decimal.lessThan(options.minimum)))
  ) {
    addIssue(context, 'value_out_of_range', path);
  }

  if (!unitsEqual(unit, expected)) {
    addIssue(
      context,
      expected.kind === 'currency' && unit.kind === 'currency'
        ? 'currency_mismatch'
        : 'unit_mismatch',
      path,
    );
  }
  if (context.valueRefs.has(valueRef)) {
    addIssue(context, 'value_out_of_range', path);
  } else {
    context.valueRefs.add(valueRef);
  }
  if (conflict.status === 'blocking') {
    addIssue(context, 'unresolved_conflict', path);
  } else if (conflict.status === 'conservative-selected') {
    context.warnings.push(issue('unresolved_conflict', path, {
      selectionReason: conflict.selectionReason ?? invalidDto(),
    }));
  }

  context.traceInputs.push({
    valueRef,
    metricId,
    value: raw,
    unit,
    periodId: context.forecastStartMonth,
    sourceRefs: sources,
  });
  return {
    valueRef,
    metricId,
    value: raw,
    unit,
    sourceRefs: sources,
    conflict,
  };
}

function parseSeasonality(
  value: unknown,
  path: string,
  context: Context,
): NormalizedSeasonalityPattern {
  const input = record(value);
  exactKeys(input, ['valueRef', 'sourceRefs', 'multipliers']);
  const valueRef = string(input.valueRef);
  if (valueRef.length === 0) return invalidDto();
  if (context.valueRefs.has(valueRef)) addIssue(context, 'value_out_of_range', path);
  else context.valueRefs.add(valueRef);
  const sources = sourceRefs(input.sourceRefs);
  const values = array(input.multipliers);
  if (values.length !== 12) addIssue(context, 'invalid_seasonality', path);
  const multipliers = values.map((item) => string(item));
  let total = new AnalysisDecimal(0);
  for (const multiplier of multipliers) {
    try {
      const parsed = new AnalysisDecimal(parseDecimalString(multiplier));
      if (parsed.lessThanOrEqualTo(0)) addIssue(context, 'invalid_seasonality', path);
      total = total.plus(parsed);
    } catch {
      addIssue(context, 'invalid_seasonality', path);
    }
  }
  if (canonicalDecimal(total) !== '12') addIssue(context, 'invalid_seasonality', path);
  return {
    valueRef,
    sourceRefs: sources,
    multipliers: multipliers as unknown as NormalizedSeasonalityPattern['multipliers'],
  };
}

function parseGenerated(
  value: unknown,
  path: string,
  expected: ExpectedUnit,
  context: Context,
  nonNegative: boolean,
): NormalizedGeneratedValueRule {
  const input = record(value);
  const hasSeasonality = Object.hasOwn(input, 'seasonality');
  exactKeys(input, hasSeasonality
    ? ['startingValue', 'monthlyGrowthRate', 'seasonality']
    : ['startingValue', 'monthlyGrowthRate']);
  return {
    startingValue: parseScalar(input.startingValue, `${path}.startingValue`, expected, context, {
      nonNegative,
    }),
    monthlyGrowthRate: parseScalar(input.monthlyGrowthRate, `${path}.monthlyGrowthRate`, {
      kind: 'ratio',
      rateKind: 'signed-rate',
    }, context, { minimum: nonNegative ? '-1' : undefined }),
    ...(hasSeasonality
      ? { seasonality: parseSeasonality(input.seasonality, `${path}.seasonality`, context) }
      : {}),
  };
}

function parseRevenue(value: unknown, path: string, context: Context): NormalizedRevenueModel {
  const input = record(value);
  const kind = string(input.kind);
  switch (kind) {
    case 'customer-count-times-average-revenue':
      exactKeys(input, ['kind', 'customerCount', 'averageRevenuePerCustomer']);
      return {
        kind,
        customerCount: parseGenerated(input.customerCount, `${path}.customerCount`, { kind: 'count', countKind: 'customer' }, context, true),
        averageRevenuePerCustomer: parseGenerated(input.averageRevenuePerCustomer, `${path}.averageRevenuePerCustomer`, { kind: 'currency-per-count', currency: context.currency, countKind: 'customer', perPeriod: 'month' }, context, true),
      };
    case 'user-count-times-arpu':
      exactKeys(input, ['kind', 'userCount', 'arpu']);
      return {
        kind,
        userCount: parseGenerated(input.userCount, `${path}.userCount`, { kind: 'count', countKind: 'user' }, context, true),
        arpu: parseGenerated(input.arpu, `${path}.arpu`, { kind: 'currency-per-count', currency: context.currency, countKind: 'user', perPeriod: 'month' }, context, true),
      };
    case 'gmv-times-take-rate':
      exactKeys(input, ['kind', 'gmv', 'takeRate']);
      return {
        kind,
        gmv: parseGenerated(input.gmv, `${path}.gmv`, { kind: 'currency', currency: context.currency }, context, true),
        takeRate: parseGenerated(input.takeRate, `${path}.takeRate`, { kind: 'ratio', rateKind: 'non-negative-rate' }, context, true),
      };
    case 'unit-sales-times-unit-price':
      exactKeys(input, ['kind', 'unitsSold', 'unitPrice']);
      return {
        kind,
        unitsSold: parseGenerated(input.unitsSold, `${path}.unitsSold`, { kind: 'count', countKind: 'unit' }, context, true),
        unitPrice: parseGenerated(input.unitPrice, `${path}.unitPrice`, { kind: 'currency-per-count', currency: context.currency, countKind: 'unit' }, context, true),
      };
    case 'custom-product': {
      exactKeys(input, ['kind', 'factors']);
      const factors = array(input.factors);
      if (factors.length < 2 || factors.length > 5) addIssue(context, 'invalid_revenue_driver', path);
      return {
        kind,
        factors: factors.map((factor, index) => {
          const item = record(factor);
          exactKeys(item, ['factorId', 'rule']);
          const factorId = string(item.factorId);
          if (factorId.length === 0) return invalidDto();
          return {
            factorId,
            rule: parseGenerated(item.rule, `${path}.factors.${index}`, { kind: 'any' }, context, true),
          };
        }),
      };
    }
    default:
      return invalidDto();
  }
}

function parseOperatingCost(
  value: unknown,
  path: string,
  context: Context,
  allowNegative: boolean,
): NormalizedOperatingCostRule {
  const input = record(value);
  const kind = string(input.kind);
  if (kind === 'revenue-ratio') {
    exactKeys(input, ['kind', 'modelYearRates']);
    const rates = array(input.modelYearRates);
    if (rates.length !== context.horizonMonths / 12) {
      addIssue(context, 'invalid_forecast_horizon', path);
    }
    return {
      kind,
      modelYearRates: rates.map((rate, index) => parseScalar(
        rate,
        `${path}.modelYearRates.${index}`,
        { kind: 'ratio', rateKind: 'non-negative-rate' },
        context,
        { nonNegative: true },
      )),
    };
  }
  if (kind === 'amount-growth') {
    exactKeys(input, ['kind', 'rule']);
    return {
      kind,
      rule: parseGenerated(input.rule, `${path}.rule`, {
        kind: 'currency',
        currency: context.currency,
      }, context, !allowNegative),
    };
  }
  return invalidDto();
}

function parseAssumptions(
  value: unknown,
  path: string,
  context: Context,
): NormalizedForecastScenarioAssumptions {
  const input = record(value);
  exactKeys(input, [
    'revenue',
    'costOfGoodsSold',
    'salesAndMarketing',
    'researchAndDevelopment',
    'generalAndAdministrative',
    'depreciationAndAmortization',
    'interestExpense',
    'capitalExpenditure',
    'increaseInNetWorkingCapital',
    'taxRate',
  ]);
  const amount = (key: string, allowNegative = false): NormalizedAmountGrowthRule => {
    const parsed = parseOperatingCost(input[key], `${path}.${key}`, context, allowNegative);
    return parsed.kind === 'amount-growth' ? parsed : invalidDto();
  };
  return {
    revenue: parseRevenue(input.revenue, `${path}.revenue`, context),
    costOfGoodsSold: parseOperatingCost(input.costOfGoodsSold, `${path}.costOfGoodsSold`, context, false),
    salesAndMarketing: parseOperatingCost(input.salesAndMarketing, `${path}.salesAndMarketing`, context, false),
    researchAndDevelopment: parseOperatingCost(input.researchAndDevelopment, `${path}.researchAndDevelopment`, context, false),
    generalAndAdministrative: parseOperatingCost(input.generalAndAdministrative, `${path}.generalAndAdministrative`, context, false),
    depreciationAndAmortization: amount('depreciationAndAmortization'),
    interestExpense: amount('interestExpense'),
    capitalExpenditure: amount('capitalExpenditure'),
    increaseInNetWorkingCapital: amount('increaseInNetWorkingCapital', true),
    taxRate: parseScalar(input.taxRate, `${path}.taxRate`, {
      kind: 'ratio',
      rateKind: 'unit-interval',
    }, context, { unitInterval: true }),
  };
}

function validStartMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function validateForecastInput(value: unknown): ForecastValidation {
  const input = record(snapshotForecastInput(value));
  exactKeys(input, ['version', 'baseline', 'scenarios']);
  const version = string(input.version);
  const baseline = record(input.baseline);
  exactKeys(baseline, [
    'currency',
    'forecastStartMonth',
    'horizonMonths',
    'beginningCash',
    'minimumCashBalance',
  ]);
  const currency = string(baseline.currency);
  const forecastStartMonth = string(baseline.forecastStartMonth);
  const horizonMonths = number(baseline.horizonMonths);
  const context: Context = {
    currency,
    forecastStartMonth,
    horizonMonths,
    issues: [],
    warnings: [],
    valueRefs: new Set<string>(),
    traceInputs: [],
  };

  if (version !== '1') addIssue(context, 'unsupported_engine_version', 'forecast.version');
  if (![36, 48, 60].includes(horizonMonths)) addIssue(context, 'invalid_forecast_horizon', 'forecast.baseline.horizonMonths');
  if (!validStartMonth(forecastStartMonth)) addIssue(context, 'period_mismatch', 'forecast.baseline.forecastStartMonth');
  if (!/^[A-Z]{3}$/.test(currency)) addIssue(context, 'currency_mismatch', 'forecast.baseline.currency');

  const normalizedBaseline = {
    currency,
    forecastStartMonth,
    horizonMonths: horizonMonths as ForecastHorizonMonths,
    beginningCash: parseScalar(baseline.beginningCash, 'forecast.baseline.beginningCash', {
      kind: 'currency',
      currency,
    }, context, { nonNegative: true }),
    minimumCashBalance: parseScalar(baseline.minimumCashBalance, 'forecast.baseline.minimumCashBalance', {
      kind: 'currency',
      currency,
    }, context, { nonNegative: true }),
  };

  const scenarioEnvelopes = array(input.scenarios).map((scenario) => {
    const item = record(scenario);
    exactKeys(item, ['id', 'probability', 'assumptions']);
    return {
      id: string(item.id),
      probability: string(item.probability),
      assumptions: item.assumptions,
    };
  });

  let scenarioValidation: ReturnType<typeof validateScenarioSet>;
  try {
    scenarioValidation = validateScenarioSet(scenarioEnvelopes);
  } catch {
    return invalidDto();
  }
  if (scenarioValidation.status === 'invalid') {
    addIssue(
      context,
      scenarioValidation.issue.code,
      'forecast.scenarios',
    );
  }

  const scenarios = scenarioEnvelopes.map((scenario, index): NormalizedScenario => ({
    id: scenario.id as ScenarioId,
    probability: scenario.probability,
    assumptions: parseAssumptions(
      scenario.assumptions,
      `forecast.scenarios.${scenario.id || index}.assumptions`,
      context,
    ),
  }));

  context.traceInputs.sort((left, right) => left.valueRef.localeCompare(right.valueRef));
  context.warnings.sort((left, right) => left.path.localeCompare(right.path));
  if (context.issues.length > 0) {
    return {
      status: 'blocked',
      reason: 'invalid-input',
      issues: context.issues,
      traceInputs: context.traceInputs,
    };
  }

  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  return {
    status: 'valid',
    input: {
      version: '1',
      baseline: normalizedBaseline,
      scenarios: SCENARIO_IDS.map((id) => byId.get(id) as NormalizedScenario),
    },
    warnings: context.warnings,
    traceInputs: context.traceInputs,
  };
}
