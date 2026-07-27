import type { TraceInput } from '../../domain/analysis/calculation-trace';
import {
  AnalysisDecimal,
  canonicalDecimal,
  parseDecimalString,
} from '../../domain/analysis/decimal';
import type { EngineIssue } from '../../domain/analysis/engine-result';
import { DomainContractError } from '../../domain/analysis/value';
import { snapshotEquityInput } from './snapshot-equity-input';
import type {
  CapTableModelInput,
  CapTablePosition,
  InvestorReturnInput,
  InvestmentLedgerEntry,
  LiquidationPreference,
  LiquidationWaterfallInput,
  PricedRoundEvent,
  SecurityPosition,
} from './equity-types';

type Reason = 'insufficient-data' | 'invalid-input' | 'not-meaningful';
export type EquityValidation<T> =
  | { readonly status: 'valid'; readonly input: T; readonly warnings: readonly EngineIssue[]; readonly traceInputs: readonly TraceInput[] }
  | { readonly status: 'blocked'; readonly reason: Reason; readonly issues: readonly EngineIssue[]; readonly traceInputs: readonly TraceInput[] };

const currencyPattern = /^[A-Z]{3}$/;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function invalidDto(): never { throw new DomainContractError('invalid_dto'); }
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : invalidDto();
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : invalidDto(); }
function string(value: unknown): string { return typeof value === 'string' ? value : invalidDto(); }
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) invalidDto();
}
function issue(code: EngineIssue['code'], path: string, details: EngineIssue['details'] = {}): EngineIssue {
  return { code, path, message: `${code} at ${path}`, details };
}
function decimal(raw: unknown, path: string, issues: EngineIssue[]): string {
  const value = string(raw);
  try { return canonicalDecimal(parseDecimalString(value)); }
  catch { issues.push(issue('invalid_decimal', path)); return value; }
}
function date(raw: unknown, path: string, issues: EngineIssue[]): string {
  const value = string(raw);
  if (dateValue(value) === undefined) issues.push(issue('value_out_of_range', path));
  return value;
}
function dateValue(value: string): Date | undefined {
  const match = datePattern.exec(value); if (match === null) return undefined;
  const result = new Date(0); result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return result.getUTCFullYear() === Number(match[1]) &&
    result.getUTCMonth() === Number(match[2]) - 1 &&
    result.getUTCDate() === Number(match[3]) ? result : undefined;
}
function traceInput(valueRef: string, metricId: string, value: string, currency: string, periodId: string): TraceInput {
  return { valueRef, metricId, value, unit: { kind: 'currency', currency }, periodId, sourceRefs: [] };
}
function finish<T>(input: T, issues: EngineIssue[], traces: TraceInput[], reason: Reason = 'invalid-input'): EquityValidation<T> {
  const traceInputs = [...traces].sort((a, b) => a.valueRef.localeCompare(b.valueRef));
  return issues.length === 0
    ? { status: 'valid', input, warnings: [], traceInputs }
    : { status: 'blocked', reason, issues: [...issues].sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)), traceInputs };
}

function preference(raw: unknown, path: string, issues: EngineIssue[]): LiquidationPreference {
  const value = record(raw);
  exact(value, ['participation', 'multiple', 'seniorityRank'], ['capMultiple']);
  const participation = string(value.participation);
  if (participation !== 'participating' && participation !== 'non-participating') issues.push(issue('invalid_liquidation_preference', `${path}.participation`));
  const multiple = decimal(value.multiple, `${path}.multiple`, issues);
  if (!new AnalysisDecimal(multiple).greaterThan(0)) issues.push(issue('invalid_liquidation_preference', `${path}.multiple`));
  const seniorityRank = value.seniorityRank;
  if (typeof seniorityRank !== 'number') invalidDto();
  if (!Number.isInteger(seniorityRank) || seniorityRank < 0) issues.push(issue('invalid_liquidation_preference', `${path}.seniorityRank`));
  const capRaw = value.capMultiple;
  const capMultiple = capRaw === undefined ? undefined : decimal(capRaw, `${path}.capMultiple`, issues);
  if (capMultiple !== undefined && (!new AnalysisDecimal(capMultiple).greaterThan(0) || new AnalysisDecimal(capMultiple).lessThan(multiple))) {
    issues.push(issue('invalid_liquidation_preference', `${path}.capMultiple`));
  }
  return {
    participation: participation as LiquidationPreference['participation'],
    multiple,
    seniorityRank,
    ...(capMultiple === undefined ? {} : { capMultiple }),
  };
}

