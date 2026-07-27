import type Decimal from 'decimal.js';

import type { TraceInput } from '../../domain/analysis/calculation-trace';
import {
  AnalysisDecimal,
  canonicalDecimal,
  parseDecimalString,
  parseReturnRateString,
  parseUnitIntervalString,
  type DecimalString,
} from '../../domain/analysis/decimal';
import type { EngineIssue } from '../../domain/analysis/engine-result';
import {
  parseAnalysisPeriodStructure,
  validateAnalysisPeriodValue,
  type FlowPeriod,
} from '../../domain/analysis/period';
import { DomainContractError } from '../../domain/analysis/value';
import { snapshotValuationInput } from './snapshot-valuation-input';
import type {
  ComparablePeer,
  ComparableValuationInput,
  DcfInput,
  DecimalRangeInput,
  FivePointDecimalTuple,
  ValuationRange,
  ValuationTriangulationInput,
  VcMethodInput,
  WeightedValuationMethod,
} from './valuation-types';

type BlockReason = 'insufficient-data' | 'invalid-input' | 'not-meaningful';

export type ValuationInputValidation<T> =
  | {
      readonly status: 'valid';
      readonly input: T;
      readonly warnings: readonly EngineIssue[];
      readonly traceInputs: readonly TraceInput[];
    }
  | {
      readonly status: 'blocked';
      readonly reason: BlockReason;
      readonly issues: readonly EngineIssue[];
      readonly traceInputs: readonly TraceInput[];
    };

const currencyPattern = /^[A-Z]{3}$/;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const methodIds = [
  'dcf',
  'comparable-ev-revenue',
  'comparable-ev-ebitda',
  'comparable-pe',
  'vc-method',
] as const;
const modelYearAmountKeys = [
  'revenue',
  'costOfGoodsSold',
  'grossProfit',
  'salesAndMarketing',
  'researchAndDevelopment',
  'generalAndAdministrative',
  'ebitda',
  'depreciationAndAmortization',
  'ebit',
  'interestExpense',
  'preTaxIncome',
  'incomeTax',
  'netIncome',
  'increaseInNetWorkingCapital',
  'operatingCashFlow',
  'capitalExpenditure',
  'freeCashFlow',
  'fcff',
  'beginningCash',
  'preFinancingEndingCash',
  'financingInflow',
  'endingCash',
] as const;

function invalidDto(): never {
  throw new DomainContractError('invalid_dto');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : invalidDto();
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalidDto();
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : invalidDto();
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : string(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value).sort();
  const allowed = [...required, ...optional].sort();
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.includes(key))
  ) {
    return invalidDto();
  }
}

function issue(
  code: EngineIssue['code'],
  path: string,
  details: EngineIssue['details'] = {},
): EngineIssue {
  return {
    code,
    path,
    message: `${code} at ${path}`,
    details,
  };
}

function sortedIssues(issues: readonly EngineIssue[]): readonly EngineIssue[] {
  return [...issues].sort((left, right) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code),
  );
}

function sortedTraceInputs(inputs: readonly TraceInput[]): readonly TraceInput[] {
  return [...inputs].sort((left, right) =>
    left.valueRef.localeCompare(right.valueRef),
  );
}

function blocked<T>(
  issues: readonly EngineIssue[],
  traceInputs: readonly TraceInput[],
  reason: BlockReason = 'invalid-input',
): ValuationInputValidation<T> {
  return {
    status: 'blocked',
    reason,
    issues: sortedIssues(issues),
    traceInputs: sortedTraceInputs(traceInputs),
  };
}

function valid<T>(
  input: T,
  traceInputs: readonly TraceInput[],
): ValuationInputValidation<T> {
  return {
    status: 'valid',
    input,
    warnings: [],
    traceInputs: sortedTraceInputs(traceInputs),
  };
}

function parseDecimal(
  raw: unknown,
  path: string,
  issues: EngineIssue[],
): DecimalString | undefined {
  const value = string(raw);
  try {
    return canonicalDecimal(parseDecimalString(value));
  } catch {
    issues.push(issue('invalid_decimal', path));
    return undefined;
  }
}

function parseCurrency(
  raw: unknown,
  path: string,
  issues: EngineIssue[],
): string {
  const value = string(raw);
  if (!currencyPattern.test(value)) issues.push(issue('value_out_of_range', path));
  return value;
}

