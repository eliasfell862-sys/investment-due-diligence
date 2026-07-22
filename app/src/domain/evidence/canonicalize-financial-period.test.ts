import { describe, expect, it } from 'vitest';
import { canonicalizeFinancialPeriod } from './canonicalize-financial-period';

describe('canonicalizeFinancialPeriod', () => {
  it.each([
    ['2025-12-31', '2025-12-31'],
    ['2024-02-29', '2024-02-29'],
    ['2025-12-31T23:59:59.000Z', '2025-12-31'],
    [new Date('2025-12-31T00:00:00.000Z'), '2025-12-31'],
    ['2025', '2025'],
    ['2025-Q1', '2025-Q1'],
    ['2025-Q4', '2025-Q4'],
    ['2025-01', '2025-01'],
    ['2025-12', '2025-12'],
    ['2025-H1', '2025-H1'],
    ['2025-H2', '2025-H2'],
  ] as const)('canonicalizes supported financial period %j', (value, canonicalValue) => {
    expect(canonicalizeFinancialPeriod(value)).toEqual({
      status: 'valid',
      canonicalValue,
    });
  });

  it('treats canonical whitespace as empty', () => {
    expect(canonicalizeFinancialPeriod(' \n ')).toEqual({ status: 'empty' });
  });

  it.each([
    'FY2025',
    '2025 Q1',
    '2025-Q0',
    '2025-Q5',
    '2025-H0',
    '2025-H3',
    '2025-00',
    '2025-13',
    '2025-2',
    '2025-02-29',
    '2025-04-31',
    '2025-12-31Tnot-a-time',
    '任意期间',
  ])('rejects unsupported or impossible period %j', (value) => {
    expect(canonicalizeFinancialPeriod(value)).toEqual({ status: 'invalid' });
  });

  it('rejects an invalid Date object', () => {
    expect(canonicalizeFinancialPeriod(new Date('invalid'))).toEqual({
      status: 'invalid',
    });
  });
});
