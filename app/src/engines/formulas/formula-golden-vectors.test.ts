import { describe, expect, it } from 'vitest';
import type { EngineResult } from '../../domain/analysis/engine-result';
import { evaluateMetric } from './evaluate-metric';
import {
  customerCountUnit,
  customerMoneyUnit,
  currencyUnit,
  expectOkValue,
  FY2025,
  FY2025_BEGIN,
  FY2025_END,
  JAN2025,
  observation,
} from './formula-test-fixtures';
import type { FormulaObservation, MetricCalculation } from './formula-types';

const asOf = (id: string, date: string) => ({ kind: 'as-of' as const, id, date });

const evaluate = (formulaId: string, observations: readonly FormulaObservation[]) =>
  evaluateMetric({ formulaId, version: '1', observations });

const expectIssue = (
  result: EngineResult<MetricCalculation>,
  reason: 'invalid-input' | 'not-meaningful',
  code: string,
) => {
  expect(result).toMatchObject({ status: 'blocked', reason, issues: [{ code }] });
};

describe('formula golden vectors', () => {
  it('expectOkValue includes the blocked result JSON in its error', () => {
    const result = evaluate('gross_margin', [
      observation('revenue', '0'),
      observation('cost_of_goods_sold', '0'),
    ]);

    expect(() => expectOkValue(result)).toThrow(JSON.stringify(result));
  });

  it('evaluates runway from a month-end balance into the following burn month', () => {
    const february = {
      kind: 'flow' as const,
      id: 'FEB2025',
      startDate: '2025-02-01',
      endDate: '2025-02-28',
      durationMonths: 1,
      granularity: 'month' as const,
    };
    const result = evaluate('cash_runway_months', [
      observation('cash_balance', '120', currencyUnit(), asOf('JAN2025_END', '2025-01-31')),
      observation('monthly_net_cash_burn', '10', currencyUnit(), february),
    ]);

    expect(result).toMatchObject({
      status: 'ok',
      value: {
        value: {
          value: '12',
          unit: { kind: 'duration', durationUnit: 'months' },
        },
        period: {
          kind: 'span',
          startDate: '2025-02-01',
          endDate: '2025-02-28',
          durationMonths: 1,
        },
      },
    });
  });
  it.each([
    [
      'gross margin', 'gross_margin',
      [observation('revenue', '100'), observation('cost_of_goods_sold', '120')], '-0.2',
    ],
    [
      'EBITDA margin', 'ebitda_margin',
      [observation('ebitda', '-12'), observation('revenue', '120')], '-0.1',
    ],
    [
      'free cash flow', 'free_cash_flow',
      [observation('operating_cash_flow', '48.75'), observation('capital_expenditure', '13.25')], '35.5',
    ],
    [
      'burn multiple', 'burn_multiple',
      [
        observation('net_cash_burn', '75'),
        observation('beginning_arr', '200', currencyUnit(), FY2025_BEGIN),
        observation('ending_arr', '250', currencyUnit(), FY2025_END),
      ], '1.5',
    ],
    [
      'CAC payback', 'cac_payback_months',
      [
        observation('customer_acquisition_cost', '900', customerMoneyUnit(), JAN2025),
        observation('monthly_gross_profit_per_new_customer', '150', customerMoneyUnit('CNY', 'month'), JAN2025),
      ], '6',
    ],
    [
      'cash runway', 'cash_runway_months',
      [
        observation('cash_balance', '1000', currencyUnit(), FY2025_END),
        observation('monthly_net_cash_burn', '80', currencyUnit(), {
          kind: 'flow', id: 'DEC2025', startDate: '2025-12-01', endDate: '2025-12-31',
          durationMonths: 1, granularity: 'month',
        }),
      ], '12.5',
    ],
    [
      'revenue CAGR', 'revenue_cagr',
      [
        observation('beginning_revenue', '1000', currencyUnit(), asOf('BEGIN', '2022-12-31')),
        observation('ending_revenue', '1728', currencyUnit(), asOf('END', '2025-12-31')),
      ], '0.2',
    ],
    [
      'customer concentration', 'customer_concentration',
      [observation('concentrated_customer_revenue', '22'), observation('total_revenue', '200')], '0.11',
    ],
    [
      'repeat purchase rate', 'repeat_purchase_rate',
      [
        observation('repeat_customers', '27', customerCountUnit),
        observation('eligible_customers', '90', customerCountUnit),
      ], '0.3',
    ],
    [
      'NRR', 'nrr',
      [
        observation('opening_recurring_revenue', '200', currencyUnit(), FY2025_BEGIN),
        observation('expansion_revenue', '30'),
        observation('contraction_revenue', '10'),
        observation('churned_revenue', '20'),
      ], '1',
    ],
    [
      'LTV/CAC', 'ltv_cac',
      [
        observation('customer_lifetime_value', '2500', customerMoneyUnit(), FY2025_END),
        observation('customer_acquisition_cost', '1000', customerMoneyUnit(), FY2025_END),
      ], '2.5',
    ],
    [
      'inventory turnover days', 'inventory_turnover_days',
      [
        observation('beginning_inventory', '200', currencyUnit(), FY2025_BEGIN),
        observation('ending_inventory', '280', currencyUnit(), FY2025_END),
        observation('cost_of_goods_sold', '1200', currencyUnit(), FY2025),
      ], '73',
    ],
    [
      'net new ARR', 'net_new_arr',
      [
        observation('beginning_arr', '320', currencyUnit(), FY2025_BEGIN),
        observation('ending_arr', '450', currencyUnit(), FY2025_END),
      ], '130',
    ],
  ] as const)('matches the hand-calculated %s vector', (_label, formulaId, observations, expected) => {
    expect(expectOkValue(evaluate(formulaId, observations))).toBe(expected);
  });

  it.each([
    [
      'gross margin zero denominator', 'gross_margin',
      [observation('revenue', '0'), observation('cost_of_goods_sold', '0')],
      'not-meaningful', 'division_by_zero',
    ],
    [
      'EBITDA non-positive denominator', 'ebitda_margin',
      [observation('ebitda', '1'), observation('revenue', '-1')],
      'not-meaningful', 'non_positive_denominator',
    ],
    [
      'concentration numerator above total', 'customer_concentration',
      [observation('concentrated_customer_revenue', '101'), observation('total_revenue', '100')],
      'invalid-input', 'value_out_of_range',
    ],
    [
      'repeat customers above eligible', 'repeat_purchase_rate',
      [
        observation('repeat_customers', '101', customerCountUnit),
        observation('eligible_customers', '100', customerCountUnit),
      ], 'invalid-input', 'value_out_of_range',
    ],
    [
      'negative NRR expansion', 'nrr',
      [
        observation('opening_recurring_revenue', '100', currencyUnit(), FY2025_BEGIN),
        observation('expansion_revenue', '-1'),
        observation('contraction_revenue', '0'),
        observation('churned_revenue', '0'),
      ], 'invalid-input', 'value_out_of_range',
    ],
    [
      'NRR contraction plus churn exceeds opening plus expansion', 'nrr',
      [
        observation('opening_recurring_revenue', '100', currencyUnit(), FY2025_BEGIN),
        observation('expansion_revenue', '0'),
        observation('contraction_revenue', '80'),
        observation('churned_revenue', '30'),
      ], 'invalid-input', 'value_out_of_range',
    ],
    [
      'LTV/CAC zero denominator', 'ltv_cac',
      [
        observation('customer_lifetime_value', '2500', customerMoneyUnit(), FY2025_END),
        observation('customer_acquisition_cost', '0', customerMoneyUnit(), FY2025_END),
      ], 'not-meaningful', 'division_by_zero',
    ],
  ] as const)('matches the hand-classified exceptional vector: %s', (
    _label,
    formulaId,
    observations,
    reason,
    code,
  ) => {
    expectIssue(evaluate(formulaId, observations), reason, code);
  });
});
