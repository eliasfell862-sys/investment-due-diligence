import {
  AnalysisDecimal,
  canonicalDecimal,
  parseDecimalString,
  parseUnitIntervalString,
} from '../../domain/analysis/decimal';
import type { EngineIssue } from '../../domain/analysis/engine-result';
import type { TraceInput } from '../../domain/analysis/calculation-trace';
import { DomainContractError } from '../../domain/analysis/value';
import { compareUnicodeCodePoints } from './compare-risk-strings';
import { snapshotRiskInput } from './snapshot-risk-input';
import type {
  FatalFlawCheckInput,
  RiskAssessmentInput,
  RiskCategory,
  RiskItemInput,
  RiskSignal,
  RiskUpstreamSnapshots,
  TrafficLightThresholdInput,
} from './risk-types';

export type RiskInputValidation =
  | {
      readonly status: 'valid';
      readonly input: RiskAssessmentInput;
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

const CATEGORIES: readonly RiskCategory[] = [
  'market',
  'technology',
  'customer',
  'financial',
  'financing',
  'legal_compliance',
  'governance',
  'data_authenticity',
  'exit',
] as const;

const FATAL_FLAW_IDS = [
  'material_data_or_business_fraud',
  'core_ownership_or_license_unclear',
  'irremediable_major_illegality',
  'business_model_unverifiable',
  'pre_close_cash_break',
  'founder_integrity_failure',
] as const;

const SIGNAL_CATEGORY_MAP: Readonly<Record<RiskSignal, RiskCategory>> = {
  market_adoption: 'market',
  valuation_overhang: 'market',
  technical_feasibility: 'technology',
  ip_ownership: 'technology',
  customer_concentration: 'customer',
  revenue_quality: 'customer',
  cash_runway: 'financial',
  reporting_quality: 'financial',
  financing_dependency: 'financing',
  regulatory_approval: 'legal_compliance',
  key_person: 'governance',
  governance_control: 'governance',
  data_integrity: 'data_authenticity',
  exit_delay: 'exit',
};

function invalidDto(): never {
  throw new DomainContractError('invalid_dto');
}

function record(value: unknown): RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : invalidDto();
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalidDto();
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : invalidDto();
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

function allowedKeys(value: RecordValue, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) return invalidDto();
  }
}

function issue(
  code: EngineIssue['code'],
  path: string,
): EngineIssue {
  return { code, path, message: `${path}: ${code}`, details: {} };
}

interface Context {
  readonly issues: EngineIssue[];
  readonly warnings: EngineIssue[];
  readonly riskIds: Set<string>;
  readonly evidenceRefs: Set<string>;
  readonly traceInputs: TraceInput[];
}

function addIssue(context: Context, code: EngineIssue['code'], path: string): void {
  context.issues.push(issue(code, path));
}

