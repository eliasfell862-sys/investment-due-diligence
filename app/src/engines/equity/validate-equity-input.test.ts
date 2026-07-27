import { describe, expect, it } from 'vitest';

import { DomainContractError } from '../../domain/analysis/value';
import {
  capTableInput,
  investorReturnInput,
  waterfallInput,
} from './equity-test-fixtures';
import {
  validateCapTableInput,
  validateInvestorReturnInput,
  validateWaterfallInput,
} from './validate-equity-input';

function issue(result: ReturnType<typeof validateCapTableInput>, code: string, path: string) {
  expect(result.status).toBe('blocked');
  if (result.status === 'blocked') {
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code, path }),
    ]));
  }
}

describe('equity input validation', () => {
  it('accepts valid cap-table, waterfall, and return inputs', () => {
    expect(validateCapTableInput(capTableInput()).status).toBe('valid');
    expect(validateWaterfallInput(waterfallInput()).status).toBe('valid');
    expect(validateInvestorReturnInput(investorReturnInput()).status).toBe('valid');
  });

  it('throws for structural damage and unknown keys', () => {
    const { version: _version, ...missing } = capTableInput();
    expect(() => validateCapTableInput(missing)).toThrowError(
      expect.objectContaining<Partial<DomainContractError>>({ code: 'invalid_dto' }),
    );
    expect(() => validateCapTableInput({ ...capTableInput(), extra: true })).toThrow();
  });

  it('rejects duplicate IDs, negative shares, and invalid preference fields', () => {
    const duplicates = capTableInput().initialPositions.map((position, index) =>
      index === 1 ? { ...position, securityId: 'founder-common' } : position,
    );
    issue(validateCapTableInput({ ...capTableInput(), initialPositions: duplicates }), 'invalid_cap_table', 'initialPositions[1].securityId');

    const negative = capTableInput().initialPositions.map((position, index) =>
      index === 0 ? { ...position, shares: '-1' } : position,
    );
    issue(validateCapTableInput({ ...capTableInput(), initialPositions: negative }), 'value_out_of_range', 'initialPositions[0].shares');

    const preferred = { ...capTableInput().initialPositions[2]! };
    delete (preferred as Partial<typeof preferred>).liquidationPreference;
    issue(validateCapTableInput({
      ...capTableInput(),
      initialPositions: [...capTableInput().initialPositions.slice(0, 2), preferred],
    }), 'invalid_liquidation_preference', 'initialPositions[2].liquidationPreference');
  });

  it('validates priced-round dates, post-money bridge, and ESOP target', () => {
    issue(validateCapTableInput({
      ...capTableInput(),
      events: [{ ...capTableInput().events[0]!, date: '2026-03-01' }],
    }), 'period_mismatch', 'events[0].date');
    issue(validateCapTableInput({
      ...capTableInput(),
      events: [{ ...capTableInput().events[0]!, postMoneyEquityValue: '7000' }],
    }), 'invalid_equity_event', 'events[0].postMoneyEquityValue');
    issue(validateCapTableInput({
      ...capTableInput(),
      events: [{
        ...capTableInput().events[0]!,
        esopPoolExpansion: {
          ...capTableInput().events[0]!.esopPoolExpansion!,
          targetOwnership: '1',
        },
      }],
    }), 'value_out_of_range', 'events[0].esopPoolExpansion.targetOwnership');
  });

  it('requires exact scenario probabilities and referenced investors', () => {
    const probabilities = investorReturnInput().scenarios.map((scenario, index) =>
      index === 0 ? { ...scenario, probability: '0.4' } : scenario,
    );
    const result = validateInvestorReturnInput({
      ...investorReturnInput(),
      scenarios: probabilities,
    });
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'probability_sum_mismatch', path: 'scenarios' }),
      ]));
    }

    const holder = validateInvestorReturnInput({
      ...investorReturnInput(),
      holderId: 'missing',
    });
    expect(holder.status).toBe('blocked');
  });
});
