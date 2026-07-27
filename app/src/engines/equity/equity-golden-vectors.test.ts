import { describe, expect, it } from 'vitest';

import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import { calculateInvestorReturns } from './calculate-investor-returns';
import { calculateLiquidationWaterfall } from './calculate-liquidation-waterfall';
import { capTableInput } from './equity-test-fixtures';
import type { CapTableModelInput, PricedRoundEvent } from './equity-types';
import { modelCapTable } from './model-cap-table';

function goldenInput(): CapTableModelInput {
  const first = capTableInput().events[0]!;
  const second: PricedRoundEvent = {
    kind: 'priced-round',
    eventId: 'series-b',
    date: '2027-04-01',
    investorHolderId: 'series-b-investor',
    securityId: 'series-b-preferred',
    securityType: 'preferred',
    preMoneyEquityValue: '10000',
    investmentAmount: '2000',
    postMoneyEquityValue: '12000',
    liquidationPreference: {
      participation: 'non-participating',
      multiple: '1',
      seniorityRank: 0,
    },
    esopPoolExpansion: {
      securityId: 'employee-esop',
      holderId: 'employees',
      timing: 'post-money',
      targetOwnership: '0.18',
    },
  };
  return { ...capTableInput(), events: [first, second] };
}

function modeled() {
  const result = modelCapTable(goldenInput());
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error(JSON.stringify(result));
  return result;
}

