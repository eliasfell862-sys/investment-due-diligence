import {
  AnalysisDecimal,
  canonicalDecimal,
} from '../../domain/analysis/decimal';
import { compareUnicodeCodePoints } from './compare-risk-strings';
import type {
  RiskAssessmentInput,
  RiskItemAssessment,
  RiskItemInput,
  RiskLight,
  CategoryRiskAssessment,
  OverallRiskAssessment,
  RiskCategory,
  AppliedTrafficLightThresholds,
  RiskDataGap,
} from './risk-types';

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

const DEFAULT_GREEN_UPPER = '0.33';
const DEFAULT_RED_LOWER = '0.67';

export interface RiskScoreCalculation {
  readonly items: readonly RiskItemAssessment[];
  readonly categoryMatrix: readonly CategoryRiskAssessment[];
  readonly overall: OverallRiskAssessment;
  readonly thresholds: AppliedTrafficLightThresholds;
  readonly dataGaps: readonly RiskDataGap[];
}

function computeLight(
  residualRisk: string,
  greenUpper: string,
  redLower: string,
): RiskLight {
  const risk = new AnalysisDecimal(residualRisk);
  if (risk.lessThan(greenUpper)) return 'green';
  if (risk.lessThan(redLower)) return 'yellow';
  return 'red';
}

function computeResidualRisk(item: RiskItemInput): string {
  const prob = new AnalysisDecimal(item.probability);
  const impact = new AnalysisDecimal(item.impact);
  const mitigation = new AnalysisDecimal(item.mitigationEffectiveness);
  return canonicalDecimal(prob.times(impact).times(new AnalysisDecimal(1).minus(mitigation)));
}

export function calculateRiskScores(
  input: RiskAssessmentInput,
): RiskScoreCalculation {
  const greenUpper = input.trafficLightThresholds?.greenUpper ?? DEFAULT_GREEN_UPPER;
  const redLower = input.trafficLightThresholds?.redLower ?? DEFAULT_RED_LOWER;

  const thresholds: AppliedTrafficLightThresholds = {
    greenUpper,
    redLower,
    source: input.trafficLightThresholds ? 'custom' : 'default',
    changeReason: input.trafficLightThresholds?.changeReason ?? null,
  };

  // Score every risk item
  const scoredItems: RiskItemAssessment[] = input.riskItems.map((item) => {
    const residualRisk = computeResidualRisk(item);
    return {
      riskId: item.riskId,
      category: item.category,
      title: item.title,
      probability: item.probability,
      impact: item.impact,
      mitigationEffectiveness: item.mitigationEffectiveness,
      mitigationDescription: item.mitigationDescription ?? null,
      signals: item.signals ?? [],
      evidenceRefs: item.evidenceRefs ?? [],
      residualRisk,
      light: computeLight(residualRisk, greenUpper, redLower),
    };
  });

  // Group by category
  const byCategory = new Map<RiskCategory, RiskItemAssessment[]>();
  for (const item of scoredItems) {
    const list = byCategory.get(item.category);
    if (list !== undefined) list.push(item);
    else byCategory.set(item.category, [item]);
  }

  // Determine category maximum and data gaps
  const dataGaps: RiskDataGap[] = [];
  const categoryRows: CategoryRiskAssessment[] = CATEGORIES.map((category) => {
    const items = byCategory.get(category);
    if (items === undefined || items.length === 0) {
      dataGaps.push({
        gapId: `unassessed-${category}`,
        description: `Risk category "${category}" has not been assessed.`,
        category,
        sourceRefs: [],
      });
      return {
        category,
        status: 'unassessed' as const,
        riskItemCount: 0,
        residualRisk: null,
        light: null,
        topRiskId: null,
        topRiskTitle: null,
        clauseRecommendationCount: 0,
        evidenceRefCount: 0,
        dataGaps: [],
      };
    }

    // Category risk = max of item residual risks
    let maxItem = items[0]!;
    let maxRisk = new AnalysisDecimal(maxItem.residualRisk);
    for (let i = 1; i < items.length; i += 1) {
      const current = new AnalysisDecimal(items[i]!.residualRisk);
      if (current.greaterThan(maxRisk)) {
        maxRisk = current;
        maxItem = items[i]!;
      } else if (current.equals(maxRisk)) {
        // Ties: select Unicode-code-point-smallest riskId
        if (compareUnicodeCodePoints(items[i]!.riskId, maxItem.riskId) < 0) {
          maxItem = items[i]!;
        }
      }
    }

    const evidenceRefs = [...new Set(items.flatMap((item) => item.evidenceRefs))];
    const residualRisk = canonicalDecimal(maxRisk);
    return {
      category,
      status: 'assessed' as const,
      riskItemCount: items.length,
      residualRisk,
      light: computeLight(residualRisk, greenUpper, redLower),
      topRiskId: maxItem.riskId,
      topRiskTitle: maxItem.title,
      clauseRecommendationCount: 0,
      evidenceRefCount: evidenceRefs.length,
      dataGaps: [],
    };
  });

  // Calculate overall risk
  const assessedRows = categoryRows.filter((r) => r.status === 'assessed');
  const assessedCategoryCount = assessedRows.length;

  if (assessedCategoryCount === 0) {
    return {
      items: scoredItems,
      categoryMatrix: categoryRows,
      overall: {
        assessedCategoryCount: 0,
        categoryCoverageRatio: '0',
        weightCoverageRatio: '0',
        residualRisk: null,
        riskPenalty: null,
        light: null,
      },
      thresholds,
      dataGaps,
    };
  }

  const categoryCoverageRatio = canonicalDecimal(
    new AnalysisDecimal(assessedCategoryCount).div(9),
  );

  let overallResidualRisk: AnalysisDecimal;
  let weightCoverageRatio: string;

  if (input.categoryWeights !== undefined) {
    // Custom weights: renormalize over assessed categories
    let assessedWeight = new AnalysisDecimal(0);
    let weightedRisk = new AnalysisDecimal(0);

    for (const row of assessedRows) {
      const weight = new AnalysisDecimal(input.categoryWeights[row.category]!);
      assessedWeight = assessedWeight.plus(weight);
      weightedRisk = weightedRisk.plus(
        weight.times(row.residualRisk!),
      );
    }

    weightCoverageRatio = canonicalDecimal(assessedWeight);
    overallResidualRisk = weightedRisk.div(assessedWeight);
  } else {
    // Default equal weights: arithmetic mean of assessed categories
    let total = new AnalysisDecimal(0);
    for (const row of assessedRows) {
      total = total.plus(row.residualRisk!);
    }
    overallResidualRisk = total.div(assessedCategoryCount);
    weightCoverageRatio = categoryCoverageRatio;
  }

  const overallResidualRiskStr = canonicalDecimal(overallResidualRisk);
  const overallLight = computeLight(overallResidualRiskStr, greenUpper, redLower);
  const riskPenalty = canonicalDecimal(overallResidualRisk.times(20));

  return {
    items: scoredItems,
    categoryMatrix: categoryRows,
    overall: {
      assessedCategoryCount,
      categoryCoverageRatio,
      weightCoverageRatio,
      residualRisk: overallResidualRiskStr,
      riskPenalty,
      light: overallLight,
    },
    thresholds,
    dataGaps,
  };
}
