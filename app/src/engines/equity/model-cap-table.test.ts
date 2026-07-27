import { describe, expect, it } from 'vitest';

import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import { capTableInput } from './equity-test-fixtures';
import type { SecurityPosition } from './equity-types';
import { modelCapTable } from './model-cap-table';

function ok(input = capTableInput()) {
  const result = modelCapTable(input);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error(JSON.stringify(result));
  return result;
}

describe('modelCapTable', () => {
  it('prices a simple pre-money round and issues exact investor shares', () => {
    const event = { ...capTableInput().events[0]! };
    delete (event as Partial<typeof event>).esopPoolExpansion;
    const result = ok({ ...capTableInput(), events: [event] });
    const round = result.value.rounds[0]!;
    const investor = result.value.finalSnapshot.positions.find(
      ({ securityId }) => securityId === 'series-a-preferred',
    )!;

    expect(round.pricePerShare).toBe('5');
    expect(round.newInvestorShares).toBe('200');
    expect(round.esopPoolIncrease).toBe('0');
    expect(result.value.finalSnapshot.totalFullyDilutedShares).toBe('1200');
    expect(investor.ownership).toBe(
      canonicalDecimal(new AnalysisDecimal(200).dividedBy(1200)),
    );
  });

  it('solves pre-money ESOP top-up before pricing and charges old holders', () => {
    const result = ok();
    const expansion = new AnalysisDecimal('0.15')
      .times('1.2')
      .times('1000')
      .minus('100')
      .dividedBy(new AnalysisDecimal(1).minus(new AnalysisDecimal('0.15').times('1.2')));
    const expectedPrice = new AnalysisDecimal('5000').dividedBy(
      new AnalysisDecimal('1000').plus(expansion),
    );
    const round = result.value.rounds[0]!;

    expect(round.esopPoolIncrease).toBe(canonicalDecimal(expansion));
    expect(round.pricePerShare).toBe(canonicalDecimal(expectedPrice));
    expect(round.newInvestorShares).toBe(
      canonicalDecimal(new AnalysisDecimal('1000').dividedBy(expectedPrice)),
    );
    const esop = result.value.finalSnapshot.positions.find(
      ({ securityId }) => securityId === 'employee-esop',
    )!;
    expect(esop.ownership).toBe('0.15');
  });

  it('applies post-money ESOP expansion after investor issuance', () => {
    const event = {
      ...capTableInput().events[0]!,
      esopPoolExpansion: {
        ...capTableInput().events[0]!.esopPoolExpansion!,
        timing: 'post-money' as const,
      },
    };
    const result = ok({ ...capTableInput(), events: [event] });
    const round = result.value.rounds[0]!;
    const prePoolTotal = new AnalysisDecimal('1200');
    const expansion = new AnalysisDecimal('0.15')
      .times(prePoolTotal)
      .minus('100')
      .dividedBy('0.85');

    expect(round.pricePerShare).toBe('5');
    expect(round.newInvestorShares).toBe('200');
    expect(round.esopPoolIncrease).toBe(canonicalDecimal(expansion));
    expect(result.value.finalSnapshot.positions.find(
      ({ securityId }) => securityId === 'employee-esop',
    )!.ownership).toSatisfy((value: string) =>
      new AnalysisDecimal(value).minus('0.15').abs().lessThanOrEqualTo('1e-39')
    );
  });

  it('tops up the existing ESOP position instead of creating a duplicate', () => {
    const result = ok();
    expect(result.value.finalSnapshot.positions.filter(
      ({ securityId }) => securityId === 'employee-esop',
    )).toHaveLength(1);
  });

  it('models multiple rounds and records each investment cash flow', () => {
    const first = capTableInput().events[0]!;
    const { esopPoolExpansion: _pool, ...roundWithoutPool } = first;
    const second = {
      ...roundWithoutPool,
      eventId: 'series-b',
      date: '2027-04-01',
      investorHolderId: 'series-b-investor',
      securityId: 'series-b-preferred',
      preMoneyEquityValue: '10000',
      investmentAmount: '2000',
      postMoneyEquityValue: '12000',
      liquidationPreference: {
        participation: 'non-participating' as const,
        multiple: '1',
        seniorityRank: 0,
      },
    };
    const result = ok({
      ...capTableInput(),
      events: [first, second],
    });

    expect(result.value.rounds).toHaveLength(2);
    expect(result.value.snapshots).toHaveLength(2);
    expect(result.value.investments.map(({ eventId }) => eventId)).toEqual([
      'initial:seed-preferred',
      'series-a',
      'series-b',
    ]);
    expect(result.value.finalSnapshot.positions.map(({ securityId }) => securityId)).toEqual(
      [...result.value.finalSnapshot.positions.map(({ securityId }) => securityId)].sort(),
    );
  });

  it('keeps every snapshot conserved with ownership summing exactly to one', () => {
    const result = ok();
    for (const snapshot of [result.value.initialSnapshot, ...result.value.snapshots]) {
      const shares = snapshot.positions.reduce(
        (sum, position) => sum.plus(position.shares),
        new AnalysisDecimal(0),
      );
      const ownership = snapshot.positions.reduce(
        (sum, position) => sum.plus(position.ownership),
        new AnalysisDecimal(0),
      );
      expect(canonicalDecimal(shares)).toBe(snapshot.totalFullyDilutedShares);
      expect(canonicalDecimal(ownership)).toBe('1');
    }
  });

  it('blocks an impossible pre-money pool denominator', () => {
    const event = {
      ...capTableInput().events[0]!,
      investmentAmount: '5000',
      postMoneyEquityValue: '10000',
      esopPoolExpansion: {
        ...capTableInput().events[0]!.esopPoolExpansion!,
        targetOwnership: '0.6',
      },
    };
    const result = modelCapTable({ ...capTableInput(), events: [event] });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_equity_event' }),
      ]));
    }
  });

  it('orders non-ASCII security IDs by Unicode code point across environments', () => {
    const initialPositions: SecurityPosition[] = [
      {
        securityId: '\u00e4-security',
        holderId: 'holder-a',
        securityType: 'common',
        shares: '1',
        investedCapital: '0',
        acquisitionDate: '2026-01-01',
      },
      {
        securityId: 'z-security',
        holderId: 'holder-z',
        securityType: 'common',
        shares: '1',
        investedCapital: '0',
        acquisitionDate: '2026-01-01',
      },
    ];
    const result = ok({ ...capTableInput(), initialPositions, events: [] });

    expect(result.value.finalSnapshot.positions.map(({ securityId }) => securityId)).toEqual([
      'z-security',
      '\u00e4-security',
    ]);
  });

  it('is deterministic, frozen, and does not mutate input', () => {
    const input = capTableInput();
    const before = JSON.stringify(input);
    const first = modelCapTable(input);
    const second = modelCapTable(capTableInput());
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
  });
});