function position(raw: unknown, path: string, issues: EngineIssue[], withOwnership: boolean): SecurityPosition | CapTablePosition {
  const value = record(raw);
  exact(value, [
    'securityId', 'holderId', 'securityType', 'shares', 'investedCapital', 'acquisitionDate',
    ...(withOwnership ? ['ownership'] : []),
  ], ['liquidationPreference']);
  const securityId = string(value.securityId);
  const holderId = string(value.holderId);
  if (securityId.trim().length === 0) issues.push(issue('invalid_cap_table', `${path}.securityId`));
  if (holderId.trim().length === 0) issues.push(issue('invalid_cap_table', `${path}.holderId`));
  const securityType = string(value.securityType);
  if (!['common', 'preferred', 'esop'].includes(securityType)) issues.push(issue('invalid_cap_table', `${path}.securityType`));
  const shares = decimal(value.shares, `${path}.shares`, issues);
  const investedCapital = decimal(value.investedCapital, `${path}.investedCapital`, issues);
  if (new AnalysisDecimal(shares).isNegative()) issues.push(issue('value_out_of_range', `${path}.shares`));
  if (new AnalysisDecimal(investedCapital).isNegative()) issues.push(issue('value_out_of_range', `${path}.investedCapital`));
  const acquisitionDate = date(value.acquisitionDate, `${path}.acquisitionDate`, issues);
  const pref = value.liquidationPreference === undefined ? undefined : preference(value.liquidationPreference, `${path}.liquidationPreference`, issues);
  if (securityType === 'preferred' && pref === undefined) issues.push(issue('invalid_liquidation_preference', `${path}.liquidationPreference`));
  if (securityType !== 'preferred' && pref !== undefined) issues.push(issue('invalid_liquidation_preference', `${path}.liquidationPreference`));
  const base: SecurityPosition = {
    securityId, holderId, securityType: securityType as SecurityPosition['securityType'],
    shares, investedCapital, acquisitionDate, ...(pref === undefined ? {} : { liquidationPreference: pref }),
  };
  if (!withOwnership) return base;
  const ownership = decimal(value.ownership, `${path}.ownership`, issues);
  if (new AnalysisDecimal(ownership).isNegative() || new AnalysisDecimal(ownership).greaterThan(1)) issues.push(issue('value_out_of_range', `${path}.ownership`));
  return { ...base, ownership };
}

function validatePositions(raw: unknown, path: string, issues: EngineIssue[], withOwnership: boolean): readonly (SecurityPosition | CapTablePosition)[] {
  const values = array(raw).map((item, index) => position(item, `${path}[${index}]`, issues, withOwnership));
  const seen = new Set<string>();
  values.forEach((item, index) => {
    const id = item.securityId.trim().toLowerCase();
    if (seen.has(id)) issues.push(issue('invalid_cap_table', `${path}[${index}].securityId`));
    seen.add(id);
  });
  return values;
}