function parseDateValue(
  raw: unknown,
  path: string,
  issues: EngineIssue[],
): string {
  const value = string(raw);
  if (parseDate(value) === undefined) issues.push(issue('value_out_of_range', path));
  return value;
}

function parseDate(value: string): Date | undefined {
  const match = datePattern.exec(value);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : undefined;
}

function traceInput(
  valueRef: string,
  metricId: string,
  value: string,
  currency: string,
  periodId: string,
): TraceInput {
  return {
    valueRef,
    metricId,
    value,
    unit: { kind: 'currency', currency },
    periodId,
    sourceRefs: [],
  };
}

function ratioTraceInput(
  valueRef: string,
  metricId: string,
  value: string,
  periodId: string,
  rateKind: 'unit-interval' | 'signed-rate' | 'return-rate' = 'signed-rate',
): TraceInput {
  return {
    valueRef,
    metricId,
    value,
    unit: { kind: 'ratio', rateKind },
    periodId,
    sourceRefs: [],
  };
}

function validateFlowPeriod(
  raw: unknown,
  path: string,
  issues: EngineIssue[],
): FlowPeriod {
  const value = record(raw);
  exactKeys(value, [
    'kind',
    'id',
    'startDate',
    'endDate',
    'durationMonths',
    'granularity',
  ]);
  const period = parseAnalysisPeriodStructure(value);
  if (period.kind !== 'flow' || validateAnalysisPeriodValue(period).status !== 'valid') {
    issues.push(issue('period_mismatch', path));
    return period as FlowPeriod;
  }
  return period;
}

function validateModelYears(
  raw: unknown,
  currency: string,
  issues: EngineIssue[],
  traceInputs: TraceInput[],
): readonly DcfInput['modelYears'][number][] {
  const values = array(raw);
  if (values.length === 0) issues.push(issue('missing_input', 'modelYears'));

  return values.map((candidate, index) => {
    const value = record(candidate);
    exactKeys(value, ['period', ...modelYearAmountKeys]);
    const period = validateFlowPeriod(value.period, `modelYears[${index}].period`, issues);
    const output = { period } as Record<string, unknown>;
    for (const key of modelYearAmountKeys) {
      const parsed = parseDecimal(value[key], `modelYears[${index}].${key}`, issues);
      output[key] = parsed ?? string(value[key]);
      if (parsed !== undefined && ['revenue', 'ebitda', 'netIncome', 'fcff'].includes(key)) {
        traceInputs.push(traceInput(
          `forecast:${period.id}:${key}`,
          key,
          parsed,
          currency,
          period.id,
        ));
      }
    }
    return output as unknown as DcfInput['modelYears'][number];
  });
}

function validateModelYearSequence(
  modelYears: readonly DcfInput['modelYears'][number][],
  valuationDate: string,
  issues: EngineIssue[],
): void {
  if (modelYears.length === 0) return;
  const valuation = parseDate(valuationDate);
  const firstStart = parseDate(modelYears[0]!.period.startDate);
  if (valuation !== undefined && firstStart !== undefined) {
    const previousDay = new Date(firstStart.getTime());
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    if (valuation.getTime() !== previousDay.getTime()) {
      issues.push(issue('period_mismatch', 'valuationDate'));
    }
  }

  for (let index = 1; index < modelYears.length; index += 1) {
    const previousEnd = parseDate(modelYears[index - 1]!.period.endDate);
    const currentStart = parseDate(modelYears[index]!.period.startDate);
    if (previousEnd === undefined || currentStart === undefined) continue;
    const expected = new Date(previousEnd.getTime());
    expected.setUTCDate(expected.getUTCDate() + 1);
    if (expected.getTime() !== currentStart.getTime()) {
      issues.push(issue('period_mismatch', `modelYears[${index}].period`));
    }
  }
}

function validateFivePointAxis(
  raw: unknown,
  path: string,
  base: DecimalString | undefined,
  issues: EngineIssue[],
  predicate?: (value: Decimal) => boolean,
): FivePointDecimalTuple {
  const values = array(raw);
  if (values.length !== 5) {
    issues.push(issue('invalid_sensitivity_matrix', path));
    return ['0', '0', '0', '0', '0'];
  }

  const parsed = values.map((value, index) =>
    parseDecimal(value, `${path}[${index}]`, issues) ?? '0',
  ) as unknown as FivePointDecimalTuple;
  let previous: Decimal | undefined;
  for (const value of parsed) {
    const decimal = new AnalysisDecimal(value);
    if (
      (previous !== undefined && !decimal.greaterThan(previous)) ||
      (predicate !== undefined && !predicate(decimal))
    ) {
      issues.push(issue('invalid_sensitivity_matrix', path));
      break;
    }
    previous = decimal;
  }
  if (base !== undefined && parsed[2] !== base) {
    issues.push(issue('invalid_sensitivity_matrix', path));
  }
  return parsed;
}

