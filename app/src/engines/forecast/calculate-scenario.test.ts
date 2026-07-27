import { describe, expect, it } from 'vitest';

import { AnalysisDecimal } from '../../domain/analysis/decimal';
import { evaluateAst } from '../formulas/evaluate-ast';
import { getFormulaDefinition } from '../formulas/formula-registry';
import { forecastInput } from './forecast-test-fixtures';
import { calculateScenario } from './calculate-scenario';
import { createForecastPeriods } from './generate-monthly-series';
import type {
  NormalizedAmountGrowthRule,
  NormalizedForecastInput,
  NormalizedRevenueRatioRule,
  NormalizedScenario,
} from './forecast-types';
import { validateForecastInput } from './validate-forecast-input';

function normalized(): NormalizedForecastInput {
  const result = validateForecastInput(forecastInput());
  if (result.status !== 'valid') {
    throw new Error(JSON.stringify(result));
  }
  return result.input;
}

function baseScenario(input: NormalizedForecastInput): NormalizedScenario {
  const scenario = input.scenarios.find((candidate) => candidate.id === 'base');
  if (scenario === undefined) throw new Error('Missing base scenario');
  return scenario;
}

function ratioValue(
  rule: NormalizedRevenueRatioRule,
  value: string,
): NormalizedRevenueRatioRule {
  return {
    ...rule,
    modelYearRates: rule.modelYearRates.map((rate) => ({ ...rate, value })),
  };
}

function amountValue(
  rule: NormalizedAmountGrowthRule,
  value: string,
): NormalizedAmountGrowthRule {
  return {
    ...rule,
    rule: {
      ...rule.rule,
      startingValue: { ...rule.rule.startingValue, value },
    },
  };
}

describe('calculateScenario', () => {
  it('calculates the approved profitable monthly financial chain', () => {
    const input = normalized();
    const result = calculateScenario(
      baseScenario(input),
      input.baseline,
      createForecastPeriods('2026-04', 36),
    );

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.months[0]).toMatchObject({
        revenue: '1000',
        costOfGoodsSold: '450',
        grossProfit: '550',
        salesAndMarketing: '200',
        researchAndDevelopment: '150',
        generalAndAdministrative: '100',
        ebitda: '100',
        depreciationAndAmortization: '10',
        ebit: '90',
        interestExpense: '3',
        preTaxIncome: '87',
        incomeTax: '21.75',
        netIncome: '65.25',
        increaseInNetWorkingCapital: '8',
        operatingCashFlow: '67.25',
        capitalExpenditure: '15',
        freeCashFlow: '52.25',
        fcff: '54.5',
        beginningCash: '1000',
        preFinancingEndingCash: '1052.25',
        financingInflow: '0',
        endingCash: '1052.25',
      });
      expect(result.months).toHaveLength(36);
      expect(result.monthTraces).toHaveLength(36);
    }
  });

  it('does not recognize a tax benefit for a loss month', () => {
    const input = normalized();
    const original = baseScenario(input);
    if (original.assumptions.costOfGoodsSold.kind !== 'revenue-ratio') {
      throw new Error('Expected ratio cost');
    }
    const scenario: NormalizedScenario = {
      ...original,
      assumptions: {
        ...original.assumptions,
        costOfGoodsSold: ratioValue(original.assumptions.costOfGoodsSold, '2'),
      },
    };
    const result = calculateScenario(
      scenario,
      input.baseline,
      createForecastPeriods('2026-04', 36),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(new AnalysisDecimal(result.months[0]!.preTaxIncome).isNegative()).toBe(true);
      expect(result.months[0]?.incomeTax).toBe('0');
    }
  });

  it('treats negative working-capital increases as cash releases', () => {
    const input = normalized();
    const original = baseScenario(input);
    const scenario: NormalizedScenario = {
      ...original,
      assumptions: {
        ...original.assumptions,
        increaseInNetWorkingCapital: amountValue(
          original.assumptions.increaseInNetWorkingCapital,
          '-10',
        ),
      },
    };
    const result = calculateScenario(
      scenario,
      input.baseline,
      createForecastPeriods('2026-04', 36),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.months[0]?.operatingCashFlow).toBe('85.25');
      expect(result.months[0]?.freeCashFlow).toBe('70.25');
      expect(result.months[0]?.fcff).toBe('72.5');
    }
  });

  it('tops cash up to the minimum balance and carries financing forward', () => {
    const input = normalized();
    const baseline = {
      ...input.baseline,
      beginningCash: { ...input.baseline.beginningCash, value: '10' },
      minimumCashBalance: {
        ...input.baseline.minimumCashBalance,
        value: '100',
      },
    };
    const result = calculateScenario(
      baseScenario(input),
      baseline,
      createForecastPeriods('2026-04', 36),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.months[0]).toMatchObject({
        beginningCash: '10',
        preFinancingEndingCash: '62.25',
        financingInflow: '37.75',
        endingCash: '100',
      });
      expect(result.months[1]?.beginningCash).toBe('100');
    }
  });

  it('reuses the registered free_cash_flow formula AST exactly', () => {
    const input = normalized();
    const result = calculateScenario(
      baseScenario(input),
      input.baseline,
      createForecastPeriods('2026-04', 36),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const month = result.months[0]!;
    const definition = getFormulaDefinition('free_cash_flow', '1');
    const formula = evaluateAst(
      definition.ast,
      new Map([
        ['operating_cash_flow', new AnalysisDecimal(month.operatingCashFlow)],
        ['capital_expenditure', new AnalysisDecimal(month.capitalExpenditure)],
      ]),
      new Map(),
    );
    expect(formula).toMatchObject({
      status: 'ok',
      value: month.freeCashFlow,
    });
    expect(result.monthTraces[0]?.steps.some((step) =>
      step.id.includes('free_cash_flow@1'))).toBe(true);
  });

  it('blocks a negative generated non-negative expense', () => {
    const input = normalized();
    const original = baseScenario(input);
    const scenario: NormalizedScenario = {
      ...original,
      assumptions: {
        ...original.assumptions,
        capitalExpenditure: amountValue(
          original.assumptions.capitalExpenditure,
          '-1',
        ),
      },
    };
    expect(calculateScenario(
      scenario,
      input.baseline,
      createForecastPeriods('2026-04', 36),
    )).toMatchObject({
      status: 'blocked',
      issues: [{ code: 'value_out_of_range' }],
    });
  });
});