function event(raw: unknown, index: number, issues: EngineIssue[]): PricedRoundEvent {
  const path = `events[${index}]`; const value = record(raw);
  exact(value, ['kind', 'eventId', 'date', 'investorHolderId', 'securityId', 'securityType', 'preMoneyEquityValue', 'investmentAmount'], ['postMoneyEquityValue', 'liquidationPreference', 'esopPoolExpansion']);
  if (string(value.kind) !== 'priced-round') issues.push(issue('invalid_equity_event', `${path}.kind`));
  const eventId = string(value.eventId); const eventDate = date(value.date, `${path}.date`, issues);
  const investorHolderId = string(value.investorHolderId); const securityId = string(value.securityId);
  const securityType = string(value.securityType);
  if (securityType !== 'common' && securityType !== 'preferred') issues.push(issue('invalid_equity_event', `${path}.securityType`));
  const preMoneyEquityValue = decimal(value.preMoneyEquityValue, `${path}.preMoneyEquityValue`, issues);
  const investmentAmount = decimal(value.investmentAmount, `${path}.investmentAmount`, issues);
  if (!new AnalysisDecimal(preMoneyEquityValue).greaterThan(0)) issues.push(issue('value_out_of_range', `${path}.preMoneyEquityValue`));
  if (!new AnalysisDecimal(investmentAmount).greaterThan(0)) issues.push(issue('value_out_of_range', `${path}.investmentAmount`));
  const post = value.postMoneyEquityValue === undefined ? undefined : decimal(value.postMoneyEquityValue, `${path}.postMoneyEquityValue`, issues);
  if (post !== undefined && !new AnalysisDecimal(post).equals(new AnalysisDecimal(preMoneyEquityValue).plus(investmentAmount))) issues.push(issue('invalid_equity_event', `${path}.postMoneyEquityValue`));
  const pref = value.liquidationPreference === undefined ? undefined : preference(value.liquidationPreference, `${path}.liquidationPreference`, issues);
  if (securityType === 'preferred' && pref === undefined) issues.push(issue('invalid_liquidation_preference', `${path}.liquidationPreference`));
  if (securityType === 'common' && pref !== undefined) issues.push(issue('invalid_liquidation_preference', `${path}.liquidationPreference`));
  let esopPoolExpansion: PricedRoundEvent['esopPoolExpansion'];
  if (value.esopPoolExpansion !== undefined) {
    const pool = record(value.esopPoolExpansion); exact(pool, ['securityId', 'holderId', 'timing', 'targetOwnership']);
    const timing = string(pool.timing); if (timing !== 'pre-money' && timing !== 'post-money') issues.push(issue('invalid_equity_event', `${path}.esopPoolExpansion.timing`));
    const targetOwnership = decimal(pool.targetOwnership, `${path}.esopPoolExpansion.targetOwnership`, issues);
    if (!new AnalysisDecimal(targetOwnership).greaterThan(0) || !new AnalysisDecimal(targetOwnership).lessThan(1)) issues.push(issue('value_out_of_range', `${path}.esopPoolExpansion.targetOwnership`));
    esopPoolExpansion = { securityId: string(pool.securityId), holderId: string(pool.holderId), timing: timing as 'pre-money' | 'post-money', targetOwnership };
  }
  return { kind: 'priced-round', eventId, date: eventDate, investorHolderId, securityId, securityType: securityType as 'common' | 'preferred', preMoneyEquityValue, investmentAmount, ...(post === undefined ? {} : { postMoneyEquityValue: post }), ...(pref === undefined ? {} : { liquidationPreference: pref }), ...(esopPoolExpansion === undefined ? {} : { esopPoolExpansion }) };
}

export function validateCapTableInput(input: unknown): EquityValidation<CapTableModelInput> {
  const value = record(snapshotEquityInput(input)); exact(value, ['version', 'currency', 'asOfDate', 'initialPositions', 'events']);
  const issues: EngineIssue[] = []; const traces: TraceInput[] = [];
  const version = string(value.version); if (version !== '1') issues.push(issue('unsupported_engine_version', 'version'));
  const currency = string(value.currency); if (!currencyPattern.test(currency)) issues.push(issue('value_out_of_range', 'currency'));
  const asOfDate = date(value.asOfDate, 'asOfDate', issues);
  const initialPositions = validatePositions(value.initialPositions, 'initialPositions', issues, false) as readonly SecurityPosition[];
  const total = initialPositions.reduce((sum, item) => sum.plus(item.shares), new AnalysisDecimal(0));
  if (!total.greaterThan(0)) issues.push(issue('invalid_cap_table', 'initialPositions'));
  initialPositions.forEach((item) => traces.push(traceInput(`equity:initial:${item.securityId}:shares`, 'shares', item.shares, currency, asOfDate)));
  const events = array(value.events).map((item, index) => event(item, index, issues));
  const ids = new Set<string>(); let previous = dateValue(asOfDate);
  events.forEach((item, index) => {
    if (ids.has(item.eventId)) issues.push(issue('invalid_equity_event', `events[${index}].eventId`)); ids.add(item.eventId);
    const current = dateValue(item.date); if (current !== undefined && previous !== undefined && current < previous) issues.push(issue('period_mismatch', `events[${index}].date`)); if (current !== undefined) previous = current;
  });
  return finish({ version: '1', currency, asOfDate, initialPositions, events }, issues, traces);
}

