import type {
  EquityCalculationTrace,
  TraceStep,
} from '../../domain/analysis/calculation-trace';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import { blockedResult, okResult } from '../../domain/analysis/engine-result';
import { calculateLiquidationWaterfall } from './calculate-liquidation-waterfall';
import { compareUnicodeCodePoints } from './compare-equity-strings';
import { calculateXirr } from './calculate-xirr';
import { validateInvestorReturnInput } from './validate-equity-input';
import type {
  DatedCashFlow,
  EquityEngineResult,
  InvestorReturnSet,
  InvestorScenarioReturn,
} from './equity-types';

function trace(inputs: EquityCalculationTrace['inputs'], steps: readonly TraceStep[]): EquityCalculationTrace {
  return { engine: 'equity', equityRef: 'investor-returns@1', inputs, steps };
}

export function calculateInvestorReturns(
  input: unknown,
): EquityEngineResult<InvestorReturnSet> {
  const validation = validateInvestorReturnInput(input);
  if (validation.status === 'blocked') {
    return blockedResult(validation.reason, validation.issues, trace(validation.traceInputs, []));
  }
  const normalized = validation.input;
  const investments = normalized.capTable.investments
    .filter(({ holderId }) => holderId === normalized.holderId)
    .sort((a, b) => compareUnicodeCodePoints(a.date, b.date) ||
      compareUnicodeCodePoints(a.eventId, b.eventId));
  const totalInvested = investments.reduce(
    (sum, investment) => sum.plus(investment.amount),
    new AnalysisDecimal(0),
  );
  if (!totalInvested.greaterThan(0)) {
    return blockedResult('not-meaningful', [{
      code: 'non_positive_denominator',
      path: 'capTable.investments',
      message: 'Investor capital must be positive.',
      details: { holderId: normalized.holderId },
    }], trace(validation.traceInputs, []));
  }

  const scenarios: InvestorScenarioReturn[] = [];
  const steps: TraceStep[] = [];
  let expectedExitProceeds = new AnalysisDecimal(0);
  let permanentLossProbability = new AnalysisDecimal(0);

  for (const scenario of normalized.scenarios) {
    const waterfall = calculateLiquidationWaterfall({
      version: normalized.version,
      currency: normalized.currency,
      asOfDate: normalized.capTable.asOfDate,
      exitDate: scenario.exitDate,
      exitValue: scenario.exitValue,
      positions: normalized.capTable.positions,
    });
    if (waterfall.status === 'blocked') {
      return blockedResult(
        waterfall.reason,
        waterfall.issues,
        trace(validation.traceInputs, steps),
      );
    }
    const proceeds = waterfall.value.allocations
      .filter(({ holderId }) => holderId === normalized.holderId)
      .reduce((sum, allocation) => sum.plus(allocation.totalProceeds), new AnalysisDecimal(0));
    const moic = proceeds.dividedBy(totalInvested);
    const cashFlows: DatedCashFlow[] = [
      ...investments.map((investment) => ({
        date: investment.date,
        amount: canonicalDecimal(new AnalysisDecimal(investment.amount).negated()),
      })),
      { date: scenario.exitDate, amount: canonicalDecimal(proceeds) },
    ];
    const xirr = calculateXirr(cashFlows);
    const permanentLoss = proceeds.lessThan(totalInvested);
    if (permanentLoss) permanentLossProbability = permanentLossProbability.plus(scenario.probability);
    expectedExitProceeds = expectedExitProceeds.plus(
      proceeds.times(scenario.probability),
    );
    scenarios.push({
      id: scenario.id,
      probability: scenario.probability,
      exitDate: scenario.exitDate,
      exitValue: scenario.exitValue,
      investorProceeds: canonicalDecimal(proceeds),
      moic: canonicalDecimal(moic),
      irr: xirr.status === 'ok' ? xirr.value : null,
      ...(xirr.status === 'blocked' ? { irrIssue: xirr.issue } : {}),
      permanentLoss,
    });
    steps.push({
      id: `returns:${scenario.id}:proceeds`,
      operator: 'liquidation-allocation-sum',
      operands: waterfall.value.allocations
        .filter(({ holderId }) => holderId === normalized.holderId)
        .map(({ totalProceeds }) => totalProceeds),
      result: canonicalDecimal(proceeds),
      outcome: 'passed',
    });
  }

  return okResult({
    version: normalized.version,
    currency: normalized.currency,
    holderId: normalized.holderId,
    totalInvestedCapital: canonicalDecimal(totalInvested),
    scenarios,
    expectedExitProceeds: canonicalDecimal(expectedExitProceeds),
    expectedMoic: canonicalDecimal(expectedExitProceeds.dividedBy(totalInvested)),
    permanentLossProbability: canonicalDecimal(permanentLossProbability),
  }, validation.warnings, trace(validation.traceInputs, steps));
}
