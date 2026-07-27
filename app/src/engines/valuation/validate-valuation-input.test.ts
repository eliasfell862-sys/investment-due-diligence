import { describe, expect, it } from 'vitest';

import { DomainContractError } from '../../domain/analysis/value';
import {
  comparableInput,
  dcfInput,
  triangulationInput,
  vcInput,
} from './valuation-test-fixtures';
import {
  validateComparableInput,
  validateDcfInput,
  validateTriangulationInput,
  validateVcInput,
} from './validate-valuation-input';

function expectInvalidDto(action: () => unknown): void {
  expect(action).toThrowError(
    expect.objectContaining<Partial<DomainContractError>>({
      code: 'invalid_dto',
    }),
  );
}

function expectIssue(
  result: ReturnType<
    | typeof validateDcfInput
    | typeof validateComparableInput
    | typeof validateVcInput
    | typeof validateTriangulationInput
  >,
  code: string,
  path: string,
): void {
  expect(result.status).toBe('blocked');
  if (result.status === 'blocked') {
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code, path })]),
    );
  }
}

describe('valuation input validation', () => {
  it('normalizes all four valid public inputs and emits stable trace inputs', () => {
    const dcf = validateDcfInput(dcfInput());
    const comparable = validateComparableInput(comparableInput());
    const vc = validateVcInput(vcInput());
    const triangulation = validateTriangulationInput(triangulationInput());

    expect(dcf.status).toBe('valid');
    expect(comparable.status).toBe('valid');
    expect(vc.status).toBe('valid');
    expect(triangulation.status).toBe('valid');
    if (dcf.status === 'valid') {
      expect(dcf.input.modelYears).toHaveLength(3);
      expect(dcf.traceInputs.map(({ valueRef }) => valueRef)).toEqual(
        [...dcf.traceInputs.map(({ valueRef }) => valueRef)].sort(),
      );
    }
  });

  it('throws for structurally damaged DTOs and unknown keys', () => {
    const { version: _version, ...missingVersion } = dcfInput();
    expectInvalidDto(() => validateDcfInput(missingVersion));
    expectInvalidDto(() => validateDcfInput({ ...dcfInput(), extra: true }));
    expectInvalidDto(() => validateVcInput({ ...vcInput(), holdingYears: 5 }));
  });

  it('blocks unsupported versions and noncanonical decimals', () => {
    const version = validateDcfInput({ ...dcfInput(), version: '2' });
    expectIssue(version, 'unsupported_engine_version', 'version');

    const decimal = validateDcfInput({ ...dcfInput(), wacc: '0.10' });
    expectIssue(decimal, 'invalid_decimal', 'wacc');
  });

  it('requires a valid currency, valuation date, and aligned complete model years', () => {
    expectIssue(
      validateDcfInput({ ...dcfInput(), currency: 'cny' }),
      'value_out_of_range',
      'currency',
    );
    expectIssue(
      validateDcfInput({ ...dcfInput(), valuationDate: '2026-02-30' }),
      'value_out_of_range',
      'valuationDate',
    );
    expectIssue(
      validateDcfInput({ ...dcfInput(), valuationDate: '2026-03-30' }),
      'period_mismatch',
      'valuationDate',
    );

    const modelYears = dcfInput().modelYears.map((year, index) =>
      index === 1
        ? {
            ...year,
            period: { ...year.period, startDate: '2027-05-01' },
          }
        : year,
    );
    expectIssue(
      validateDcfInput({ ...dcfInput(), modelYears }),
      'period_mismatch',
      'modelYears[1].period',
    );
  });

  it('enforces DCF terminal assumptions, weights, and centered axes', () => {
    expectIssue(
      validateDcfInput({ ...dcfInput(), wacc: '0' }),
      'value_out_of_range',
      'wacc',
    );
    expectIssue(
      validateDcfInput({ ...dcfInput(), perpetuityGrowthRate: '0.1' }),
      'invalid_terminal_value',
      'perpetuityGrowthRate',
    );
    expectIssue(
      validateDcfInput({
        ...dcfInput(),
        terminalMethodWeights: {
          perpetuityGrowth: '0.6',
          exitMultiple: '0.5',
        },
      }),
      'value_out_of_range',
      'terminalMethodWeights',
    );
    expectIssue(
      validateDcfInput({
        ...dcfInput(),
        sensitivity: {
          ...dcfInput().sensitivity,
          wacc: ['0.08', '0.09', '0.11', '0.12', '0.13'],
        },
      }),
      'invalid_sensitivity_matrix',
      'sensitivity.wacc',
    );
  });

  it('rejects duplicate comparable IDs and invalid subject periods', () => {
    const peers = comparableInput().peers.map((peer, index) =>
      index === 1 ? { ...peer, companyId: ' PEER-A ' } : peer,
    );
    expectIssue(
      validateComparableInput({ ...comparableInput(), peers }),
      'value_out_of_range',
      'peers[1].companyId',
    );

    expectIssue(
      validateComparableInput({
        ...comparableInput(),
        subject: {
          ...comparableInput().subject,
          period: { ...comparableInput().subject.period, durationMonths: 11 },
        },
      }),
      'period_mismatch',
      'subject.period',
    );
  });

  it('validates VC ranges, ownership, holding period, and target-return consistency', () => {
    expectIssue(
      validateVcInput({
        ...vcInput(),
        exitEquityValue: { low: '12000', midpoint: '10000', high: '8000' },
      }),
      'invalid_valuation_range',
      'exitEquityValue',
    );
    expectIssue(
      validateVcInput({ ...vcInput(), targetOwnership: '0' }),
      'value_out_of_range',
      'targetOwnership',
    );
    expectIssue(
      validateVcInput({ ...vcInput(), holdingYears: '0' }),
      'value_out_of_range',
      'holdingYears',
    );

    const consistent = validateVcInput({
      ...vcInput(),
      targetMoic: '3.0517578125',
    });
    expect(consistent.status).toBe('valid');

    expectIssue(
      validateVcInput({ ...vcInput(), targetMoic: '3' }),
      'inconsistent_target_return',
      'targetMoic',
    );
  });

  it('requires two or more compatible triangulation methods with exact weights', () => {
    expectIssue(
      validateTriangulationInput({
        ...triangulationInput(),
        methods: [triangulationInput().methods[0]!],
      }),
      'missing_input',
      'methods',
    );

    const wrongWeight = triangulationInput().methods.map((method, index) =>
      index === 0 ? { ...method, weight: '0.5' } : method,
    );
    expectIssue(
      validateTriangulationInput({ ...triangulationInput(), methods: wrongWeight }),
      'value_out_of_range',
      'methods',
    );

    const mixedDate = triangulationInput().methods.map((method, index) =>
      index === 1
        ? {
            ...method,
            range: { ...method.range, valuationDate: '2026-04-01' },
          }
        : method,
    );
    expectIssue(
      validateTriangulationInput({ ...triangulationInput(), methods: mixedDate }),
      'period_mismatch',
      'methods[1].range.valuationDate',
    );
  });
  it('rejects structurally damaged sensitivity matrices before triangulation', () => {
    const methods = triangulationInput().methods.map((method) =>
      method.methodId === 'vc-method'
        ? {
            ...method,
            sensitivityMatrices: [{}],
          }
        : method,
    );

    expectInvalidDto(() =>
      validateTriangulationInput({ ...triangulationInput(), methods }),
    );
  });
});
