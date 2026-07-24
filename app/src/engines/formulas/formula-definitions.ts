import { deepFreeze } from '../../domain/deep-freeze';
import type { AnalysisUnit } from '../../domain/analysis/value';
import type {
  FormulaAst,
  FormulaDefinition,
  FormulaOperandSpec,
} from './formula-types';

const CURRENCY = 'CNY';
const money: AnalysisUnit = { kind: 'currency', currency: CURRENCY };
const customerCount: AnalysisUnit = { kind: 'count', countKind: 'customer' };
const moneyPerCustomer: AnalysisUnit = {
  kind: 'currency-per-count',
  currency: CURRENCY,
  countKind: 'customer',
};
const monthlyMoneyPerCustomer: AnalysisUnit = {
  ...moneyPerCustomer,
  perPeriod: 'month',
};

const operand = (operandId: string): FormulaAst => ({ kind: 'operand', operandId });
const literal = (value: string): FormulaAst => ({ kind: 'literal', value });
const divide = (numerator: FormulaAst, denominator: FormulaAst): FormulaAst => ({
  kind: 'divide',
  numerator,
  denominator,
  rule: 'positive',
});

const currencyFlow = (
  operandId: string,
  options: Pick<FormulaOperandSpec, 'nonNegative' | 'notGreaterThanOperand'> = {},
): FormulaOperandSpec => ({
  operandId,
  metricId: operandId,
  expectedUnit: money,
  periodRole: 'flow',
  numericDomain: 'decimal',
  ...options,
});

