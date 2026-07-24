import { describe, expect, it } from 'vitest';
import { DomainContractError } from '../../domain/analysis/value';
import { getFormulaDefinition } from './formula-registry';
import type { FormulaDefinition } from './formula-types';
import {
  customerCountUnit,
  customerMoneyUnit,
  currencyUnit,
  FY2025,
  FY2025_BEGIN,
  FY2025_END,
  JAN2025,
  observation,
} from './formula-test-fixtures';
import {
  validateFormulaInputs,
  validateFormulaInputStage,
} from './validate-formula-inputs';

const definition = (id: Parameters<typeof getFormulaDefinition>[0]) =>
  getFormulaDefinition(id, '1') as FormulaDefinition;

const issueCode = (result: ReturnType<typeof validateFormulaInputs>) =>
  result.status === 'blocked' ? result.issue.code : undefined;

const expectInvalidDto = (run: () => unknown) => {
  let error: unknown;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(DomainContractError);
  expect((error as DomainContractError).code).toBe('invalid_dto');
};

describe('validateFormulaInputs', () => {
  it('orders validated inputs and references by the formula definition', () => {
    const result = validateFormulaInputs(definition('gross_margin'), [
      observation('cost_of_goods_sold', '40', currencyUnit('USD'), FY2025, {
        sourceRefs: ['a', 'B'],
      }),
      observation('unused', '9'),
      observation('revenue', '100', currencyUnit('USD')),
    ]);

    expect(result).toMatchObject({
      status: 'valid',
      currency: 'USD',
      periodRefs: ['FY2025'],
      effectivePeriod: {
        kind: 'span', startDate: '2025-01-01', endDate: '2025-12-31', durationMonths: 12,
      },
    });
    if (result.status !== 'valid') throw new Error('expected valid');
    expect(result.inputs.map((input) => input.spec.operandId)).toEqual([
      'revenue', 'cost_of_goods_sold',
    ]);
    expect(result.inputs[1]?.observation.sourceRefs).toEqual(['B', 'a']);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('returns missing_input before malformed decimals, units, or periods', () => {
    const malformed = observation('cost_of_goods_sold', '01', { kind: 'multiple' }, {
      ...FY2025,
      endDate: 'bad',
    });
    const result = validateFormulaInputs(definition('gross_margin'), [malformed]);

    expect(result).toMatchObject({
      status: 'blocked', reason: 'insufficient-data', issue: { code: 'missing_input' },
    });
  });

  it('scans all decimal formats before range constraints', () => {
    const result = validateFormulaInputs(definition('customer_concentration'), [
      observation('concentrated_customer_revenue', '-1'),
      observation('total_revenue', '01'),
    ]);
    expect(issueCode(result)).toBe('invalid_decimal');
  });

  it.each([
    ['decimal', '-2'],
    ['unit-interval', '0'],
    ['unit-interval', '1'],
    ['non-negative-rate', '0'],
    ['signed-rate', '-2'],
    ['multiple', '0'],
  ] as const)('accepts the %s numeric domain boundary %s', (numericDomain, value) => {
    const base = definition('gross_margin');
    const custom = {
      ...base,
      operands: [{ ...base.operands[0]!, numericDomain }],
    } as FormulaDefinition;
    expect(validateFormulaInputs(custom, [observation('revenue', value)])).toMatchObject({
      status: 'valid',
    });
  });

  it('enforces non-negative and not-greater-than operand rules', () => {
    expect(issueCode(validateFormulaInputs(definition('free_cash_flow'), [
      observation('operating_cash_flow', '1'), observation('capital_expenditure', '-1'),
    ]))).toBe('value_out_of_range');
    expect(issueCode(validateFormulaInputs(definition('customer_concentration'), [
      observation('concentrated_customer_revenue', '101'), observation('total_revenue', '100'),
    ]))).toBe('value_out_of_range');
  });

  it('enforces unit-interval, non-negative-rate, and multiple ranges', () => {
    const custom = (numericDomain: 'unit-interval' | 'non-negative-rate' | 'multiple') => ({
      ...definition('gross_margin'),
      operands: [{
        ...definition('gross_margin').operands[0], numericDomain,
      }],
    }) as FormulaDefinition;
    expect(issueCode(validateFormulaInputs(custom('unit-interval'), [observation('revenue', '1.1')]))).toBe('value_out_of_range');
    expect(issueCode(validateFormulaInputs(custom('non-negative-rate'), [observation('revenue', '-0.1')]))).toBe('value_out_of_range');
    expect(issueCode(validateFormulaInputs(custom('multiple'), [observation('revenue', '-0.1')]))).toBe('value_out_of_range');
  });

  it('enforces the NRR sum constraint with decimal arithmetic', () => {
    const source = domainObservations('nrr').map((item) =>
      item.metricId === 'contraction_revenue' ? observation(item.metricId, '80') : item.metricId === 'churned_revenue' ? observation(item.metricId, '31') : item,
    );
    expect(issueCode(validateFormulaInputs(definition('nrr'), source))).toBe('value_out_of_range');
  });

  it('uses unit, currency, then period mismatch priority', () => {
    const badUnitAndCurrency = [
      observation('revenue', '100', { kind: 'count', countKind: 'customer' }, JAN2025),
      observation('cost_of_goods_sold', '40', currencyUnit('USD'), FY2025),
    ];
    expect(issueCode(validateFormulaInputs(definition('gross_margin'), badUnitAndCurrency))).toBe('unit_mismatch');

    const badCurrencyAndPeriod = [
      observation('revenue', '100', currencyUnit('CNY'), JAN2025),
      observation('cost_of_goods_sold', '40', currencyUnit('USD'), FY2025),
    ];
    expect(issueCode(validateFormulaInputs(definition('gross_margin'), badCurrencyAndPeriod))).toBe('currency_mismatch');
  });

  it('compares count kind and currency-per-count per-period structure', () => {
    const repeat = domainObservations('repeat_purchase_rate');
    repeat[0] = observation('repeat_customers', '2', { kind: 'count', countKind: 'user' });
    expect(issueCode(validateFormulaInputs(definition('repeat_purchase_rate'), repeat))).toBe('unit_mismatch');

    const cac = domainObservations('cac_payback_months');
    cac[1] = observation('monthly_gross_profit_per_new_customer', '10', customerMoneyUnit('CNY', 'year'), JAN2025);
    expect(issueCode(validateFormulaInputs(definition('cac_payback_months'), cac))).toBe('unit_mismatch');
  });

  it('rejects wrong representative month, reversed CAGR, and wrong inventory end', () => {
    expect(issueCode(validateFormulaInputs(definition('cac_payback_months'), [
      observation('customer_acquisition_cost', '100', customerMoneyUnit(), FY2025),
      observation('monthly_gross_profit_per_new_customer', '10', customerMoneyUnit('CNY', 'month'), FY2025),
    ]))).toBe('period_mismatch');
    expect(issueCode(validateFormulaInputs(definition('revenue_cagr'), [
      observation('beginning_revenue', '100', currencyUnit(), FY2025_END),
      observation('ending_revenue', '120', currencyUnit(), FY2025_BEGIN),
    ]))).toBe('period_mismatch');
    expect(issueCode(validateFormulaInputs(definition('inventory_turnover_days'), [
      observation('beginning_inventory', '10', currencyUnit(), FY2025_BEGIN),
      observation('ending_inventory', '20', currencyUnit(), { ...FY2025_END, date: '2025-12-30' }),
      observation('cost_of_goods_sold', '100'),
    ]))).toBe('period_mismatch');
  });

  it('derives exact CAGR years and inventory inclusive days', () => {
    const cagr = validateFormulaInputs(definition('revenue_cagr'), domainObservations('revenue_cagr'));
    expect(cagr).toMatchObject({
      status: 'valid', derivedOperands: { __duration_years: '1' },
      effectivePeriod: { kind: 'span', startDate: '2025-01-01', endDate: '2025-12-31', durationMonths: 12 },
    });
    const inventory = validateFormulaInputs(definition('inventory_turnover_days'), domainObservations('inventory_turnover_days'));
    expect(inventory).toMatchObject({ status: 'valid', derivedOperands: { __period_days: '365' } });
  });

  it('supports an arbitrary positive continuous endpoint span', () => {
    const result = validateFormulaInputs(definition('revenue_cagr'), [
      observation('beginning_revenue', '100', currencyUnit(), { kind: 'as-of', id: 'BEGIN', date: '2024-06-30' }),
      observation('ending_revenue', '120', currencyUnit(), FY2025_END),
    ]);
    expect(result).toMatchObject({
      status: 'valid', derivedOperands: { __duration_years: '1.5' },
      effectivePeriod: { durationMonths: 18 },
    });
  });

  it('returns conservative conflict warnings and blocks blocking conflicts', () => {
    const conservative = domainObservations('gross_margin') as unknown[];
    conservative[0] = {
      ...conservative[0] as object,
      conflict: { status: 'conservative-selected', selectionReason: 'lower verified source' },
    };
    const result = validateFormulaInputs(definition('gross_margin'), conservative);
    expect(result).toMatchObject({
      status: 'valid', warnings: [{ code: 'unresolved_conflict', details: { selectionReason: 'lower verified source' } }],
    });

    const blocking = domainObservations('gross_margin') as unknown[];
    blocking[0] = { ...blocking[0] as object, conflict: { status: 'blocking' } };
    expect(validateFormulaInputs(definition('gross_margin'), blocking)).toMatchObject({
      status: 'blocked', reason: 'invalid-input', issue: { code: 'unresolved_conflict' },
    });
  });

  it.each([
    {},
    { selectionReason: '' },
  ])('rejects missing or empty conservative selectionReason structurally', (extra) => {
    const source = domainObservations('gross_margin') as unknown[];
    source[0] = {
      ...source[0] as object,
      conflict: { status: 'conservative-selected', ...extra },
    };
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), source));
  });

  it('rejects duplicate metrics and hostile DTO shapes without executing getters', () => {
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), [
      observation('revenue', '1'), observation('revenue', '2'),
    ]));
    const sparse = new Array(1);
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), sparse));
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), Object.create([])));
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), [new (class Observation {})()]));
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), [Object.create(observation('revenue', '1'))]));

    let getterCalls = 0;
    const hostile = observation('revenue', '1') as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, 'metricId', { enumerable: true, get: () => { getterCalls += 1; return 'revenue'; } });
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), [hostile]));
    expect(getterCalls).toBe(0);
  });

  it('normalizes proxy reflection errors and rejects cycles and symbols', () => {
    const proxy = new Proxy({}, { ownKeys: () => { throw new RangeError('trap'); } });
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), [proxy]));
    const cyclic = observation('revenue', '1') as unknown as Record<string, unknown>;
    cyclic.label = cyclic;
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), [cyclic]));
    const symbolled = observation('revenue', '1') as unknown as Record<PropertyKey, unknown>;
    symbolled[Symbol('x')] = 'x';
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), [symbolled]));
  });

  it('does not mutate or freeze caller data and returns defensive copies', () => {
    const source = domainObservations('gross_margin');
    const before = structuredClone(source);
    const result = validateFormulaInputs(definition('gross_margin'), source);
    expect(source).toEqual(before);
    expect(Object.isFrozen(source)).toBe(false);
    if (result.status !== 'valid') throw new Error('expected valid');
    expect(result.inputs[0]?.observation).not.toBe(source[0]);
    (source[0]!.sourceRefs as string[]).push('later');
    expect(result.inputs[0]?.observation.sourceRefs).not.toContain('later');
  });
  it('keeps range ahead of unit and decimal ahead of blocking conflict', () => {
    const rangeFirst = [
      observation('concentrated_customer_revenue', '-1', { kind: 'multiple' }),
      observation('total_revenue', '100'),
    ];
    expect(issueCode(validateFormulaInputs(
      definition('customer_concentration'),
      rangeFirst,
    ))).toBe('value_out_of_range');

    const decimalFirst = domainObservations('gross_margin');
    decimalFirst[0] = observation('revenue', '01', currencyUnit(), FY2025, {
      conflict: { status: 'blocking' },
    });
    expect(issueCode(validateFormulaInputs(
      definition('gross_margin'),
      decimalFirst,
    ))).toBe('invalid_decimal');
  });

  it('validates same-as-of and mixed stock-flow periods defensively', () => {
    const sameAsOf = validateFormulaInputs(definition('ltv_cac'), [
      observation('customer_lifetime_value', '300', customerMoneyUnit('USD'), FY2025_END),
      observation('customer_acquisition_cost', '100', customerMoneyUnit('USD'), FY2025_END),
    ]);
    expect(sameAsOf).toMatchObject({
      status: 'valid',
      currency: 'USD',
      effectivePeriod: FY2025_END,
      periodRefs: ['FY2025_END'],
    });
    if (sameAsOf.status !== 'valid') throw new Error('expected valid');
    expect(sameAsOf.effectivePeriod).not.toBe(FY2025_END);

    const monthEnd = { kind: 'as-of' as const, id: 'JAN2025_END', date: '2025-01-31' };
    const mixed = validateFormulaInputs(definition('cash_runway_months'), [
      observation('cash_balance', '120', currencyUnit(), monthEnd),
      observation('monthly_net_cash_burn', '10', currencyUnit(), JAN2025),
    ]);
    expect(mixed).toMatchObject({
      status: 'valid',
      effectivePeriod: {
        kind: 'span',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        durationMonths: 1,
      },
    });
  });

  it('rejects non-array top-level observations', () => {
    expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), {}));
  });

});