function parseRiskItem(value: unknown, path: string, context: Context): RiskItemInput | null {
  const input = record(value);
  const requiredKeys = ['riskId', 'category', 'title', 'probability', 'impact', 'mitigationEffectiveness'];
  const optionalKeys = ['mitigationDescription', 'signals', 'evidenceRefs'];
  const allAllowed = [...requiredKeys, ...optionalKeys];
  allowedKeys(input, allAllowed);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(input, key)) return invalidDto();
  }

  const riskId = str(input.riskId);
  if (riskId.length === 0 || riskId.length > 256 || context.riskIds.has(riskId)) {
    addIssue(context, 'invalid_risk_item', `${path}.riskId`);
    return null;
  }
  context.riskIds.add(riskId);

  const category = str(input.category) as RiskCategory;
  if (!CATEGORIES.includes(category)) {
    addIssue(context, 'invalid_risk_item', `${path}.category`);
    return null;
  }

  const title = str(input.title);
  if (title.length === 0 || title.length > 2048) {
    addIssue(context, 'invalid_risk_item', `${path}.title`);
    return null;
  }

  let probability: string;
  let impact: string;
  let mitigationEffectiveness: string;
  try {
    const prob = parseUnitIntervalString(str(input.probability));
    probability = canonicalDecimal(prob);
  } catch {
    addIssue(context, 'invalid_risk_item', `${path}.probability`);
    return null;
  }
  try {
    const imp = parseUnitIntervalString(str(input.impact));
    impact = canonicalDecimal(imp);
  } catch {
    addIssue(context, 'invalid_risk_item', `${path}.impact`);
    return null;
  }
  try {
    const mit = parseUnitIntervalString(str(input.mitigationEffectiveness));
    mitigationEffectiveness = canonicalDecimal(mit);
  } catch {
    addIssue(context, 'invalid_risk_item', `${path}.mitigationEffectiveness`);
    return null;
  }

  const mitigationDescription = !Object.hasOwn(input, 'mitigationDescription') || input.mitigationDescription === null
    ? undefined
    : str(input.mitigationDescription);
  const mitigationEff = new AnalysisDecimal(mitigationEffectiveness);
  if (mitigationEff.greaterThan(0) && (mitigationDescription === undefined || mitigationDescription.length === 0)) {
    addIssue(context, 'invalid_risk_item', `${path}.mitigationDescription`);
    return null;
  }

  const rawSignals = Object.hasOwn(input, 'signals') ? arr(input.signals) : [];
  const signals: RiskSignal[] = [];
  const signalSet = new Set<string>();
  for (let sIdx = 0; sIdx < rawSignals.length; sIdx += 1) {
    const signal = str(rawSignals[sIdx]) as RiskSignal;
    if (!(signal in SIGNAL_CATEGORY_MAP)) {
      addIssue(context, 'invalid_risk_item', `${path}.signals.${sIdx}`);
      return null;
    }
    if (SIGNAL_CATEGORY_MAP[signal] !== category) {
      addIssue(context, 'invalid_risk_item', `${path}.signals.${sIdx}`);
      return null;
    }
    if (signalSet.has(signal)) {
      addIssue(context, 'invalid_risk_item', `${path}.signals.${sIdx}`);
      return null;
    }
    signalSet.add(signal);
    signals.push(signal);
  }

  const rawRefs = Object.hasOwn(input, 'evidenceRefs') ? arr(input.evidenceRefs) : [];
  const evidenceRefs: string[] = [];
  const refSet = new Set<string>();
  for (let eIdx = 0; eIdx < rawRefs.length; eIdx += 1) {
    const ref = str(rawRefs[eIdx]);
    if (ref.length === 0 || refSet.has(ref)) {
      addIssue(context, 'invalid_risk_item', `${path}.evidenceRefs.${eIdx}`);
      return null;
    }
    refSet.add(ref);
    evidenceRefs.push(ref);
    context.evidenceRefs.add(ref);
  }

  return {
    riskId,
    category,
    title,
    probability,
    impact,
    mitigationEffectiveness,
    mitigationDescription,
    signals,
    evidenceRefs,
  };
}

function parseFatalFlaw(value: unknown, path: string, context: Context): FatalFlawCheckInput | null {
  const input = record(value);

  const statusValue = str(input.status);
  if (!['unassessed', 'clear', 'open', 'covered', 'resolved'].includes(statusValue)) {
    addIssue(context, 'invalid_fatal_flaw', `${path}.status`);
    return null;
  }

  const requiredKeys = ['fatalFlawId', 'status', 'evidenceRefs'];
  const optionalKeys = ['coverageReason', 'bindingConditions', 'resolutionNote'];
  const allAllowed = [...requiredKeys, ...optionalKeys];
  allowedKeys(input, allAllowed);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(input, key)) return invalidDto();
  }

  const fatalFlawId = str(input.fatalFlawId);
  if (!(FATAL_FLAW_IDS as readonly string[]).includes(fatalFlawId)) {
    addIssue(context, 'invalid_fatal_flaw', `${path}.fatalFlawId`);
    return null;
  }

  const rawRefs = arr(input.evidenceRefs);
  const evidenceRefs: string[] = [];
  for (let eIdx = 0; eIdx < rawRefs.length; eIdx += 1) {
    const ref = str(rawRefs[eIdx]);
    if (ref.length === 0) {
      addIssue(context, 'invalid_fatal_flaw', `${path}.evidenceRefs.${eIdx}`);
      return null;
    }
    evidenceRefs.push(ref);
    context.evidenceRefs.add(ref);
  }

  let coverageReason: string | undefined;
  let bindingConditions: string[] | undefined;
  let resolutionNote: string | undefined;

  if (statusValue === 'covered') {
    coverageReason = str(input.coverageReason);
    if (coverageReason.length === 0) {
      addIssue(context, 'invalid_fatal_flaw', `${path}.coverageReason`);
      return null;
    }
    const conditions = arr(input.bindingConditions);
    bindingConditions = [];
    for (let cIdx = 0; cIdx < conditions.length; cIdx += 1) {
      const cond = str(conditions[cIdx]);
      if (cond.length === 0) {
        addIssue(context, 'invalid_fatal_flaw', `${path}.bindingConditions.${cIdx}`);
        return null;
      }
      bindingConditions.push(cond);
    }
    if (bindingConditions.length === 0) {
      addIssue(context, 'invalid_fatal_flaw', `${path}.bindingConditions`);
      return null;
    }
  }

  if (statusValue === 'resolved') {
    resolutionNote = str(input.resolutionNote);
    if (resolutionNote.length === 0) {
      addIssue(context, 'invalid_fatal_flaw', `${path}.resolutionNote`);
      return null;
    }
  }

  return {
    fatalFlawId: fatalFlawId as FatalFlawCheckInput['fatalFlawId'],
    status: statusValue as FatalFlawCheckInput['status'],
    evidenceRefs,
    ...(coverageReason !== undefined ? { coverageReason } : {}),
    ...(bindingConditions !== undefined ? { bindingConditions } : {}),
    ...(resolutionNote !== undefined ? { resolutionNote } : {}),
  };
}

