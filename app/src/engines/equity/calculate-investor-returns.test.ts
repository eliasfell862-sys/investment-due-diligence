import { describe, expect, it } from 'vitest';

import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import { investorReturnInput } from './equity-test-fixtures';
import { calculateInvestorReturns } from './calculate-investor-returns';

function ok(input = investorReturnInput()) {
  const result = calculateInvestorReturns(input);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error(JSON.stringify(result));
  return result;
}

describe('calculateInvestorReturns', () => {
  it('uses liquidation proceeds rather than simple ownership when preferences bind', () => {
    const result = ok();
    const downside = result.value.scenarios.find(({ id }) => id === 'downside')!;
    expect(downside.investorProceeds).toBe('500');
    expect(downside.investorProceeds).not.toBe(
      canonicalDecimal(new AnalysisDecimal('500').times(
        investorReturnInput().capTable.positions.find(
          ({ holderId }) => holderId === 'series-a-investor',
        )!.ownership,
      )),
    );
  });

  it('calculates scenario MOIC and XIRR from all dated investments', () => {
    const result = ok();
    for (const scenario of result.value.scenarios) {
      expect(scenario.moic).toBe(
        canonicalDecimal(new AnalysisDecimal(scenario.investorProceeds).dividedBy('1000')),
      );
      if (new AnalysisDecimal(scenario.investorProceeds).greaterThan(0)) {
        expect(scenario.irr).not.toBeNull();
      }
    }
  });

  it('weights exit proceeds before calculating expected MOIC', () => {
    const result = ok();
    const expectedProceeds = result.value.scenarios.reduce(
      (sum, scenario) => sum.plus(
        new AnalysisDecimal(scenario.investorProceeds).times(scenario.probability),
      ),
      new AnalysisDecimal(0),
    );
    expect(result.value.expectedExitProceeds).toBe(canonicalDecimal(expectedProceeds));
    expect(result.value.expectedMoic).toBe(
      canonicalDecimal(expectedProceeds.dividedBy(result.value.totalInvestedCapital)),
    );
  });

  it('lists permanent-loss probability independently', () => {
    const result = ok();
    expect(result.value.permanentLossProbability).toBe('0.3');
    expect(result.value.scenarios.find(({ id }) => id === 'downside')!.permanentLoss).toBe(true);
    expect(result.value.scenarios.find(({ id }) => id === 'base')!.permanentLoss).toBe(false);
  });

  it('does not count exact principal recovery as permanent loss', () => {
    const scenarios = investorReturnInput().scenarios.map((scenario) =>
      scenario.id === 'downside' ? { ...scenario, exitValue: '1000' } : scenario,
    );
    const result = ok({ ...investorReturnInput(), scenarios });
    expect(result.value.scenarios.find(({ id }) => id === 'downside')!.investorProceeds).toBe('1000');
    expect(result.value.scenarios.find(({ id }) => id === 'downside')!.permanentLoss).toBe(false);
    expect(result.value.permanentLossProbability).toBe('0');
  });

  it('returns null IRR with root_not_found when proceeds have no positive sign', () => {
    const scenarios = investorReturnInput().scenarios.map((scenario) =>
      scenario.id === 'downside' ? { ...scenario, exitValue: '0' } : scenario,
    );
    const result = ok({ ...investorReturnInput(), scenarios });
    const downside = result.value.scenarios.find(({ id }) => id === 'downside')!;
    expect(downside.investorProceeds).toBe('0');
    expect(downside.irr).toBeNull();
    expect(downside.irrIssue).toBe('root_not_found');
  });

  it('supports multiple investments for the same holder', () => {
    const input = investorReturnInput({
      capTable: {
        ...investorReturnInput().capTable,
        investments: [
          ...investorReturnInput().capTable.investments,
          {
            holderId: 'series-a-investor',
            securityId: 'follow-on',
            eventId: 'follow-on',
            date: '2028-04-01',
            amount: '500',
          },
        ],
      },
    });
    const result = ok(input);
    expect(result.value.totalInvestedCapital).toBe('1500');
    expect(result.value.scenarios.every(({ moic, investorProceeds }) =>
      moic === canonicalDecimal(new AnalysisDecimal(investorProceeds).dividedBy('1500'))
    )).toBe(true);
  });

  it('is frozen, deterministic, and does not mutate input', () => {
    const input = investorReturnInput();
    const before = JSON.stringify(input);
    const first = calculateInvestorReturns(input);
    const second = calculateInvestorReturns(investorReturnInput());
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
  });
});