function validateRange(
  raw: unknown,
  path: string,
  issues: EngineIssue[],
  positive = false,
  exact = true,
): DecimalRangeInput {
  const value = record(raw);
  if (exact) exactKeys(value, ['low', 'midpoint', 'high']);
  const low = parseDecimal(value.low, `${path}.low`, issues) ?? '0';
  const midpoint = parseDecimal(value.midpoint, `${path}.midpoint`, issues) ?? '0';
  const high = parseDecimal(value.high, `${path}.high`, issues) ?? '0';
  const lowDecimal = new AnalysisDecimal(low);
  const midpointDecimal = new AnalysisDecimal(midpoint);
  const highDecimal = new AnalysisDecimal(high);
  if (
    lowDecimal.greaterThan(midpointDecimal) ||
    midpointDecimal.greaterThan(highDecimal) ||
    (positive && !lowDecimal.greaterThan(0))
  ) {
    issues.push(issue('invalid_valuation_range', path));
  }
  return { low, midpoint, high };
}

export function validateDcfInput(input: unknown): ValuationInputValidation<DcfInput> {
  const snapshot = record(snapshotValuationInput(input));
  exactKeys(snapshot, [
    'version',
    'currency',
    'valuationDate',
    'scenarioId',
    'probability',
    'modelYears',
    'discountingConvention',
    'wacc',
    'perpetuityGrowthRate',
    'exitMultiple',
    'exitMetric',
    'interestBearingDebt',
    'cashAndCashEquivalents',
    'terminalMethodWeights',
    'sensitivity',
  ]);

  const issues: EngineIssue[] = [];
  const traceInputs: TraceInput[] = [];
  const version = string(snapshot.version);
  if (version !== '1') issues.push(issue('unsupported_engine_version', 'version'));
  const currency = parseCurrency(snapshot.currency, 'currency', issues);
  const valuationDate = parseDateValue(snapshot.valuationDate, 'valuationDate', issues);
  const scenarioId = string(snapshot.scenarioId);
  if (!['downside', 'base', 'upside'].includes(scenarioId)) {
    issues.push(issue('value_out_of_range', 'scenarioId'));
  }
  const probability = parseDecimal(snapshot.probability, 'probability', issues) ?? '0';
  try {
    parseUnitIntervalString(probability);
  } catch {
    issues.push(issue('value_out_of_range', 'probability'));
  }

  const modelYears = validateModelYears(
    snapshot.modelYears,
    currency,
    issues,
    traceInputs,
  );
  validateModelYearSequence(modelYears, valuationDate, issues);

  const discountingConvention = string(snapshot.discountingConvention);
  if (!['year-end', 'mid-year'].includes(discountingConvention)) {
    issues.push(issue('value_out_of_range', 'discountingConvention'));
  }
  const wacc = parseDecimal(snapshot.wacc, 'wacc', issues);
  const perpetuityGrowthRate = parseDecimal(
    snapshot.perpetuityGrowthRate,
    'perpetuityGrowthRate',
    issues,
  );
  const exitMultiple = parseDecimal(snapshot.exitMultiple, 'exitMultiple', issues);
  const exitMetric = string(snapshot.exitMetric);
  if (!['revenue', 'ebitda'].includes(exitMetric)) {
    issues.push(issue('value_out_of_range', 'exitMetric'));
  }
  const debt = parseDecimal(
    snapshot.interestBearingDebt,
    'interestBearingDebt',
    issues,
  );
  const cash = parseDecimal(
    snapshot.cashAndCashEquivalents,
    'cashAndCashEquivalents',
    issues,
  );

  if (wacc !== undefined) {
    const value = new AnalysisDecimal(wacc);
    if (!value.greaterThan(0) || value.greaterThan(1)) {
      issues.push(issue('value_out_of_range', 'wacc'));
    }
    traceInputs.push(ratioTraceInput('dcf:wacc', 'wacc', wacc, valuationDate));
  }
  if (
    wacc !== undefined &&
    perpetuityGrowthRate !== undefined &&
    !new AnalysisDecimal(wacc).greaterThan(perpetuityGrowthRate)
  ) {
    issues.push(issue('invalid_terminal_value', 'perpetuityGrowthRate'));
  }
  if (exitMultiple !== undefined && !new AnalysisDecimal(exitMultiple).greaterThan(0)) {
    issues.push(issue('value_out_of_range', 'exitMultiple'));
  }
  for (const [value, path] of [
    [debt, 'interestBearingDebt'],
    [cash, 'cashAndCashEquivalents'],
  ] as const) {
    if (value !== undefined && new AnalysisDecimal(value).isNegative()) {
      issues.push(issue('value_out_of_range', path));
    }
    if (value !== undefined) {
      traceInputs.push(traceInput(`dcf:${path}`, path, value, currency, valuationDate));
    }
  }

  const weights = record(snapshot.terminalMethodWeights);
  exactKeys(weights, ['perpetuityGrowth', 'exitMultiple']);
  const perpetuityWeight = parseDecimal(
    weights.perpetuityGrowth,
    'terminalMethodWeights.perpetuityGrowth',
    issues,
  ) ?? '0';
  const exitWeight = parseDecimal(
    weights.exitMultiple,
    'terminalMethodWeights.exitMultiple',
    issues,
  ) ?? '0';
  try {
    parseUnitIntervalString(perpetuityWeight);
    parseUnitIntervalString(exitWeight);
  } catch {
    issues.push(issue('value_out_of_range', 'terminalMethodWeights'));
  }
  if (!new AnalysisDecimal(perpetuityWeight).plus(exitWeight).equals(1)) {
    issues.push(issue('value_out_of_range', 'terminalMethodWeights'));
  }

  const sensitivity = record(snapshot.sensitivity);
  exactKeys(sensitivity, ['wacc', 'perpetuityGrowthRate', 'exitMultiple']);
  const waccAxis = validateFivePointAxis(
    sensitivity.wacc,
    'sensitivity.wacc',
    wacc,
    issues,
    (value) => value.greaterThan(0) && value.lessThanOrEqualTo(1),
  );
  const growthAxis = validateFivePointAxis(
    sensitivity.perpetuityGrowthRate,
    'sensitivity.perpetuityGrowthRate',
    perpetuityGrowthRate,
    issues,
  );
  const multipleAxis = validateFivePointAxis(
    sensitivity.exitMultiple,
    'sensitivity.exitMultiple',
    exitMultiple,
    issues,
    (value) => value.greaterThan(0),
  );
  if (
    !new AnalysisDecimal(waccAxis[0]).greaterThan(growthAxis[4])
  ) {
    issues.push(issue('invalid_sensitivity_matrix', 'sensitivity'));
  }

  const normalized = {
    ...snapshot,
    version,
    currency,
    valuationDate,
    scenarioId,
    probability,
    modelYears,
    discountingConvention,
    wacc: wacc ?? string(snapshot.wacc),
    perpetuityGrowthRate:
      perpetuityGrowthRate ?? string(snapshot.perpetuityGrowthRate),
    exitMultiple: exitMultiple ?? string(snapshot.exitMultiple),
    exitMetric,
    interestBearingDebt: debt ?? string(snapshot.interestBearingDebt),
    cashAndCashEquivalents: cash ?? string(snapshot.cashAndCashEquivalents),
    terminalMethodWeights: {
      perpetuityGrowth: perpetuityWeight,
      exitMultiple: exitWeight,
    },
    sensitivity: {
      wacc: waccAxis,
      perpetuityGrowthRate: growthAxis,
      exitMultiple: multipleAxis,
    },
  } as DcfInput;

  return issues.length > 0
    ? blocked(issues, traceInputs)
    : valid(normalized, traceInputs);
}