describe('validateFormulaInputStage', () => {
  it('does not cross into earlier or later validation stages', () => {
    const badDecimal = [
      observation('revenue', '01'),
      observation('cost_of_goods_sold', '40'),
    ];
    expect(validateFormulaInputStage(
      definition('gross_margin'),
      badDecimal,
      'missing',
    )).toEqual({ status: 'continue' });
    expect(validateFormulaInputStage(
      definition('gross_margin'),
      badDecimal,
      'unit-currency-period',
    )).toEqual({ status: 'continue' });

    const badUnit = [
      observation('revenue', '100', { kind: 'multiple' }),
      observation('cost_of_goods_sold', '40'),
    ];
    expect(validateFormulaInputStage(
      definition('gross_margin'),
      badUnit,
      'decimal-range',
    )).toEqual({ status: 'continue' });
  });

  it('only reports issues belonging to the requested stage', () => {
    const partial = [observation('cost_of_goods_sold', '01', { kind: 'multiple' }, { ...FY2025, endDate: 'bad' })];
    expect(validateFormulaInputStage(definition('gross_margin'), partial, 'missing')).toMatchObject({
      status: 'blocked', issue: { code: 'missing_input' },
    });
    expect(validateFormulaInputStage(definition('gross_margin'), partial, 'decimal-range')).toMatchObject({
      status: 'blocked', issue: { code: 'invalid_decimal' },
    });
    expect(validateFormulaInputStage(definition('gross_margin'), partial, 'unit-currency-period')).toMatchObject({
      status: 'blocked', issue: { code: 'unit_mismatch' },
    });
  });
});

