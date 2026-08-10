import { describe, expect, it } from 'vitest';
import { assessCoalCyclicalPe } from './coal-cyclical-pe';

describe('coal cyclical PE strategy', () => {
  it('marks a high historical PE as a cycle-bottom candidate for a covered coal stock', () => {
    expect(assessCoalCyclicalPe({ code: '601088', pe: 14 })).toMatchObject({
      status: 'evaluated',
      signal: 'cycle_bottom_candidate',
      scoreAdjustment: 6,
    });
  });

  it('marks a low historical PE as peak-profit risk instead of cheap valuation', () => {
    expect(assessCoalCyclicalPe({ code: '601088', pe: 8 })).toMatchObject({
      status: 'evaluated',
      signal: 'peak_profit_risk',
      scoreAdjustment: -8,
    });
  });

  it('does not change stocks outside the covered coal universe', () => {
    expect(assessCoalCyclicalPe({ code: '600519', pe: 20 })).toEqual({
      status: 'not_applicable',
      signal: 'none',
      scoreAdjustment: 0,
      evidence: [],
    });
  });

  it('leaves a covered coal stock unassessed when PE is unavailable', () => {
    expect(assessCoalCyclicalPe({ code: '601225', pe: 0 })).toMatchObject({
      status: 'unassessed',
      signal: 'none',
      scoreAdjustment: 0,
    });
  });
});