function validateComparablePeer(
  raw: unknown,
  index: number,
  currency: string,
  issues: EngineIssue[],
  traceInputs: TraceInput[],
): ComparablePeer {
  const value = record(raw);
  exactKeys(value, [
    'companyId',
    'enterpriseValue',
    'equityValue',
    'revenue',
    'ebitda',
    'netIncome',
  ]);
  const companyId = string(value.companyId);
  if (companyId.trim().length === 0) {
    issues.push(issue('value_out_of_range', `peers[${index}].companyId`));
  }
  const output: Record<string, string> = { companyId };
  for (const key of [
    'enterpriseValue',
    'equityValue',
    'revenue',
    'ebitda',
    'netIncome',
  ] as const) {
    const parsed = parseDecimal(value[key], `peers[${index}].${key}`, issues);
    output[key] = parsed ?? string(value[key]);
    if (parsed !== undefined) {
      traceInputs.push(traceInput(
        `comparable:${companyId.trim().toLowerCase()}:${key}`,
        key,
        parsed,
        currency,
        'valuation-date',
      ));
    }
  }
  return output as unknown as ComparablePeer;
}

export function validateComparableInput(
  input: unknown,
): ValuationInputValidation<ComparableValuationInput> {
  const snapshot = record(snapshotValuationInput(input));
  exactKeys(snapshot, [
    'version',
    'currency',
    'valuationDate',
    'subject',
    'peers',
    'adjustments',
  ]);
  const issues: EngineIssue[] = [];
  const traceInputs: TraceInput[] = [];
  const version = string(snapshot.version);
  if (version !== '1') issues.push(issue('unsupported_engine_version', 'version'));
  const currency = parseCurrency(snapshot.currency, 'currency', issues);
  const valuationDate = parseDateValue(snapshot.valuationDate, 'valuationDate', issues);

  const subject = record(snapshot.subject);
  exactKeys(subject, [
    'period',
    'revenue',
    'ebitda',
    'netIncome',
    'interestBearingDebt',
    'cashAndCashEquivalents',
  ]);
  const period = validateFlowPeriod(subject.period, 'subject.period', issues);
  const normalizedSubject: Record<string, unknown> = { period };
  for (const key of [
    'revenue',
    'ebitda',
    'netIncome',
    'interestBearingDebt',
    'cashAndCashEquivalents',
  ] as const) {
    const parsed = parseDecimal(subject[key], `subject.${key}`, issues);
    normalizedSubject[key] = parsed ?? string(subject[key]);
    if (parsed !== undefined) {
      traceInputs.push(traceInput(
        `comparable:subject:${key}`,
        key,
        parsed,
        currency,
        period.id,
      ));
    }
  }

  const peers = array(snapshot.peers).map((peer, index) =>
    validateComparablePeer(peer, index, currency, issues, traceInputs),
  );
  const seen = new Set<string>();
  peers.forEach((peer, index) => {
    const normalizedId = peer.companyId.trim().toLowerCase();
    if (seen.has(normalizedId)) {
      issues.push(issue('value_out_of_range', `peers[${index}].companyId`));
    }
    seen.add(normalizedId);
  });

  const adjustments = record(snapshot.adjustments);
  exactKeys(adjustments, ['growth', 'profitability', 'size', 'liquidity']);
  const normalizedAdjustments: Record<string, string> = {};
  for (const key of ['growth', 'profitability', 'size', 'liquidity'] as const) {
    const parsed = parseDecimal(adjustments[key], `adjustments.${key}`, issues);
    normalizedAdjustments[key] = parsed ?? string(adjustments[key]);
    if (parsed !== undefined) {
      traceInputs.push(ratioTraceInput(
        `comparable:adjustment:${key}`,
        key,
        parsed,
        valuationDate,
      ));
    }
  }

  const normalized = {
    version,
    currency,
    valuationDate,
    subject: normalizedSubject,
    peers,
    adjustments: normalizedAdjustments,
  } as unknown as ComparableValuationInput;
  return issues.length > 0
    ? blocked(issues, traceInputs)
    : valid(normalized, traceInputs);
}

