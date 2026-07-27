import { describe, expect, it } from 'vitest';

import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import { calculateLiquidationWaterfall } from './calculate-liquidation-waterfall';
import type {
  CapTablePosition,
  LiquidationPreference,
  LiquidationWaterfallInput,
} from './equity-types';

function position(
  securityId: string,
  securityType: CapTablePosition['securityType'],
  shares: string,
  overrides: Partial<CapTablePosition> = {},
): CapTablePosition {
  return {
    securityId,
    holderId: `${securityId}-holder`,
    securityType,
    shares,
    investedCapital: '0',
    acquisitionDate: '2026-01-01',
    ownership: '0',
    ...overrides,
  };
}

function preferred(
  securityId: string,
  shares: string,
  investedCapital: string,
  liquidationPreference: LiquidationPreference,
): CapTablePosition {
  return position(securityId, 'preferred', shares, {
    investedCapital,
    liquidationPreference,
  });
}

function input(
  exitValue: string,
  positions: readonly CapTablePosition[],
): LiquidationWaterfallInput {
  const totalShares = positions.reduce(
    (sum, item) => sum.plus(item.shares),
    new AnalysisDecimal(0),
  );
  return {
    version: '1',
    currency: 'CNY',
    asOfDate: '2026-01-01',
    exitDate: '2031-01-01',
    exitValue,
    positions: positions.map((item) => ({
      ...item,
      ownership: canonicalDecimal(new AnalysisDecimal(item.shares).dividedBy(totalShares)),
    })),
  };
}

function ok(value: LiquidationWaterfallInput) {
  const result = calculateLiquidationWaterfall(value);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error(JSON.stringify(result));
  return result;
}

function allocation(
  result: ReturnType<typeof ok>,
  securityId: string,
) {
  return result.value.allocations.find((item) => item.securityId === securityId)!;
}

const nonParticipating = (
  multiple = '1',
  seniorityRank = 0,
): LiquidationPreference => ({
  participation: 'non-participating',
  multiple,
  seniorityRank,
});

