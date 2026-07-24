import { describe, expect, it } from 'vitest';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
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
  prepareFormulaObservations,
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
  return error as DomainContractError;
};

describe('prepareFormulaObservations', () => {
  it('returns frozen defensive normalized DTOs and fresh invalid_dto errors', () => {
    const source = [
      observation('revenue', '100', currencyUnit('USD'), FY2025, {
        sourceRefs: ['b', 'a'],
      }),
    ];
    const before = structuredClone(source);

    const prepared = prepareFormulaObservations(source);

    expect(source).toEqual(before);
    expect(prepared).toEqual([{
      ...before[0],
      sourceRefs: ['a', 'b'],
    }]);
    expect(prepared).not.toBe(source);
    expect(prepared[0]).not.toBe(source[0]);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared[0])).toBe(true);
    expect(Object.isFrozen(prepared[0]?.value)).toBe(true);
    expect(Object.isFrozen(prepared[0]?.value.unit)).toBe(true);
    expect(Object.isFrozen(prepared[0]?.period)).toBe(true);
    expect(Object.isFrozen(prepared[0]?.sourceRefs)).toBe(true);
    expect(Object.isFrozen(prepared[0]?.conflict)).toBe(true);

    (source[0]!.sourceRefs as string[]).push('later');
    expect(prepared[0]?.sourceRefs).toEqual(['a', 'b']);

    const malformed = [{ valueRef: 'orphan', extra: true }];
    const first = expectInvalidDto(() => prepareFormulaObservations(malformed));
    const second = expectInvalidDto(() => prepareFormulaObservations(malformed));
    expect(first).not.toBe(second);
  });
});