export function validateVcInput(
  input: unknown,
): ValuationInputValidation<VcMethodInput> {
  const snapshot = record(snapshotValuationInput(input));
  exactKeys(
    snapshot,
    [
      'version',
      'currency',
      'valuationDate',
      'exitEquityValue',
      'targetOwnership',
      'expectedDilution',
      'holdingYears',
      'sensitivity',
    ],
    ['targetIrr', 'targetMoic'],
  );
  const issues: EngineIssue[] = [];
  const traceInputs: TraceInput[] = [];
  const version = string(snapshot.version);
  if (version !== '1') issues.push(issue('unsupported_engine_version', 'version'));
  const currency = parseCurrency(snapshot.currency, 'currency', issues);
  const valuationDate = parseDateValue(snapshot.valuationDate, 'valuationDate', issues);
  const exitEquityValue = validateRange(
    snapshot.exitEquityValue,
    'exitEquityValue',
    issues,
    true,
  );
  const targetOwnership = parseDecimal(
    snapshot.targetOwnership,
    'targetOwnership',
    issues,
  ) ?? '0';
  const expectedDilution = parseDecimal(
    snapshot.expectedDilution,
    'expectedDilution',
    issues,
  ) ?? '0';
  const holdingYears = parseDecimal(
    snapshot.holdingYears,
    'holdingYears',
    issues,
  ) ?? '0';
  const targetIrrRaw = optionalString(snapshot.targetIrr);
  const targetMoicRaw = optionalString(snapshot.targetMoic);
  if (targetIrrRaw === undefined && targetMoicRaw === undefined) {
    issues.push(issue('missing_input', 'targetIrr'));
  }
  const targetIrr = targetIrrRaw === undefined
    ? undefined
    : parseDecimal(targetIrrRaw, 'targetIrr', issues);
  const targetMoic = targetMoicRaw === undefined
    ? undefined
    : parseDecimal(targetMoicRaw, 'targetMoic', issues);

  try {
    const ownership = parseUnitIntervalString(targetOwnership);
    if (!ownership.greaterThan(0)) throw new Error('ownership');
  } catch {
    issues.push(issue('value_out_of_range', 'targetOwnership'));
  }
  try {
    parseUnitIntervalString(expectedDilution);
  } catch {
    issues.push(issue('value_out_of_range', 'expectedDilution'));
  }
  if (!new AnalysisDecimal(holdingYears).greaterThan(0)) {
    issues.push(issue('value_out_of_range', 'holdingYears'));
  }
  if (targetIrr !== undefined) {
    try {
      parseReturnRateString(targetIrr);
    } catch {
      issues.push(issue('value_out_of_range', 'targetIrr'));
    }
  }
  if (targetMoic !== undefined && !new AnalysisDecimal(targetMoic).greaterThan(0)) {
    issues.push(issue('value_out_of_range', 'targetMoic'));
  }

  let derivedMoic: DecimalString | undefined;
  let derivedIrr: DecimalString | undefined;
  if (targetIrr !== undefined) {
    derivedMoic = canonicalDecimal(
      AnalysisDecimal.pow(
        new AnalysisDecimal(1).plus(targetIrr),
        holdingYears,
      ),
    );
  }
  if (targetMoic !== undefined) {
    derivedIrr = canonicalDecimal(
      AnalysisDecimal.pow(
        targetMoic,
        new AnalysisDecimal(1).dividedBy(holdingYears),
      ).minus(1),
    );
  }
  if (
    targetMoic !== undefined &&
    derivedMoic !== undefined &&
    new AnalysisDecimal(targetMoic).minus(derivedMoic).abs().greaterThan('0.000000000001')
  ) {
    issues.push(issue('inconsistent_target_return', 'targetMoic'));
  }

  const baseIrr = targetIrr ?? derivedIrr;
  const sensitivity = record(snapshot.sensitivity);
  exactKeys(sensitivity, ['exitEquityValue', 'targetIrr']);
  const exitAxis = validateFivePointAxis(
    sensitivity.exitEquityValue,
    'sensitivity.exitEquityValue',
    exitEquityValue.midpoint,
    issues,
    (value) => value.greaterThan(0),
  );
  const irrAxis = validateFivePointAxis(
    sensitivity.targetIrr,
    'sensitivity.targetIrr',
    baseIrr,
    issues,
    (value) => value.greaterThan(-1),
  );

  for (const [key, value] of Object.entries(exitEquityValue)) {
    traceInputs.push(traceInput(
      `vc:exit-equity:${key}`,
      'exit_equity_value',
      value,
      currency,
      valuationDate,
    ));
  }
  traceInputs.push(ratioTraceInput(
    'vc:target-ownership',
    'target_ownership',
    targetOwnership,
    valuationDate,
    'unit-interval',
  ));

  const normalized = {
    version,
    currency,
    valuationDate,
    exitEquityValue,
    targetOwnership,
    expectedDilution,
    holdingYears,
    ...(targetIrr === undefined ? {} : { targetIrr }),
    ...(targetMoic === undefined ? {} : { targetMoic }),
    sensitivity: {
      exitEquityValue: exitAxis,
      targetIrr: irrAxis,
    },
  } as VcMethodInput;
  return issues.length > 0
    ? blocked(issues, traceInputs)
    : valid(normalized, traceInputs);
}