function domainObservations(id: Parameters<typeof getFormulaDefinition>[0]) {
  switch (id) {
    case 'gross_margin':
      return [observation('revenue', '100'), observation('cost_of_goods_sold', '40')];
    case 'free_cash_flow':
      return [observation('operating_cash_flow', '10'), observation('capital_expenditure', '2')];
    case 'burn_multiple':
      return [observation('net_cash_burn', '2')];
    case 'cac_payback_months':
      return [
        observation('customer_acquisition_cost', '100', customerMoneyUnit(), JAN2025),
        observation('monthly_gross_profit_per_new_customer', '10', customerMoneyUnit('CNY', 'month'), JAN2025),
      ];
    case 'revenue_cagr':
      return [
        observation('beginning_revenue', '100', currencyUnit(), FY2025_BEGIN),
        observation('ending_revenue', '120', currencyUnit(), FY2025_END),
      ];
    case 'repeat_purchase_rate':
      return [
        observation('repeat_customers', '2', customerCountUnit),
        observation('eligible_customers', '10', customerCountUnit),
      ];
    case 'nrr':
      return [
        observation('opening_recurring_revenue', '100', currencyUnit(), FY2025_BEGIN),
        observation('expansion_revenue', '10'),
        observation('contraction_revenue', '5'),
        observation('churned_revenue', '4'),
      ];
    case 'inventory_turnover_days':
      return [
        observation('beginning_inventory', '10', currencyUnit(), FY2025_BEGIN),
        observation('ending_inventory', '20', currencyUnit(), FY2025_END),
        observation('cost_of_goods_sold', '100'),
      ];
    case 'ebitda_margin':
      return [observation('ebitda', '10'), observation('revenue', '100')];
    default:
      throw new Error(`missing fixture for ${id}`);
  }
}