export function validateWaterfallInput(input: unknown): EquityValidation<LiquidationWaterfallInput> {
  const value = record(snapshotEquityInput(input)); exact(value, ['version', 'currency', 'asOfDate', 'exitDate', 'exitValue', 'positions']);
  const issues: EngineIssue[] = []; const traces: TraceInput[] = [];
  const version = string(value.version); if (version !== '1') issues.push(issue('unsupported_engine_version', 'version'));
  const currency = string(value.currency); if (!currencyPattern.test(currency)) issues.push(issue('value_out_of_range', 'currency'));
  const asOfDate = date(value.asOfDate, 'asOfDate', issues); const exitDate = date(value.exitDate, 'exitDate', issues);
  if ((dateValue(exitDate)?.getTime() ?? 0) < (dateValue(asOfDate)?.getTime() ?? 0)) issues.push(issue('period_mismatch', 'exitDate'));
  const exitValue = decimal(value.exitValue, 'exitValue', issues); if (new AnalysisDecimal(exitValue).isNegative()) issues.push(issue('value_out_of_range', 'exitValue'));
  const positions = validatePositions(value.positions, 'positions', issues, true) as readonly CapTablePosition[];
  const nonParticipating = positions.filter((item) => item.liquidationPreference?.participation === 'non-participating').length;
  if (nonParticipating > 12) issues.push(issue('invalid_conversion_equilibrium', 'positions'));
  traces.push(traceInput('equity:exit-value', 'exit_value', exitValue, currency, exitDate));
  return finish({ version: '1', currency, asOfDate, exitDate, exitValue, positions }, issues, traces);
}

function investment(raw: unknown, index: number, issues: EngineIssue[]): InvestmentLedgerEntry {
  const path = `capTable.investments[${index}]`; const value = record(raw);
  exact(value, ['holderId', 'securityId', 'eventId', 'date', 'amount']);
  const amount = decimal(value.amount, `${path}.amount`, issues); if (!new AnalysisDecimal(amount).greaterThan(0)) issues.push(issue('value_out_of_range', `${path}.amount`));
  return { holderId: string(value.holderId), securityId: string(value.securityId), eventId: string(value.eventId), date: date(value.date, `${path}.date`, issues), amount };
}

export function validateInvestorReturnInput(input: unknown): EquityValidation<InvestorReturnInput> {
  const value = record(snapshotEquityInput(input)); exact(value, ['version', 'currency', 'holderId', 'capTable', 'scenarios']);
  const issues: EngineIssue[] = []; const traces: TraceInput[] = [];
  const version = string(value.version); if (version !== '1') issues.push(issue('unsupported_engine_version', 'version'));
  const currency = string(value.currency); if (!currencyPattern.test(currency)) issues.push(issue('value_out_of_range', 'currency'));
  const holderId = string(value.holderId);
  const cap = record(value.capTable); exact(cap, ['asOfDate', 'positions', 'investments']);
  const asOfDate = date(cap.asOfDate, 'capTable.asOfDate', issues);
  const positions = validatePositions(cap.positions, 'capTable.positions', issues, true) as readonly CapTablePosition[];
  const investments = array(cap.investments).map((item, index) => investment(item, index, issues));
  if (!positions.some((item) => item.holderId === holderId) || !investments.some((item) => item.holderId === holderId)) issues.push(issue('missing_input', 'holderId'));
  const scenarios = array(value.scenarios).map((raw, index) => {
    const path = `scenarios[${index}]`; const scenario = record(raw); exact(scenario, ['id', 'probability', 'exitDate', 'exitValue']);
    const id = string(scenario.id); if (!['downside', 'base', 'upside'].includes(id)) issues.push(issue('invalid_scenario_set', `${path}.id`));
    const probability = decimal(scenario.probability, `${path}.probability`, issues);
    if (new AnalysisDecimal(probability).isNegative() || new AnalysisDecimal(probability).greaterThan(1)) issues.push(issue('value_out_of_range', `${path}.probability`));
    const exitDate = date(scenario.exitDate, `${path}.exitDate`, issues); if ((dateValue(exitDate)?.getTime() ?? 0) < (dateValue(asOfDate)?.getTime() ?? 0)) issues.push(issue('period_mismatch', `${path}.exitDate`));
    const exitValue = decimal(scenario.exitValue, `${path}.exitValue`, issues); if (new AnalysisDecimal(exitValue).isNegative()) issues.push(issue('value_out_of_range', `${path}.exitValue`));
    return { id: id as 'downside' | 'base' | 'upside', probability, exitDate, exitValue };
  });
  const scenarioIds = scenarios.map((item) => item.id).sort();
  if (scenarioIds.join(',') !== 'base,downside,upside') issues.push(issue('invalid_scenario_set', 'scenarios'));
  const probabilitySum = scenarios.reduce((sum, item) => sum.plus(item.probability), new AnalysisDecimal(0));
  if (!probabilitySum.equals(1)) issues.push(issue('probability_sum_mismatch', 'scenarios'));
  return finish({ version: '1', currency, holderId, capTable: { asOfDate, positions, investments }, scenarios }, issues, traces);
}