function validateValuationRange(
  raw: unknown,
  path: string,
  issues: EngineIssue[],
): ValuationRange {
  const value = record(raw);
  exactKeys(value, [
    'low',
    'midpoint',
    'high',
    'currency',
    'valuationDate',
    'basis',
  ]);
  const range = validateRange(value, path, issues, false, false);
  const currency = parseCurrency(value.currency, `${path}.currency`, issues);
  const valuationDate = parseDateValue(
    value.valuationDate,
    `${path}.valuationDate`,
    issues,
  );
  const basis = string(value.basis);
  if (basis !== 'pre-money-equity') {
    issues.push(issue('invalid_valuation_basis', `${path}.basis`));
  }
  return {
    ...range,
    currency,
    valuationDate,
    basis: 'pre-money-equity',
  };
}

function validateWeightedMethod(
  raw: unknown,
  index: number,
  issues: EngineIssue[],
  traceInputs: TraceInput[],
): WeightedValuationMethod {
  const value = record(raw);
  exactKeys(value, ['methodId', 'label', 'weight', 'range'], ['sensitivityMatrices']);
  const methodId = string(value.methodId);
  if (!methodIds.includes(methodId as typeof methodIds[number])) {
    issues.push(issue('value_out_of_range', `methods[${index}].methodId`));
  }
  const label = string(value.label);
  if (label.length === 0) issues.push(issue('value_out_of_range', `methods[${index}].label`));
  const weight = parseDecimal(value.weight, `methods[${index}].weight`, issues) ?? '0';
  try {
    const parsed = parseUnitIntervalString(weight);
    if (!parsed.greaterThan(0)) throw new Error('weight');
  } catch {
    issues.push(issue('value_out_of_range', `methods[${index}].weight`));
  }
  const range = validateValuationRange(value.range, `methods[${index}].range`, issues);
  const sensitivityMatrices = value.sensitivityMatrices === undefined
    ? undefined
    : array(value.sensitivityMatrices) as WeightedValuationMethod['sensitivityMatrices'];

  traceInputs.push(ratioTraceInput(
    `triangulation:${methodId}:weight`,
    'valuation_weight',
    weight,
    range.valuationDate,
    'unit-interval',
  ));
  return {
    methodId: methodId as WeightedValuationMethod['methodId'],
    label,
    weight,
    range,
    ...(sensitivityMatrices === undefined ? {} : { sensitivityMatrices }),
  };
}

