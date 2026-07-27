import { describe, expect, expectTypeOf, it } from 'vitest';
import { DomainContractError } from '../../domain/analysis/value';
import {
  createFormulaEvaluationSession,
  evaluateMetric,
  type FormulaEvaluationSession,
  type FormulaSuccess,
} from './evaluate-metric';
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
import type { FormulaEngineResult, FormulaObservation, MetricCalculation } from './formula-types';

const evaluate = (
  formulaId: string,
  observations: readonly FormulaObservation[],
  version = '1',
) => evaluateMetric({ formulaId, version, observations });

const expectDomainError = (
  run: () => unknown,
  code: DomainContractError['code'],
): DomainContractError => {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainContractError);
  expect((thrown as DomainContractError).code).toBe(code);
  return thrown as DomainContractError;
};

const expectBlocked = (
  result: FormulaEngineResult<MetricCalculation>,
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  code: string,
) => {
  expect(result).toMatchObject({ status: 'blocked', reason, issues: [{ code }] });
  if (result.status !== 'blocked') throw new Error('expected blocked result');
  expect(result.issues).toHaveLength(1);
  return result;
};

const burnObservations = (
  netCashBurn = '80',
  beginningArr = '100',
  endingArr = '180',
  rootCurrency = 'CNY',
  dependencyCurrency = rootCurrency,
  dependencyEnd = FY2025_END,
): readonly FormulaObservation[] => [
  observation('net_cash_burn', netCashBurn, currencyUnit(rootCurrency)),
  observation('beginning_arr', beginningArr, currencyUnit(dependencyCurrency), FY2025_BEGIN),
  observation('ending_arr', endingArr, currencyUnit(dependencyCurrency), dependencyEnd),
];

const roundTripObservations = (
  observations: readonly FormulaObservation[],
): FormulaObservation[] =>
  JSON.parse(JSON.stringify(observations)) as FormulaObservation[];

const expandedExtraObservations = (count: number): FormulaObservation[] =>
  Array.from({ length: count }, (_, index) =>
    observation(`expanded_${index}`, String(index + 1), currencyUnit(), FY2025, {
      valueRef: `expanded_${index}:FY2025`,
    })
  );