function parseTrafficLightThresholds(
  value: unknown,
  path: string,
  context: Context,
): TrafficLightThresholdInput | null {
  const input = record(value);
  exactKeys(input, ['greenUpper', 'redLower', 'changeReason']);

  let greenUpper: string;
  let redLower: string;
  try {
    const gu = parseUnitIntervalString(str(input.greenUpper));
    greenUpper = canonicalDecimal(gu);
  } catch {
    addIssue(context, 'invalid_risk_threshold', `${path}.greenUpper`);
    return null;
  }
  try {
    const rl = parseUnitIntervalString(str(input.redLower));
    redLower = canonicalDecimal(rl);
  } catch {
    addIssue(context, 'invalid_risk_threshold', `${path}.redLower`);
    return null;
  }

  const guDec = new AnalysisDecimal(greenUpper);
  const rlDec = new AnalysisDecimal(redLower);
  if (guDec.greaterThanOrEqualTo(rlDec)) {
    addIssue(context, 'invalid_risk_threshold', path);
    return null;
  }

  const changeReason = str(input.changeReason);
  if (changeReason.length === 0) {
    addIssue(context, 'invalid_risk_threshold', `${path}.changeReason`);
    return null;
  }

  return { greenUpper, redLower, changeReason };
}

function parseUpstreamSnapshots(
  value: unknown,
  path: string,
  context: Context,
): RiskUpstreamSnapshots {
  const input = record(value);
  const allowed = ['valuation', 'forecast', 'investorReturns', 'exit'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) return invalidDto();
  }

  const result: Record<string, unknown> = {};

  if (Object.hasOwn(input, 'valuation')) {
    const snap = record(input.valuation);
    exactKeys(snap, ['snapshotId', 'sourceRef', 'safetyMargin']);
    const snapshotId = str(snap.snapshotId);
    if (snapshotId.length === 0 || snapshotId.length > 256) {
      addIssue(context, 'invalid_risk_snapshot', `${path}.valuation.snapshotId`);
    }
    if (str(snap.sourceRef) !== 'valuation-triangulation@1') {
      addIssue(context, 'invalid_risk_snapshot', `${path}.valuation.sourceRef`);
    }
    let safetyMargin: string;
    try {
      safetyMargin = canonicalDecimal(parseDecimalString(str(snap.safetyMargin)));
    } catch {
      addIssue(context, 'invalid_risk_snapshot', `${path}.valuation.safetyMargin`);
      safetyMargin = '0';
    }
    result.valuation = { snapshotId, sourceRef: 'valuation-triangulation@1' as const, safetyMargin };
  }

  if (Object.hasOwn(input, 'forecast')) {
    const snap = record(input.forecast);
    exactKeys(snap, ['snapshotId', 'sourceRef', 'downsideCashBreak']);
    const snapshotId = str(snap.snapshotId);
    if (snapshotId.length === 0 || snapshotId.length > 256) {
      addIssue(context, 'invalid_risk_snapshot', `${path}.forecast.snapshotId`);
    }
    if (str(snap.sourceRef) !== 'scenario-forecast@1') {
      addIssue(context, 'invalid_risk_snapshot', `${path}.forecast.sourceRef`);
    }
    const downsideCashBreak = snap.downsideCashBreak === true;
    if (snap.downsideCashBreak !== true && snap.downsideCashBreak !== false) {
      addIssue(context, 'invalid_risk_snapshot', `${path}.forecast.downsideCashBreak`);
    }
    result.forecast = { snapshotId, sourceRef: 'scenario-forecast@1' as const, downsideCashBreak };
  }

  if (Object.hasOwn(input, 'investorReturns')) {
    const snap = record(input.investorReturns);
    exactKeys(snap, ['snapshotId', 'sourceRef', 'downsideMoic']);
    const snapshotId = str(snap.snapshotId);
    if (snapshotId.length === 0 || snapshotId.length > 256) {
      addIssue(context, 'invalid_risk_snapshot', `${path}.investorReturns.snapshotId`);
    }
    if (str(snap.sourceRef) !== 'investor-returns@1') {
      addIssue(context, 'invalid_risk_snapshot', `${path}.investorReturns.sourceRef`);
    }
    let downsideMoic: string;
    try {
      const dm = parseDecimalString(str(snap.downsideMoic));
      if (dm.isNegative()) throw new Error();
      downsideMoic = canonicalDecimal(dm);
    } catch {
      addIssue(context, 'invalid_risk_snapshot', `${path}.investorReturns.downsideMoic`);
      downsideMoic = '0';
    }
    result.investorReturns = { snapshotId, sourceRef: 'investor-returns@1' as const, downsideMoic };
  }

  if (Object.hasOwn(input, 'exit')) {
    const snap = record(input.exit);
    exactKeys(snap, ['snapshotId', 'sourceRef', 'exitDelayed']);
    const snapshotId = str(snap.snapshotId);
    if (snapshotId.length === 0 || snapshotId.length > 256) {
      addIssue(context, 'invalid_risk_snapshot', `${path}.exit.snapshotId`);
    }
    if (str(snap.sourceRef) !== 'exit-assessment@1') {
      addIssue(context, 'invalid_risk_snapshot', `${path}.exit.sourceRef`);
    }
    const exitDelayed = snap.exitDelayed === true;
    if (snap.exitDelayed !== true && snap.exitDelayed !== false) {
      addIssue(context, 'invalid_risk_snapshot', `${path}.exit.exitDelayed`);
    }
    result.exit = { snapshotId, sourceRef: 'exit-assessment@1' as const, exitDelayed };
  }

  return result as unknown as RiskUpstreamSnapshots;
}