export function validateTriangulationInput(
  input: unknown,
): ValuationInputValidation<ValuationTriangulationInput> {
  const snapshot = record(snapshotValuationInput(input));
  exactKeys(snapshot, ['version', 'methods']);
  const issues: EngineIssue[] = [];
  const traceInputs: TraceInput[] = [];
  const version = string(snapshot.version);
  if (version !== '1') issues.push(issue('unsupported_engine_version', 'version'));
  const methods = array(snapshot.methods).map((method, index) =>
    validateWeightedMethod(method, index, issues, traceInputs),
  );
  if (methods.length < 2) {
    issues.push(issue('missing_input', 'methods'));
  }

  const seen = new Set<string>();
  let totalWeight = new AnalysisDecimal(0);
  const first = methods[0];
  methods.forEach((method, index) => {
    if (seen.has(method.methodId)) {
      issues.push(issue('value_out_of_range', `methods[${index}].methodId`));
    }
    seen.add(method.methodId);
    totalWeight = totalWeight.plus(method.weight);
    if (first !== undefined) {
      if (method.range.currency !== first.range.currency) {
        issues.push(issue('currency_mismatch', `methods[${index}].range.currency`));
      }
      if (method.range.valuationDate !== first.range.valuationDate) {
        issues.push(issue('period_mismatch', `methods[${index}].range.valuationDate`));
      }
      if (method.range.basis !== first.range.basis) {
        issues.push(issue('invalid_valuation_basis', `methods[${index}].range.basis`));
      }
    }
  });
  if (!totalWeight.equals(1)) issues.push(issue('value_out_of_range', 'methods'));

  const normalized = { version, methods } as ValuationTriangulationInput;
  return issues.length > 0
    ? blocked(issues, traceInputs, methods.length < 2 ? 'insufficient-data' : 'invalid-input')
    : valid(normalized, traceInputs);
}
