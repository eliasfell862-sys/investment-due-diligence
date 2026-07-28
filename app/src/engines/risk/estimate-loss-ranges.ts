import { AnalysisDecimal } from '../../domain/analysis/decimal';
import type { LossProbabilityRange } from './risk-types';

export interface LossRangeInput {
  readonly fatalOutcome: 'none' | 'conditional_cap' | 'pause' | 'reject';
  readonly notCurableByClause: boolean;
  readonly overallResidualRisk: string | null;
  readonly safetyMargin: string;
  readonly downsideCashBreak: boolean;
  readonly downsideMoic: string;
  readonly exitDelayed: boolean;
}

interface LossRule {
  readonly ruleId: string;
  readonly lower: string;
  readonly upper: string;
  readonly condition: (input: LossRangeInput) => boolean;
}

function riskAtLeast(input: LossRangeInput, threshold: string): boolean {
  if (input.overallResidualRisk === null) return false;
  return new AnalysisDecimal(input.overallResidualRisk).greaterThanOrEqualTo(threshold);
}

function marginBelow(input: LossRangeInput, threshold: string): boolean {
  return new AnalysisDecimal(input.safetyMargin).lessThan(threshold);
}

function moicBelowOne(input: LossRangeInput): boolean {
  return new AnalysisDecimal(input.downsideMoic).lessThan(1);
}

const PERMANENT_RULES: readonly LossRule[] = [
  {
    ruleId: 'permanent_open_reject',
    lower: '0.75',
    upper: '1',
    condition: (input) => input.fatalOutcome === 'reject',
  },
  {
    ruleId: 'permanent_open_pause',
    lower: '0.5',
    upper: '0.8',
    condition: (input) => input.fatalOutcome === 'pause',
  },
  {
    ruleId: 'permanent_cash_break_and_moic_below_one',
    lower: '0.4',
    upper: '0.7',
    condition: (input) => input.downsideCashBreak && moicBelowOne(input),
  },
  {
    ruleId: 'permanent_overall_risk_at_least_067',
    lower: '0.3',
    upper: '0.6',
    condition: (input) => riskAtLeast(input, '0.67'),
  },
  {
    ruleId: 'permanent_overall_risk_at_least_033',
    lower: '0.15',
    upper: '0.35',
    condition: (input) => riskAtLeast(input, '0.33'),
  },
  {
    ruleId: 'permanent_default',
    lower: '0.05',
    upper: '0.2',
    condition: () => true,
  },
];

const TEMPORARY_RULES: readonly LossRule[] = [
  {
    ruleId: 'temporary_exit_delay_and_margin_below_015',
    lower: '0.45',
    upper: '0.75',
    condition: (input) => input.exitDelayed && marginBelow(input, '0.15'),
  },
  {
    ruleId: 'temporary_downside_moic_below_one',
    lower: '0.35',
    upper: '0.65',
    condition: (input) => moicBelowOne(input),
  },
  {
    ruleId: 'temporary_margin_below_020',
    lower: '0.25',
    upper: '0.5',
    condition: (input) => marginBelow(input, '0.20'),
  },
  {
    ruleId: 'temporary_overall_risk_at_least_033',
    lower: '0.15',
    upper: '0.4',
    condition: (input) => riskAtLeast(input, '0.33'),
  },
  {
    ruleId: 'temporary_default',
    lower: '0.05',
    upper: '0.25',
    condition: () => true,
  },
];

function applyRules(
  input: LossRangeInput,
  rules: readonly LossRule[],
): LossProbabilityRange {
  let selectedRule: LossRule | null = null;
  const triggeredRuleIds: string[] = [];

  for (const rule of rules) {
    if (rule.condition(input)) {
      triggeredRuleIds.push(rule.ruleId);
      if (selectedRule === null) {
        selectedRule = rule;
      }
    }
  }

  return {
    lower: selectedRule!.lower,
    upper: selectedRule!.upper,
    selectedRuleId: selectedRule!.ruleId,
    triggeredRuleIds,
    missingInputs: input.overallResidualRisk === null ? ['overallResidualRisk'] : [],
    requiresInvestorConfirmation: true,
  };
}

export interface DualLossRangeCalculation {
  readonly permanentLoss: LossProbabilityRange;
  readonly temporaryDrawdown: LossProbabilityRange;
}

export function estimateLossRanges(
  input: LossRangeInput,
): DualLossRangeCalculation {
  return {
    permanentLoss: applyRules(input, PERMANENT_RULES),
    temporaryDrawdown: applyRules(input, TEMPORARY_RULES),
  };
}