export const formulaDefinitions: readonly FormulaDefinition[] = deepFreeze([
  {
    formulaId: 'gross_margin',
    version: '1',
    operands: [currencyFlow('revenue'), currencyFlow('cost_of_goods_sold')],
    outputUnit: { kind: 'ratio', rateKind: 'signed-rate' },
    periodRule: 'same-flow-period',
    direction: 'higher_is_better',
    ast: divide(
      { kind: 'subtract', left: operand('revenue'), right: operand('cost_of_goods_sold') },
      operand('revenue'),
    ),
  },
  {
    formulaId: 'ebitda_margin',
    version: '1',
    operands: [currencyFlow('ebitda'), currencyFlow('revenue')],
    outputUnit: { kind: 'ratio', rateKind: 'signed-rate' },
    periodRule: 'same-flow-period',
    direction: 'higher_is_better',
    ast: divide(operand('ebitda'), operand('revenue')),
  },
  {
    formulaId: 'free_cash_flow',
    version: '1',
    operands: [
      currencyFlow('operating_cash_flow'),
      currencyFlow('capital_expenditure', { nonNegative: true }),
    ],
    outputUnit: money,
    periodRule: 'same-flow-period',
    direction: 'higher_is_better',
    ast: {
      kind: 'subtract',
      left: operand('operating_cash_flow'),
      right: operand('capital_expenditure'),
    },
  },
  {
    formulaId: 'burn_multiple',
    version: '1',
    operands: [currencyFlow('net_cash_burn')],
    outputUnit: { kind: 'multiple' },
    outputNumericDomain: 'decimal',
    periodRule: 'same-flow-period',
    direction: 'lower_is_better',
    ast: divide(operand('net_cash_burn'), {
      kind: 'formula-ref',
      formulaId: 'net_new_arr',
      version: '1',
    }),
  },
  {
    formulaId: 'cac_payback_months',
    version: '1',
    operands: [
      {
        operandId: 'customer_acquisition_cost',
        metricId: 'customer_acquisition_cost',
        expectedUnit: moneyPerCustomer,
        periodRole: 'flow',
        numericDomain: 'decimal',
        nonNegative: true,
      },
      {
        operandId: 'monthly_gross_profit_per_new_customer',
        metricId: 'monthly_gross_profit_per_new_customer',
        expectedUnit: monthlyMoneyPerCustomer,
        periodRole: 'representative-month',
        numericDomain: 'decimal',
      },
    ],
    outputUnit: { kind: 'duration', durationUnit: 'months' },
    periodRule: 'same-flow-period',
    direction: 'lower_is_better',
    ast: divide(
      operand('customer_acquisition_cost'),
      operand('monthly_gross_profit_per_new_customer'),
    ),
  },
  {
    formulaId: 'cash_runway_months',
    version: '1',
    operands: [
      {
        operandId: 'cash_balance',
        metricId: 'cash_balance',
        expectedUnit: money,
        periodRole: 'as-of',
        numericDomain: 'decimal',
        nonNegative: true,
      },
      {
        operandId: 'monthly_net_cash_burn',
        metricId: 'monthly_net_cash_burn',
        expectedUnit: money,
        periodRole: 'representative-month',
        numericDomain: 'decimal',
      },
    ],
    outputUnit: { kind: 'duration', durationUnit: 'months' },
    periodRule: 'mixed-stock-flow',
    direction: 'higher_is_better',
    ast: divide(operand('cash_balance'), operand('monthly_net_cash_burn')),
  },
  {
    formulaId: 'revenue_cagr',
    version: '1',
    operands: [
      {
        operandId: 'beginning_revenue',
        metricId: 'beginning_revenue',
        expectedUnit: money,
        periodRole: 'as-of-begin',
        numericDomain: 'decimal',
      },
      {
        operandId: 'ending_revenue',
        metricId: 'ending_revenue',
        expectedUnit: money,
        periodRole: 'as-of-end',
        numericDomain: 'decimal',
        nonNegative: true,
      },
    ],
    outputUnit: { kind: 'ratio', rateKind: 'signed-rate' },
    periodRule: 'ordered-as-of-endpoints',
    direction: 'higher_is_better',
    ast: {
      kind: 'subtract',
      left: {
        kind: 'power',
        base: divide(operand('ending_revenue'), operand('beginning_revenue')),
        exponent: divide(literal('1'), operand('__duration_years')),
      },
      right: literal('1'),
    },
  },
  {
    formulaId: 'customer_concentration',
    version: '1',
    operands: [
      currencyFlow('concentrated_customer_revenue', {
        nonNegative: true,
        notGreaterThanOperand: 'total_revenue',
      }),
      currencyFlow('total_revenue'),
    ],
    outputUnit: { kind: 'ratio', rateKind: 'unit-interval' },
    periodRule: 'same-flow-period',
    direction: 'lower_is_better',
    ast: divide(operand('concentrated_customer_revenue'), operand('total_revenue')),
  },
  {
    formulaId: 'repeat_purchase_rate',
    version: '1',
    operands: [
      {
        operandId: 'repeat_customers',
        metricId: 'repeat_customers',
        expectedUnit: customerCount,
        periodRole: 'flow',
        numericDomain: 'decimal',
        nonNegative: true,
        notGreaterThanOperand: 'eligible_customers',
      },
      {
        operandId: 'eligible_customers',
        metricId: 'eligible_customers',
        expectedUnit: customerCount,
        periodRole: 'flow',
        numericDomain: 'decimal',
      },
    ],
    outputUnit: { kind: 'ratio', rateKind: 'unit-interval' },
    periodRule: 'same-flow-period',
    direction: 'higher_is_better',
    ast: divide(operand('repeat_customers'), operand('eligible_customers')),
  },
  {
    formulaId: 'nrr',
    version: '1',
    operands: [
      {
        operandId: 'opening_recurring_revenue',
        metricId: 'opening_recurring_revenue',
        expectedUnit: money,
        periodRole: 'as-of-begin',
        numericDomain: 'decimal',
      },
      currencyFlow('expansion_revenue', { nonNegative: true }),
      currencyFlow('contraction_revenue', { nonNegative: true }),
      currencyFlow('churned_revenue', { nonNegative: true }),
    ],
    outputUnit: { kind: 'ratio', rateKind: 'non-negative-rate' },
    periodRule: 'mixed-stock-flow',
    direction: 'higher_is_better',
    ast: divide(
      {
        kind: 'subtract',
        left: {
          kind: 'subtract',
          left: {
            kind: 'add',
            values: [operand('opening_recurring_revenue'), operand('expansion_revenue')],
          },
          right: operand('contraction_revenue'),
        },
        right: operand('churned_revenue'),
      },
      operand('opening_recurring_revenue'),
    ),
    constraints: [
      {
        kind: 'sum-lte-sum',
        left: ['contraction_revenue', 'churned_revenue'],
        right: ['opening_recurring_revenue', 'expansion_revenue'],
      },
    ],
  },
  {
    formulaId: 'ltv_cac',
    version: '1',
    operands: [
      {
        operandId: 'customer_lifetime_value',
        metricId: 'customer_lifetime_value',
        expectedUnit: moneyPerCustomer,
        periodRole: 'as-of',
        numericDomain: 'decimal',
        nonNegative: true,
      },
      {
        operandId: 'customer_acquisition_cost',
        metricId: 'customer_acquisition_cost',
        expectedUnit: moneyPerCustomer,
        periodRole: 'as-of',
        numericDomain: 'decimal',
      },
    ],
    outputUnit: { kind: 'multiple' },
    periodRule: 'same-as-of',
    direction: 'higher_is_better',
    ast: divide(operand('customer_lifetime_value'), operand('customer_acquisition_cost')),
  },
  {
    formulaId: 'inventory_turnover_days',
    version: '1',
    operands: [
      {
        operandId: 'beginning_inventory',
        metricId: 'beginning_inventory',
        expectedUnit: money,
        periodRole: 'as-of-begin',
        numericDomain: 'decimal',
        nonNegative: true,
      },
      {
        operandId: 'ending_inventory',
        metricId: 'ending_inventory',
        expectedUnit: money,
        periodRole: 'as-of-end',
        numericDomain: 'decimal',
        nonNegative: true,
      },
      currencyFlow('cost_of_goods_sold'),
    ],
    outputUnit: { kind: 'duration', durationUnit: 'days' },
    periodRule: 'mixed-stock-flow',
    direction: 'lower_is_better',
    ast: {
      kind: 'multiply',
      values: [
        divide(
          divide(
            { kind: 'add', values: [operand('beginning_inventory'), operand('ending_inventory')] },
            literal('2'),
          ),
          operand('cost_of_goods_sold'),
        ),
        operand('__period_days'),
      ],
    },
  },
  {
    formulaId: 'net_new_arr',
    version: '1',
    operands: [
      {
        operandId: 'beginning_arr',
        metricId: 'beginning_arr',
        expectedUnit: money,
        periodRole: 'as-of-begin',
        numericDomain: 'decimal',
        nonNegative: true,
      },
      {
        operandId: 'ending_arr',
        metricId: 'ending_arr',
        expectedUnit: money,
        periodRole: 'as-of-end',
        numericDomain: 'decimal',
        nonNegative: true,
      },
    ],
    outputUnit: money,
    periodRule: 'ordered-as-of-endpoints',
    direction: 'higher_is_better',
    ast: {
      kind: 'subtract',
      left: operand('ending_arr'),
      right: operand('beginning_arr'),
    },
  },
]);