function parseCategoryWeights(
  value: unknown,
  path: string,
  context: Context,
): Record<RiskCategory, string> | null {
  const input = record(value);
  const expected: string[] = [...CATEGORIES];
  const keys = Object.keys(input).sort(compareUnicodeCodePoints);
  const expectedSorted = [...expected].sort(compareUnicodeCodePoints);
  if (keys.length !== expectedSorted.length) return invalidDto();
  for (let i = 0; i < expectedSorted.length; i += 1) {
    if (keys[i] !== expectedSorted[i]) return invalidDto();
  }

  const weights: Record<string, string> = {};
  let total = new AnalysisDecimal(0);
  for (const cat of CATEGORIES) {
    let parsed: string;
    try {
      const dec = parseUnitIntervalString(str(input[cat]));
      parsed = canonicalDecimal(dec);
    } catch {
      addIssue(context, 'invalid_risk_weight', `${path}.${cat}`);
      return null;
    }
    weights[cat] = parsed;
    total = total.plus(parsed);
  }

  if (canonicalDecimal(total) !== '1') {
    addIssue(context, 'invalid_risk_weight', path);
    return null;
  }

  return weights as Record<RiskCategory, string>;
}

export function validateRiskInput(value: unknown): RiskInputValidation {
  const snapped = snapshotRiskInput(value);
  const input = record(snapped);
  const allAllowedKeys = [
    'version',
    'asOfDate',
    'riskItems',
    'fatalFlaws',
    'categoryWeights',
    'trafficLightThresholds',
    'upstreamSnapshots',
  ];
  allowedKeys(input, allAllowedKeys);
  const requiredKeys = ['version', 'asOfDate', 'riskItems', 'fatalFlaws'];

  const context: Context = {
    issues: [],
    warnings: [],
    riskIds: new Set(),
    evidenceRefs: new Set(),
    traceInputs: [],
  };

  for (const required of requiredKeys) {
    if (!Object.hasOwn(input, required)) {
      addIssue(context, 'missing_input', `risk.${required}`);
    }
  }

  const version = Object.hasOwn(input, 'version') ? str(input.version) : '';
  if (version !== '1') {
    addIssue(context, 'unsupported_engine_version', 'risk.version');
  }

  const asOfDate = Object.hasOwn(input, 'asOfDate') ? str(input.asOfDate) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    addIssue(context, 'period_mismatch', 'risk.asOfDate');
  }

  const rawItems = arr(input.riskItems);
  if (rawItems.length > 4096) {
    addIssue(context, 'invalid_risk_item', 'risk.riskItems');
  }
  const riskItems: RiskItemInput[] = [];
  for (let i = 0; i < rawItems.length && context.issues.length === 0; i += 1) {
    const parsed = parseRiskItem(rawItems[i], `risk.riskItems.${i}`, context);
    if (parsed !== null) riskItems.push(parsed);
  }

  const rawFlaws = arr(input.fatalFlaws);
  const seenFlawIds = new Set<string>();
  const fatalFlaws: FatalFlawCheckInput[] = [];
  for (let i = 0; i < rawFlaws.length && context.issues.length === 0; i += 1) {
    const parsed = parseFatalFlaw(rawFlaws[i], `risk.fatalFlaws.${i}`, context);
    if (parsed !== null) {
      if (seenFlawIds.has(parsed.fatalFlawId)) {
        addIssue(context, 'invalid_fatal_flaw', `risk.fatalFlaws.${i}.fatalFlawId`);
      } else {
        seenFlawIds.add(parsed.fatalFlawId);
        fatalFlaws.push(parsed);
      }
    }
  }
  if (fatalFlaws.length !== 6 || !(FATAL_FLAW_IDS as readonly string[]).every((id) => seenFlawIds.has(id))) {
    addIssue(context, 'invalid_fatal_flaw', 'risk.fatalFlaws');
  }

  let categoryWeights: Record<RiskCategory, string> | undefined;
  if (input.categoryWeights !== null && input.categoryWeights !== undefined) {
    const parsed = parseCategoryWeights(input.categoryWeights, 'risk.categoryWeights', context);
    if (parsed !== null) categoryWeights = parsed;
  }

  let trafficLightThresholds: TrafficLightThresholdInput | undefined;
  if (input.trafficLightThresholds !== null && input.trafficLightThresholds !== undefined) {
    const parsed = parseTrafficLightThresholds(
      input.trafficLightThresholds,
      'risk.trafficLightThresholds',
      context,
    );
    if (parsed !== null) trafficLightThresholds = parsed;
  }

  let upstreamSnapshots: RiskUpstreamSnapshots | undefined;
  if (input.upstreamSnapshots !== null && input.upstreamSnapshots !== undefined) {
    upstreamSnapshots = parseUpstreamSnapshots(input.upstreamSnapshots, 'risk.upstreamSnapshots', context);
  }

  // Check for not-meaningful: custom weights with assessed categories but zero assessed weight
  const assessedCategories = new Set(riskItems.map((item) => item.category));
  if (
    categoryWeights !== undefined &&
    assessedCategories.size > 0
  ) {
    let assessedWeight = new AnalysisDecimal(0);
    for (const cat of assessedCategories) {
      assessedWeight = assessedWeight.plus(categoryWeights[cat]!);
    }
    if (assessedWeight.isZero()) {
      context.issues.push(issue('missing_risk_coverage', 'risk.categoryWeights'));
    }
  }

  context.issues.sort((left, right) => compareUnicodeCodePoints(left.path, right.path));
  context.warnings.sort((left, right) => compareUnicodeCodePoints(left.path, right.path));

  if (context.issues.length > 0) {
    const allZeroWeight = categoryWeights !== undefined
      && assessedCategories.size > 0
      && context.issues.some((i) => i.code === 'missing_risk_coverage');
    return {
      status: 'blocked',
      reason: allZeroWeight ? 'not-meaningful' : 'invalid-input',
      issues: context.issues,
      traceInputs: context.traceInputs,
    };
  }

  return {
    status: 'valid',
    input: {
      version: '1',
      asOfDate,
      riskItems,
      fatalFlaws,
      ...(categoryWeights !== undefined ? { categoryWeights } : {}),
      ...(trafficLightThresholds !== undefined
        ? { trafficLightThresholds }
        : {}),
      ...(upstreamSnapshots !== undefined
        ? { upstreamSnapshots }
        : {}),
    },
    warnings: context.warnings,
    traceInputs: context.traceInputs,
  };
}