describe('evaluateMetric', () => {
  it.each([
    [
      'gross margin',
      'gross_margin',
      [observation('revenue', '100'), observation('cost_of_goods_sold', '40')],
      '0.6',
      { kind: 'ratio', rateKind: 'signed-rate' },
    ],
    [
      'gross margin permits negative COGS',
      'gross_margin',
      [observation('revenue', '100'), observation('cost_of_goods_sold', '-20')],
      '1.2',
      { kind: 'ratio', rateKind: 'signed-rate' },
    ],
    [
      'negative EBITDA margin',
      'ebitda_margin',
      [observation('ebitda', '-10'), observation('revenue', '100')],
      '-0.1',
      { kind: 'ratio', rateKind: 'signed-rate' },
    ],
    [
      'free cash flow',
      'free_cash_flow',
      [observation('operating_cash_flow', '50'), observation('capital_expenditure', '12')],
      '38',
      { kind: 'currency', currency: 'CNY' },
    ],
    [
      'CAC payback',
      'cac_payback_months',
      [
        observation('customer_acquisition_cost', '1200', customerMoneyUnit(), JAN2025),
        observation('monthly_gross_profit_per_new_customer', '200', customerMoneyUnit('CNY', 'month'), JAN2025),
      ],
      '6',
      { kind: 'duration', durationUnit: 'months' },
    ],
    [
      'customer concentration',
      'customer_concentration',
      [observation('concentrated_customer_revenue', '25'), observation('total_revenue', '100')],
      '0.25',
      { kind: 'ratio', rateKind: 'unit-interval' },
    ],
    [
      'repeat purchase rate',
      'repeat_purchase_rate',
      [
        observation('repeat_customers', '30', customerCountUnit),
        observation('eligible_customers', '100', customerCountUnit),
      ],
      '0.3',
      { kind: 'ratio', rateKind: 'unit-interval' },
    ],
  ] as const)('evaluates %s with canonical value, unit, and trace metadata', (
    _label,
    formulaId,
    observations,
    expectedValue,
    expectedUnit,
  ) => {
    const result = evaluate(formulaId, observations);

    expect(result).toMatchObject({
      status: 'ok',
      value: {
        formulaId,
        version: '1',
        value: { value: expectedValue, unit: expectedUnit },
      },
      trace: {
        engine: 'formula',
        formulaRef: `${formulaId}@1`,
        output: { value: expectedValue, unit: expectedUnit },
      },
    });
    if (result.status !== 'ok') throw new Error('expected ok result');
    expect(result.trace.inputs.map((input) => input.valueRef)).toEqual(
      [...observations].map((item) => item.valueRef).sort(),
    );
    expect(result.trace.steps.every((step) => step.id.startsWith(`${formulaId}@1:`))).toBe(true);
  });

  it.each([
    ['burning cash', '80', '100', '180', '1'],
    ['cash-generative', '-20', '100', '150', '-0.4'],
  ] as const)('evaluates burn multiple through net_new_arr for %s', (
    _label,
    netCashBurn,
    beginningArr,
    endingArr,
    value,
  ) => {
    const result = evaluate('burn_multiple', burnObservations(netCashBurn, beginningArr, endingArr));

    expect(result).toMatchObject({
      status: 'ok',
      value: {
        formulaId: 'burn_multiple',
        value: { value, unit: { kind: 'multiple' } },
      },
      trace: { formulaRef: 'burn_multiple@1', output: { value } },
    });
    if (result.status !== 'ok') throw new Error('expected ok result');
    expect(result.trace.steps.some((step) => step.id.startsWith('net_new_arr@1:'))).toBe(true);
    expect(result.trace.steps.at(-1)?.id).toMatch(/^burn_multiple@1:/);
  });

  it.each([
    ['currency', burnObservations('80', '100', '180', 'CNY', 'USD'), 'currency_mismatch'],
    [
      'period',
      [
        observation('net_cash_burn', '80'),
        observation('beginning_arr', '100', currencyUnit(), { kind: 'as-of', id: 'FY2024_BEGIN', date: '2023-12-31' }),
        observation('ending_arr', '180', currencyUnit(), { kind: 'as-of', id: 'FY2024_END', date: '2024-12-31' }),
      ],
      'period_mismatch',
    ],
  ] as const)('rejects burn dependency %s metadata mismatch', (_label, observations, code) => {
    expectBlocked(evaluate('burn_multiple', observations), 'invalid-input', code);
  });

  it('blocks known unsupported versions and throws for unknown formula ids', () => {
    const unsupported = evaluate('gross_margin', [], '2');
    expectBlocked(unsupported, 'invalid-input', 'unsupported_formula');
    expect(unsupported.trace).toEqual({
      engine: 'formula', formulaRef: 'gross_margin@2', inputs: [], steps: [],
    });
    expectDomainError(() => evaluate('not_registered', []), 'unknown_formula');
  });

  it.each([
    ['null request', null],
    ['non-string formula id', { formulaId: 1, version: '1', observations: [] }],
    ['non-string version', { formulaId: 'gross_margin', version: 1, observations: [] }],
    ['non-array observations', { formulaId: 'gross_margin', version: '1', observations: {} }],
    ['extra request field', { formulaId: 'gross_margin', version: '1', observations: [], extra: true }],
  ])('throws a fresh invalid_dto for %s', (_label, input) => {
    const first = expectDomainError(() => evaluateMetric(input as never), 'invalid_dto');
    const second = expectDomainError(() => evaluateMetric(input as never), 'invalid_dto');
    expect(first).not.toBe(second);
  });

  it('rejects duplicate valueRef identities before evaluating a metric', () => {
    const observations = [
      observation('revenue', '100', currencyUnit(), FY2025, { valueRef: 'collision' }),
      observation('cost_of_goods_sold', '40', currencyUnit(), FY2025, {
        valueRef: 'collision',
      }),
    ];

    const first = expectDomainError(
      () => evaluateMetric({ formulaId: 'gross_margin', version: '1', observations }),
      'invalid_dto',
    );
    const second = expectDomainError(
      () => evaluateMetric({ formulaId: 'gross_margin', version: '1', observations }),
      'invalid_dto',
    );
    expect(first).not.toBe(second);
  });

  it.each([
    [
      'gross margin zero revenue',
      'gross_margin',
      [observation('revenue', '0'), observation('cost_of_goods_sold', '0')],
      'division_by_zero',
    ],
    ['burn zero ARR', 'burn_multiple', burnObservations('80', '100', '100'), 'division_by_zero'],
    ['burn negative ARR', 'burn_multiple', burnObservations('80', '180', '100'), 'non_positive_denominator'],
    [
      'CAC zero monthly profit',
      'cac_payback_months',
      [
        observation('customer_acquisition_cost', '1200', customerMoneyUnit(), JAN2025),
        observation('monthly_gross_profit_per_new_customer', '0', customerMoneyUnit('CNY', 'month'), JAN2025),
      ],
      'division_by_zero',
    ],
  ] as const)('blocks a not-meaningful denominator: %s', (_label, formulaId, observations, code) => {
    const result = expectBlocked(evaluate(formulaId, observations), 'not-meaningful', code);
    expect(result.trace.steps.at(-1)).toMatchObject({ outcome: 'blocked' });
  });

  it('applies global root-first stage priority across the full dependency closure', () => {
    const result = evaluate('burn_multiple', [
      observation('beginning_arr', 'abc', currencyUnit(), FY2025_BEGIN),
      observation('ending_arr', '180', currencyUnit(), FY2025_END),
    ]);

    expectBlocked(result, 'insufficient-data', 'missing_input');
    if (result.status !== 'blocked') throw new Error('expected blocked result');
    expect(result.issues[0]?.path).toContain('burn_multiple');
  });

  it('merges conservative warnings, dependency trace inputs, source refs, and stable step prefixes', () => {
    const observations = burnObservations().map((item, index) => ({
      ...item,
      sourceRefs: index === 0 ? ['z', 'a'] : ['dep'],
      conflict: {
        status: 'conservative-selected' as const,
        selectionReason: index === 0 ? 'root conservative' : 'dependency conservative',
      },
    }));

    const result = evaluate('burn_multiple', observations);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok result');
    expect(result.warnings).toHaveLength(3);
    expect(new Set(result.warnings.map((warning) => JSON.stringify(warning))).size).toBe(3);
    expect(result.trace.inputs.map((input) => input.metricId)).toEqual([
      'beginning_arr', 'ending_arr', 'net_cash_burn',
    ]);
    expect(result.trace.inputs.find((input) => input.metricId === 'net_cash_burn')?.sourceRefs).toEqual(['a', 'z']);
    expect(result.trace.steps.map((step) => step.id.split(':')[0])).toEqual([
      'net_new_arr@1', 'burn_multiple@1',
    ]);
  });

  it('evaluates with 700 fully expanded legal observations after request snapshotting', () => {
    const observations = roundTripObservations([
      observation('revenue', '100'),
      observation('cost_of_goods_sold', '40'),
      ...expandedExtraObservations(698),
    ]);

    expect(observations[0]?.period).not.toBe(observations[1]?.period);
    expect(evaluateMetric({
      formulaId: 'gross_margin',
      version: '1',
      observations,
    })).toMatchObject({
      status: 'ok',
      value: { value: { value: '0.6' } },
    });
  });

  it('does not mutate caller input and returns JSON-safe deeply frozen defensive output', () => {
    const observations = [
      observation('revenue', '100', currencyUnit('USD'), FY2025, { sourceRefs: ['b', 'a'] }),
      observation('cost_of_goods_sold', '40', currencyUnit('USD')),
    ];
    const before = JSON.stringify(observations);

    const result = evaluate('gross_margin', observations);

    expect(JSON.stringify(observations)).toBe(before);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(JSON.stringify(result)).not.toContain('Decimal');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.trace)).toBe(true);
    expect(Object.isFrozen(result.trace.inputs)).toBe(true);
    if (result.status !== 'ok') throw new Error('expected ok result');
    expect(Object.isFrozen(result.value.value.unit)).toBe(true);
    expect(result.value.value.unit).not.toBe(observations[0]?.value.unit);
  });

  it('rejects request accessors and hostile proxies without executing getters', () => {
    let getterReads = 0;
    const accessor = Object.defineProperty({
      formulaId: 'gross_margin', version: '1',
    }, 'observations', {
      enumerable: true,
      get() {
        getterReads += 1;
        return [];
      },
    });
    let proxyGets = 0;
    const hostile = new Proxy({ formulaId: 'gross_margin', version: '1', observations: [] }, {
      ownKeys() {
        proxyGets += 1;
        throw new Error('proxy trap executed');
      },
    });

    expectDomainError(() => evaluateMetric(accessor as never), 'invalid_dto');
    expect(getterReads).toBe(0);
    expectDomainError(() => evaluateMetric(hostile), 'invalid_dto');
    expect(proxyGets).toBe(1);
  });
});