describe('equity golden vectors', () => {
  it('carries two priced rounds through dilution, liquidation, and investor returns', () => {
    const model = modeled();
    const firstPoolIncrease = new AnalysisDecimal('4000').dividedBy('41');
    const firstTotalShares = new AnalysisDecimal('54000').dividedBy('41');
    const secondInvestorShares = new AnalysisDecimal('10800').dividedBy('41');
    const sharesAfterSecondInvestor = firstTotalShares.plus(secondInvestorShares);
    const existingPool = new AnalysisDecimal('8100').dividedBy('41');
    const secondPoolIncrease = new AnalysisDecimal('0.18')
      .times(sharesAfterSecondInvestor)
      .minus(existingPool)
      .dividedBy('0.82');

    expect(model.trace.equityRef).toBe('cap-table@1');
    expect(model.value.rounds).toEqual([
      {
        eventId: 'series-a',
        pricePerShare: '4.555555555555555555555555555555555555554',
        newInvestorShares: '219.5121951219512195121951219512195121952',
        esopPoolIncrease: canonicalDecimal(firstPoolIncrease),
      },
      {
        eventId: 'series-b',
        pricePerShare: '7.592592592592592592592592592592592592591',
        newInvestorShares: '263.4146341463414634146341463414634146342',
        esopPoolIncrease: canonicalDecimal(secondPoolIncrease),
      },
    ]);
    expect(model.value.finalSnapshot.positions.find(
      ({ securityId }) => securityId === 'employee-esop',
    )!.ownership).toBe('0.18');
    expect(canonicalDecimal(model.value.finalSnapshot.positions.reduce(
      (sum, position) => sum.plus(position.ownership),
      new AnalysisDecimal(0),
    ))).toBe('1');
    expect(model.value.investments.map(({ eventId }) => eventId)).toEqual([
      'initial:seed-preferred',
      'series-a',
      'series-b',
    ]);

    const baseWaterfall = calculateLiquidationWaterfall({
      version: '1',
      currency: 'CNY',
      asOfDate: model.value.finalSnapshot.asOfDate,
      exitDate: '2032-04-01',
      exitValue: '6000',
      positions: model.value.finalSnapshot.positions,
    });
    expect(baseWaterfall.status).toBe('ok');
    if (baseWaterfall.status !== 'ok') throw new Error(JSON.stringify(baseWaterfall));
    expect(baseWaterfall.value.conversionDecisions).toEqual([
      { securityId: 'seed-preferred', converted: false },
      { securityId: 'series-b-preferred', converted: false },
    ]);
    expect(baseWaterfall.trace.equityRef).toBe('liquidation-waterfall@1');
    expect(baseWaterfall.value.totalAllocated).toBe('6000');
    expect(baseWaterfall.value.remainingValue).toBe('0');

    const returnsInput = {
      version: '1' as const,
      currency: 'CNY' as const,
      holderId: 'series-a-investor',
      capTable: {
        asOfDate: model.value.finalSnapshot.asOfDate,
        positions: model.value.finalSnapshot.positions,
        investments: model.value.investments,
      },
      scenarios: [
        { id: 'downside' as const, probability: '0.25', exitDate: '2032-04-01', exitValue: '1000' },
        { id: 'base' as const, probability: '0.5', exitDate: '2032-04-01', exitValue: '6000' },
        { id: 'upside' as const, probability: '0.25', exitDate: '2032-04-01', exitValue: '20000' },
      ],
    };
    const returns = calculateInvestorReturns(returnsInput);
    expect(returns.status).toBe('ok');
    if (returns.status !== 'ok') throw new Error(JSON.stringify(returns));
    expect(returns.trace.equityRef).toBe('investor-returns@1');
    expect(returns.value.totalInvestedCapital).toBe('1000');
    expect(returns.value.scenarios.map(({ investorProceeds }) => investorProceeds)).toEqual([
      '0',
      '1358.949416342412451361867704280155642023',
      '3000',
    ]);
    expect(returns.value.permanentLossProbability).toBe('0.25');
    expect(returns.value.scenarios.map(({ moic }) => moic)).toEqual([
      '0',
      '1.358949416342412451361867704280155642023',
      '3',
    ]);
    expect(returns.value.scenarios.map(({ irr }) => irr)).toEqual([
      null,
      '0.05239867494182852531882683237603927513775',
      '0.2007363387079453882161252764880678004302',
    ]);
    expect(returns.value.scenarios[0]!.irrIssue).toBe('root_not_found');
    const expectedExitProceeds = new AnalysisDecimal(
      '1358.949416342412451361867704280155642023',
    ).times('0.5').plus(new AnalysisDecimal('3000').times('0.25'));
    expect(returns.value.expectedExitProceeds).toBe(canonicalDecimal(expectedExitProceeds));
    expect(returns.value.expectedMoic).toBe(
      canonicalDecimal(expectedExitProceeds.dividedBy('1000')),
    );
    expect(Object.isFrozen(returns)).toBe(true);
    expect(JSON.stringify(calculateInvestorReturns(returnsInput))).toBe(JSON.stringify(returns));
  });

  it('keeps null-prototype inputs and reordered positions deterministic', () => {
    const nullPrototypeInput = Object.assign(
      Object.create(null) as CapTableModelInput,
      goldenInput(),
    );
    const model = modelCapTable(nullPrototypeInput);
    expect(model.status).toBe('ok');
    if (model.status !== 'ok') throw new Error(JSON.stringify(model));

    const waterfallInput = {
      version: '1' as const,
      currency: 'CNY' as const,
      asOfDate: model.value.finalSnapshot.asOfDate,
      exitDate: '2032-04-01',
      exitValue: '20000',
      positions: model.value.finalSnapshot.positions,
    };
    const ordered = calculateLiquidationWaterfall(waterfallInput);
    const reordered = calculateLiquidationWaterfall({
      ...waterfallInput,
      positions: [...waterfallInput.positions].reverse(),
    });

    expect(ordered.status).toBe('ok');
    expect(reordered.status).toBe('ok');
    if (ordered.status !== 'ok' || reordered.status !== 'ok') {
      throw new Error(JSON.stringify({ ordered, reordered }));
    }
    expect(reordered.value).toEqual(ordered.value);
    expect(ordered.value.conversionDecisions).toEqual([
      { securityId: 'seed-preferred', converted: true },
      { securityId: 'series-b-preferred', converted: true },
    ]);
    expect(ordered.value.allocations.find(
      ({ securityId }) => securityId === 'series-a-preferred',
    )!.totalProceeds).toBe('3000');
  });
});