describe('validateFormulaInputs', () => {
  it('orders validated inputs and references by the formula definition', () => {
    const result = validateFormulaInputs(definition('gross_margin'), [
      observation('cost_of_goods_sold', '40', currencyUnit('USD'), FY2025, {
        sourceRefs: ['\u{1F600}', 'a', 'B', '\uE000', 'aa', 'a'],
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
    expect(result.inputs[1]?.observation.sourceRefs).toEqual([
      'B', 'a', 'a', 'aa', '\uE000', '\u{1F600}',
    ]);
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

  it.each([
    ['unit-interval', '-0.1', 'value_out_of_range'],
    ['unit-interval', '1.1', 'value_out_of_range'],
    ['non-negative-rate', '-0.1', 'value_out_of_range'],
    ['signed-rate', '-2', undefined],
    ['multiple', '-0.1', 'value_out_of_range'],
  ] as const)('uses the existing %s parser semantics for %s', (
    numericDomain,
    value,
    expectedIssue,
  ) => {
    const base = definition('gross_margin');
    const custom = {
      ...base,
      operands: [{ ...base.operands[0]!, numericDomain }],
    } as FormulaDefinition;
    expect(issueCode(validateFormulaInputs(
      custom,
      [observation('revenue', value)],
    ))).toBe(expectedIssue);
  });

  it('keeps invalid decimal format ahead of numeric domain range parsing', () => {
    const base = definition('gross_margin');
    const custom = {
      ...base,
      operands: [{ ...base.operands[0]!, numericDomain: 'unit-interval' }],
    } as FormulaDefinition;
    expect(issueCode(validateFormulaInputs(
      custom,
      [observation('revenue', '01')],
    ))).toBe('invalid_decimal');
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

  it.each([
    ['2025-01-31', '2025-02-01', '2025-02-01', 0, 1, 28],
    ['2024-12-31', '2025-01-01', '2025-01-01', 0, 1, 31],
    ['2024-02-29', '2024-03-01', '2024-03-01', 0, 1, 29],
    ['2025-01-15', '2025-02-15', '2025-01-16', 1, 0, 28],
    ['2025-01-15', '2025-02-20', '2025-01-16', 1, 5, 28],
    ['2024-01-15', '2025-01-15', '2024-01-16', 12, 0, 31],
  ] as const)(
    'derives clamped calendar duration from %s to %s',
    (beginDate, endDate, startDate, wholeMonths, fractionalDays, intervalDays) => {
      const months = canonicalDecimal(
        new AnalysisDecimal(wholeMonths).plus(
          new AnalysisDecimal(fractionalDays).dividedBy(intervalDays),
        ),
      );
      const expectedYears = canonicalDecimal(
        new AnalysisDecimal(months).dividedBy(12),
      );
      const result = validateFormulaInputs(definition('revenue_cagr'), [
        observation('beginning_revenue', '100', currencyUnit(), {
          kind: 'as-of', id: 'BEGIN', date: beginDate,
        }),
        observation('ending_revenue', '120', currencyUnit(), {
          kind: 'as-of', id: 'END', date: endDate,
        }),
      ]);
      expect(result).toMatchObject({
        status: 'valid',
        derivedOperands: { __duration_years: expectedYears },
        effectivePeriod: {
          kind: 'span',
          startDate,
          endDate,
          durationMonths: new AnalysisDecimal(months).toNumber(),
        },
      });
    },
  );

  it('rejects equal ordered endpoints as period_mismatch', () => {
    const same = { kind: 'as-of' as const, id: 'SAME', date: '2025-01-15' };
    expect(issueCode(validateFormulaInputs(definition('revenue_cagr'), [
      observation('beginning_revenue', '100', currencyUnit(), same),
      observation('ending_revenue', '120', currencyUnit(), same),
    ]))).toBe('period_mismatch');
  });
  it('accepts ordered non-boundary endpoints and derives one twelfth year', () => {
    const expectedYears = canonicalDecimal(new AnalysisDecimal(1).dividedBy(12));
    const result = validateFormulaInputs(definition('revenue_cagr'), [
      observation('beginning_revenue', '100', currencyUnit(), {
        kind: 'as-of', id: 'BEGIN', date: '2025-01-15',
      }),
      observation('ending_revenue', '120', currencyUnit(), {
        kind: 'as-of', id: 'END', date: '2025-02-15',
      }),
    ]);
    expect(result).toMatchObject({
      status: 'valid',
      derivedOperands: { __duration_years: expectedYears },
      effectivePeriod: {
        kind: 'span',
        startDate: '2025-01-16',
        endDate: '2025-02-15',
        durationMonths: 1,
      },
    });
  });

  it('derives a longer ordered non-month-end span by calendar month distance', () => {
    const expectedYears = canonicalDecimal(new AnalysisDecimal(4).dividedBy(12));
    const result = validateFormulaInputs(definition('revenue_cagr'), [
      observation('beginning_revenue', '100', currencyUnit(), {
        kind: 'as-of', id: 'BEGIN', date: '2024-11-10',
      }),
      observation('ending_revenue', '120', currencyUnit(), {
        kind: 'as-of', id: 'END', date: '2025-03-10',
      }),
    ]);
    expect(result).toMatchObject({
      status: 'valid',
      derivedOperands: { __duration_years: expectedYears },
      effectivePeriod: {
        kind: 'span',
        startDate: '2024-11-11',
        endDate: '2025-03-10',
        durationMonths: 4,
      },
    });
  });
  it('supports an arbitrary positive continuous endpoint span', () => {
    const months = canonicalDecimal(
      new AnalysisDecimal(18).plus(new AnalysisDecimal(1).dividedBy(31)),
    );
    const result = validateFormulaInputs(definition('revenue_cagr'), [
      observation('beginning_revenue', '100', currencyUnit(), { kind: 'as-of', id: 'BEGIN', date: '2024-06-30' }),
      observation('ending_revenue', '120', currencyUnit(), FY2025_END),
    ]);
    expect(result).toMatchObject({
      status: 'valid',
      derivedOperands: {
        __duration_years: canonicalDecimal(new AnalysisDecimal(months).dividedBy(12)),
      },
      effectivePeriod: { durationMonths: new AnalysisDecimal(months).toNumber() },
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

  it.each(['none', 'resolved', 'blocking'] as const)(
    'rejects selectionReason on %s conflicts',
    (status) => {
      const source = domainObservations('gross_margin') as unknown[];
      source[0] = {
        ...source[0] as object,
        conflict: { status, selectionReason: 'not allowed' },
      };
      expectInvalidDto(() => validateFormulaInputs(definition('gross_margin'), source));
    },
  );
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

  it('memoizes shared aliases before enforcing the unique-node budget', () => {
    let reflectionCount = 0;
    const sharedUnit = new Proxy(currencyUnit(), {
      getPrototypeOf: (target) => {
        reflectionCount += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys: (target) => {
        reflectionCount += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor: (target, key) => {
        reflectionCount += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const sharedPeriod = FY2025;
    const sharedSourceRefs = ['shared-evidence'];
    const sharedConflict = { status: 'none' as const };
    const sharedObservation = (metricId: string, value: string) => ({
      valueRef: `${metricId}:FY2025`,
      metricId,
      value: { value, unit: sharedUnit },
      period: sharedPeriod,
      sourceRefs: sharedSourceRefs,
      conflict: sharedConflict,
    });
    const extras = Array.from({ length: 700 }, (_, index) =>
      sharedObservation(`extra_${index}`, String(index)),
    );

    const result = validateFormulaInputs(definition('gross_margin'), [
      sharedObservation('revenue', '100'),
      sharedObservation('cost_of_goods_sold', '40'),
      ...extras,
    ]);

    expect(result).toMatchObject({ status: 'valid' });
    expect(reflectionCount).toBe(4);
    if (result.status !== 'valid') throw new Error('expected valid');
    expect(result.inputs[0]?.observation.value.unit).not.toBe(sharedUnit);
  });
  it('preserves and rejects an enumerable own __proto__ field without pollution', () => {
    const hostile = observation('revenue', '1') as unknown as Record<string, unknown>;
    const originalPrototype = Object.getPrototypeOf(hostile);
    Object.defineProperty(hostile, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });

    const first = expectInvalidDto(() =>
      validateFormulaInputs(definition('gross_margin'), [hostile]),
    );
    const second = expectInvalidDto(() =>
      validateFormulaInputs(definition('gross_margin'), [hostile]),
    );
    expect(first).not.toBe(second);
    expect(Object.getPrototypeOf(hostile)).toBe(originalPrototype);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
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

  it('accepts a cash balance immediately before the representative burn month', () => {
    const balance = { kind: 'as-of' as const, id: 'JAN2025_END', date: '2025-01-31' };
    const february = {
      kind: 'flow' as const,
      id: 'FEB2025',
      startDate: '2025-02-01',
      endDate: '2025-02-28',
      durationMonths: 1,
      granularity: 'month' as const,
    };
    const result = validateFormulaInputs(definition('cash_runway_months'), [
      observation('monthly_net_cash_burn', '10', currencyUnit(), february),
      observation('cash_balance', '120', currencyUnit(), balance),
    ]);

    expect(result).toMatchObject({
      status: 'valid',
      currency: 'CNY',
      effectivePeriod: {
        kind: 'span',
        startDate: '2025-02-01',
        endDate: '2025-02-28',
        durationMonths: 1,
      },
      periodRefs: ['JAN2025_END', 'FEB2025'],
    });
    if (result.status !== 'valid') throw new Error('expected valid');
    expect(result.inputs.map((input) => input.spec.operandId)).toEqual([
      'cash_balance',
      'monthly_net_cash_burn',
    ]);
  });

  it.each([
    ['two-day gap', '2025-01-30', {
      kind: 'flow' as const, id: 'FEB2025',
      startDate: '2025-02-01', endDate: '2025-02-28',
      durationMonths: 1, granularity: 'month' as const,
    }],
    ['balance inside burn period', '2025-02-01', {
      kind: 'flow' as const, id: 'FEB2025',
      startDate: '2025-02-01', endDate: '2025-02-28',
      durationMonths: 1, granularity: 'month' as const,
    }],
    ['non-month representative flow', '2024-12-31', FY2025],
  ] as const)('rejects cash runway period relation: %s', (_label, balanceDate, burnPeriod) => {
    const result = validateFormulaInputs(definition('cash_runway_months'), [
      observation('cash_balance', '120', currencyUnit(), {
        kind: 'as-of', id: 'BALANCE', date: balanceDate,
      }),
      observation('monthly_net_cash_burn', '10', currencyUnit(), burnPeriod),
    ]);
    expect(issueCode(result)).toBe('period_mismatch');
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