describe('FormulaEvaluationSession', () => {
  it('publishes the exact API and caches dependency-first successful completions once', () => {
    const session = createFormulaEvaluationSession(burnObservations());
    expectTypeOf(session).toEqualTypeOf<FormulaEvaluationSession>();

    const burn = session.evaluate('burn_multiple', '1');
    const dependency = session.evaluate('net_new_arr', '1');
    const repeatedBurn = session.evaluate('burn_multiple', '1');
    const completed = session.completedResults();

    expect(burn.status).toBe('ok');
    expect(dependency.status).toBe('ok');
    expect(repeatedBurn).toBe(burn);
    expect(completed.map((result) => result.value.formulaId)).toEqual([
      'net_new_arr', 'burn_multiple',
    ]);
    expect(completed).toHaveLength(2);
    expect(new Set(completed.map((result) => result.value.formulaId)).size).toBe(2);
    expect(Object.isFrozen(completed)).toBe(true);
    expect(Object.isFrozen(completed[0])).toBe(true);
    expectTypeOf(completed).toEqualTypeOf<readonly FormulaSuccess[]>();
    expect(session.completedResults()).not.toBe(completed);
    expect(session.completedResults()).toEqual(completed);
  });

  it('rejects duplicate valueRef identities immediately even when one observation is extra', () => {
    const observations = [...burnObservations()];
    observations.push(observation('unused_metric', '1', currencyUnit(), FY2025, {
      valueRef: observations[0]!.valueRef,
    }));

    const first = expectDomainError(
      () => createFormulaEvaluationSession(observations),
      'invalid_dto',
    );
    const second = expectDomainError(
      () => createFormulaEvaluationSession(observations),
      'invalid_dto',
    );
    expect(first).not.toBe(second);
  });

  it('rejects non-string valueRef identities immediately', () => {
    const malformed = [{
      ...observation('revenue', '100'),
      valueRef: 1,
    }];

    expectDomainError(
      () => createFormulaEvaluationSession(malformed),
      'invalid_dto',
    );
  });

  it('merges cached dependency evidence once without rejecting a normal burn trace', () => {
    const observations = burnObservations();
    const session = createFormulaEvaluationSession(observations);
    expect(session.evaluate('net_new_arr', '1').status).toBe('ok');

    const result = session.evaluate('burn_multiple', '1');

    expect(result.status).toBe('ok');
    const valueRefs = result.trace.inputs.map((input) => input.valueRef);
    expect(valueRefs).toEqual([
      'beginning_arr:FY2025_BEGIN',
      'ending_arr:FY2025_END',
      'net_cash_burn:FY2025',
    ]);
    expect(new Set(valueRefs).size).toBe(valueRefs.length);
  });

  it('snapshots observations once and is immune to caller TOCTOU mutation', () => {
    const observations = burnObservations().map((item) => structuredClone(item));
    const session = createFormulaEvaluationSession(observations);
    (observations[0]!.value as { value: string }).value = '999';
    observations.splice(1);

    expect(session.evaluate('burn_multiple', '1')).toMatchObject({
      status: 'ok', value: { value: { value: '1' } },
    });
  });

  it('rejects hostile session snapshots without invoking accessors or proxy getters', () => {
    let reads = 0;
    const accessor = [Object.defineProperty({}, 'metricId', {
      enumerable: true,
      get() {
        reads += 1;
        return 'revenue';
      },
    })];
    let proxyGets = 0;
    const proxy = new Proxy([], {
      ownKeys() {
        proxyGets += 1;
        throw new Error('proxy trap executed');
      },
    });

    expectDomainError(() => createFormulaEvaluationSession(accessor), 'invalid_dto');
    expect(reads).toBe(0);
    expectDomainError(() => createFormulaEvaluationSession(proxy), 'invalid_dto');
    expect(proxyGets).toBe(1);
  });

  it('constructs a session from 700 fully expanded legal observations', () => {
    const observations = roundTripObservations(expandedExtraObservations(700));

    expect(observations[0]?.period).not.toBe(observations[1]?.period);
    expect(createFormulaEvaluationSession(observations).completedResults()).toEqual([]);
  });

  it('fully validates observation DTOs during session construction', () => {
    const base = observation('orphan', '1');
    class ObservationDto {
      valueRef = 'orphan';
      metricId = 'orphan';
      value = base.value;
      period = base.period;
      sourceRefs = base.sourceRefs;
      conflict = base.conflict;
    }
    let accessorReads = 0;
    const accessor = Object.defineProperty({ ...base }, 'metricId', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'orphan';
      },
    });
    const malformed: readonly unknown[] = [
      { valueRef: 'orphan', extra: true },
      { ...base, value: { value: 1, unit: currencyUnit() } },
      { ...base, value: { value: '1', unit: { kind: 'currency' } } },
      { ...base, period: { ...FY2025, durationMonths: '12' } },
      { ...base, sourceRefs: {} },
      { ...base, conflict: { status: 'none', selectionReason: 'not allowed' } },
      new ObservationDto(),
      accessor,
    ];

    for (const damaged of malformed) {
      const first = expectDomainError(
        () => createFormulaEvaluationSession([damaged]),
        'invalid_dto',
      );
      const second = expectDomainError(
        () => createFormulaEvaluationSession([damaged]),
        'invalid_dto',
      );
      expect(first).not.toBe(second);
    }
    const sparse = new Array<FormulaObservation>(1);
    const firstSparse = expectDomainError(
      () => createFormulaEvaluationSession(sparse),
      'invalid_dto',
    );
    const secondSparse = expectDomainError(
      () => createFormulaEvaluationSession(sparse),
      'invalid_dto',
    );
    expect(firstSparse).not.toBe(secondSparse);
    expect(accessorReads).toBe(0);
  });
});
