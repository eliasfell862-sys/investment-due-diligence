import type {
  FatalFlawCheckInput,
  FatalFlawId,
  RiskAssessmentInput,
  RiskItemInput,
  RiskUpstreamSnapshots,
  TrafficLightThresholdInput,
} from './risk-types';

type NestedOverrides<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [Key in keyof T]?: NestedOverrides<T[Key]> }
    : T;

export type RiskAssessmentInputOverrides = Omit<
  NestedOverrides<RiskAssessmentInput>,
  'categoryWeights' | 'fatalFlaws' | 'riskItems'
> & {
  readonly categoryWeights?: RiskAssessmentInput['categoryWeights'];
  readonly fatalFlaws?: readonly FatalFlawCheckInput[];
  readonly riskItems?: readonly RiskItemInput[];
};

export function riskItemInput(
  overrides: NestedOverrides<RiskItemInput> = {},
): RiskItemInput {
  return {
    riskId: overrides.riskId ?? 'market-adoption-risk',
    category: overrides.category ?? 'market',
    title: overrides.title ?? 'Target market adoption may be slower than planned.',
    probability: overrides.probability ?? '0.5',
    impact: overrides.impact ?? '0.8',
    mitigationEffectiveness: overrides.mitigationEffectiveness ?? '0.25',
    mitigationDescription:
      overrides.mitigationDescription ??
      'Release funding against independently verified adoption milestones.',
    signals:
      overrides.signals === undefined
        ? ['market_adoption']
        : [...overrides.signals],
    evidenceRefs:
      overrides.evidenceRefs === undefined
        ? ['data-room:market-study']
        : [...overrides.evidenceRefs],
  };
}

export function fatalFlawCheckInput(
  fatalFlawId: FatalFlawId = 'material_data_or_business_fraud',
  overrides: NestedOverrides<FatalFlawCheckInput> = {},
): FatalFlawCheckInput {
  const result: {
    fatalFlawId: FatalFlawId;
    status: FatalFlawCheckInput['status'];
    evidenceRefs: string[];
    coverageReason?: string;
    bindingConditions?: string[];
    resolutionNote?: string;
  } = {
    fatalFlawId: overrides.fatalFlawId ?? fatalFlawId,
    status: overrides.status ?? 'clear',
    evidenceRefs:
      overrides.evidenceRefs === undefined ? [] : [...overrides.evidenceRefs],
  };

  if (overrides.coverageReason !== undefined) {
    result.coverageReason = overrides.coverageReason;
  }
  if (overrides.bindingConditions !== undefined) {
    result.bindingConditions = [...overrides.bindingConditions];
  }
  if (overrides.resolutionNote !== undefined) {
    result.resolutionNote = overrides.resolutionNote;
  }

  return result;
}

function fatalFlawChecks(): FatalFlawCheckInput[] {
  return [
    fatalFlawCheckInput('material_data_or_business_fraud'),
    fatalFlawCheckInput('core_ownership_or_license_unclear'),
    fatalFlawCheckInput('irremediable_major_illegality'),
    fatalFlawCheckInput('business_model_unverifiable'),
    fatalFlawCheckInput('pre_close_cash_break'),
    fatalFlawCheckInput('founder_integrity_failure'),
  ];
}

function trafficLightThresholds(
  overrides: NestedOverrides<TrafficLightThresholdInput> = {},
): TrafficLightThresholdInput {
  return {
    greenUpper: overrides.greenUpper ?? '0.33',
    redLower: overrides.redLower ?? '0.67',
    changeReason:
      overrides.changeReason ??
      'Investment committee approved project thresholds.',
  };
}

function upstreamSnapshots(
  overrides: NestedOverrides<RiskUpstreamSnapshots> = {},
): RiskUpstreamSnapshots {
  const valuation = overrides.valuation;
  const forecast = overrides.forecast;
  const investorReturns = overrides.investorReturns;
  const exit = overrides.exit;

  return {
    valuation: {
      snapshotId: valuation?.snapshotId ?? 'valuation-base',
      sourceRef: valuation?.sourceRef ?? 'valuation-triangulation@1',
      safetyMargin: valuation?.safetyMargin ?? '0.25',
    },
    forecast: {
      snapshotId: forecast?.snapshotId ?? 'forecast-base',
      sourceRef: forecast?.sourceRef ?? 'scenario-forecast@1',
      downsideCashBreak: forecast?.downsideCashBreak ?? false,
    },
    investorReturns: {
      snapshotId: investorReturns?.snapshotId ?? 'investor-returns-base',
      sourceRef: investorReturns?.sourceRef ?? 'investor-returns@1',
      downsideMoic: investorReturns?.downsideMoic ?? '1.2',
    },
    exit: {
      snapshotId: exit?.snapshotId ?? 'exit-base',
      sourceRef: exit?.sourceRef ?? 'exit-assessment@1',
      exitDelayed: exit?.exitDelayed ?? false,
    },
  };
}

function cloneRiskItem(input: RiskItemInput): RiskItemInput {
  const result: {
    riskId: string;
    category: RiskItemInput['category'];
    title: string;
    probability: RiskItemInput['probability'];
    impact: RiskItemInput['impact'];
    mitigationEffectiveness: RiskItemInput['mitigationEffectiveness'];
    mitigationDescription?: string;
    signals?: RiskItemInput['signals'];
    evidenceRefs?: RiskItemInput['evidenceRefs'];
  } = {
    riskId: input.riskId,
    category: input.category,
    title: input.title,
    probability: input.probability,
    impact: input.impact,
    mitigationEffectiveness: input.mitigationEffectiveness,
  };

  if (input.mitigationDescription !== undefined) {
    result.mitigationDescription = input.mitigationDescription;
  }
  if (input.signals !== undefined) result.signals = [...input.signals];
  if (input.evidenceRefs !== undefined) {
    result.evidenceRefs = [...input.evidenceRefs];
  }
  return result;
}

function cloneFatalFlaw(input: FatalFlawCheckInput): FatalFlawCheckInput {
  return fatalFlawCheckInput(input.fatalFlawId, input);
}

export function riskAssessmentInput(
  overrides: RiskAssessmentInputOverrides = {},
): RiskAssessmentInput {
  const defaultRiskItems = [riskItemInput()];
  const defaultFatalFlaws = fatalFlawChecks();
  const result: {
    version: '1';
    asOfDate: string;
    riskItems: RiskItemInput[];
    fatalFlaws: FatalFlawCheckInput[];
    categoryWeights?: RiskAssessmentInput['categoryWeights'];
    trafficLightThresholds?: TrafficLightThresholdInput;
    upstreamSnapshots?: RiskUpstreamSnapshots;
  } = {
    version: overrides.version ?? '1',
    asOfDate: overrides.asOfDate ?? '2026-03-31',
    riskItems: (overrides.riskItems ?? defaultRiskItems).map(cloneRiskItem),
    fatalFlaws: (overrides.fatalFlaws ?? defaultFatalFlaws).map(cloneFatalFlaw),
  };

  if (overrides.trafficLightThresholds !== undefined) {
    result.trafficLightThresholds = trafficLightThresholds(overrides.trafficLightThresholds);
  }
  if (overrides.upstreamSnapshots !== undefined) {
    result.upstreamSnapshots = upstreamSnapshots(overrides.upstreamSnapshots);
  }
  if (overrides.categoryWeights !== undefined) {
    result.categoryWeights = { ...overrides.categoryWeights };
  }

  return result;
}