describe('calculateLiquidationWaterfall', () => {
  it('allocates a common-only exit pro rata by shares', () => {
    const result = ok(input('100', [
      position('founder', 'common', '75'),
      position('employees', 'esop', '25'),
    ]));

    expect(result.value.conversionDecisions).toEqual([]);
    expect(allocation(result, 'founder')).toMatchObject({
      preferenceClaim: '0',
      preferenceProceeds: '0',
      participationProceeds: '75',
      totalProceeds: '75',
    });
    expect(allocation(result, 'employees').totalProceeds).toBe('25');
  });

  it('keeps a non-participating preferred class in preference when it pays more', () => {
    const result = ok(input('100', [
      position('common', 'common', '80'),
      preferred('series-a', '20', '30', nonParticipating()),
    ]));

    expect(result.value.conversionDecisions).toEqual([
      { securityId: 'series-a', converted: false },
    ]);
    expect(allocation(result, 'series-a')).toMatchObject({
      converted: false,
      preferenceClaim: '30',
      preferenceProceeds: '30',
      participationProceeds: '0',
      totalProceeds: '30',
    });
    expect(allocation(result, 'common').totalProceeds).toBe('70');
  });

  it('converts a non-participating preferred class when as-converted proceeds pay more', () => {
    const result = ok(input('100', [
      position('common', 'common', '80'),
      preferred('series-a', '20', '10', nonParticipating()),
    ]));

    expect(result.value.conversionDecisions).toEqual([
      { securityId: 'series-a', converted: true },
    ]);
    expect(allocation(result, 'series-a')).toMatchObject({
      converted: true,
      preferenceClaim: '10',
      preferenceProceeds: '0',
      participationProceeds: '20',
      totalProceeds: '20',
    });
  });

  it('pays participating preferred its preference and its as-converted residual share', () => {
    const result = ok(input('100', [
      position('common', 'common', '80'),
      preferred('series-a', '20', '10', {
        participation: 'participating',
        multiple: '1',
        seniorityRank: 0,
      }),
    ]));

    expect(allocation(result, 'series-a')).toMatchObject({
      converted: false,
      preferenceClaim: '10',
      preferenceProceeds: '10',
      participationProceeds: '18',
      totalProceeds: '28',
    });
    expect(allocation(result, 'common').totalProceeds).toBe('72');
  });

  it('enforces a participating cap and redistributes capped excess', () => {
    const result = ok(input('100', [
      position('common', 'common', '50'),
      preferred('series-a', '25', '10', {
        participation: 'participating',
        multiple: '1',
        seniorityRank: 0,
        capMultiple: '2',
      }),
    ]));

    expect(allocation(result, 'series-a')).toMatchObject({
      preferenceProceeds: '10',
      participationProceeds: '10',
      totalProceeds: '20',
    });
    expect(allocation(result, 'common').totalProceeds).toBe('80');
  });

  it('pays lower seniority ranks first and never makes remaining value negative', () => {
    const result = ok(input('90', [
      position('common', 'common', '100'),
      preferred('senior', '10', '60', nonParticipating('1', 0)),
      preferred('junior', '10', '60', nonParticipating('1', 1)),
    ]));

    expect(allocation(result, 'senior').preferenceProceeds).toBe('60');
    expect(allocation(result, 'junior').preferenceProceeds).toBe('30');
    expect(allocation(result, 'common').totalProceeds).toBe('0');
    expect(result.value.remainingValue).toBe('0');
  });

  it('shares a same-rank preference shortage in proportion to unpaid claims', () => {
    const result = ok(input('50', [
      position('common', 'common', '100'),
      preferred('series-a', '10', '40', nonParticipating()),
      preferred('series-b', '10', '60', nonParticipating()),
    ]));

    expect(allocation(result, 'series-a').preferenceProceeds).toBe('20');
    expect(allocation(result, 'series-b').preferenceProceeds).toBe('30');
    expect(result.value.totalAllocated).toBe('50');
  });

  it('solves a two-class conversion vector jointly instead of using gross pro-rata maxima', () => {
    const result = ok(input('100', [
      position('common', 'common', '60'),
      preferred('series-b', '20', '16', nonParticipating()),
      preferred('series-a', '20', '40', nonParticipating()),
    ]));

    expect(result.value.conversionDecisions).toEqual([
      { securityId: 'series-a', converted: false },
      { securityId: 'series-b', converted: false },
    ]);
    expect(allocation(result, 'series-b').totalProceeds).toBe('16');
  });

  it('finds a stable three-class equilibrium in security-ID order', () => {
    const result = ok(input('100', [
      preferred('series-c', '20', '16', nonParticipating()),
      position('common', 'common', '40'),
      preferred('series-a', '20', '40', nonParticipating()),
      preferred('series-b', '20', '16', nonParticipating()),
    ]));

    expect(result.value.conversionDecisions).toEqual([
      { securityId: 'series-a', converted: false },
      { securityId: 'series-b', converted: false },
      { securityId: 'series-c', converted: false },
    ]);
  });

  it('selects the lexicographically smallest equilibrium when a class is indifferent', () => {
    const result = ok(input('100', [
      position('common', 'common', '60'),
      preferred('series-a', '20', '40', nonParticipating()),
      preferred('series-b', '20', '15', nonParticipating()),
    ]));

    expect(result.value.conversionDecisions).toEqual([
      { securityId: 'series-a', converted: false },
      { securityId: 'series-b', converted: false },
    ]);
  });

  it('supports the 12 non-participating-class maximum', () => {
    const positions = [position('common', 'common', '100')];
    for (let index = 0; index < 12; index += 1) {
      positions.push(preferred(
        `preferred-${String(index).padStart(2, '0')}`,
        '1',
        '1',
        nonParticipating(),
      ));
    }
    const result = ok(input('0', positions));

    expect(result.value.conversionDecisions).toHaveLength(12);
    expect(result.value.conversionDecisions.every(({ converted }) => !converted)).toBe(true);
  });

  it('blocks 13 non-participating classes before combination enumeration', () => {
    const positions = [position('common', 'common', '100')];
    for (let index = 0; index < 13; index += 1) {
      positions.push(preferred(`preferred-${index}`, '1', '1', nonParticipating()));
    }
    const result = calculateLiquidationWaterfall(input('100', positions));

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_conversion_equilibrium',
          path: 'positions',
        }),
      ]));
    }
  });

  it('conserves exit value and returns deterministic frozen output without mutating input', () => {
    const value = input('100', [
      position('common', 'common', '50'),
      preferred('participating', '25', '10', {
        participation: 'participating',
        multiple: '1',
        seniorityRank: 0,
        capMultiple: '2',
      }),
      preferred('non-participating', '25', '15', nonParticipating('1', 1)),
    ]);
    const before = JSON.stringify(value);
    const first = ok(value);
    const second = ok(JSON.parse(before) as LiquidationWaterfallInput);
    const allocated = first.value.allocations.reduce(
      (sum, item) => sum.plus(item.totalProceeds),
      new AnalysisDecimal(0),
    );

    expect(JSON.stringify(value)).toBe(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.value.allocations)).toBe(true);
    expect(canonicalDecimal(allocated)).toBe(first.value.totalAllocated);
    expect(
      canonicalDecimal(allocated.plus(first.value.remainingValue)),
    ).toBe(first.value.exitValue);
    expect(first.value.remainingValue).toBe('0');
    expect(first.trace.equityRef).toBe('liquidation-waterfall@1');
  });
});
