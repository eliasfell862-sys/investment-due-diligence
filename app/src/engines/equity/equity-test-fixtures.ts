import type {
  CapTableModelInput,
  CapTablePosition,
  InvestorReturnInput,
  LiquidationWaterfallInput,
  SecurityPosition,
} from './equity-types';

function position(
  overrides: Partial<SecurityPosition>,
): SecurityPosition {
  return {
    securityId: 'founder-common',
    holderId: 'founder',
    securityType: 'common',
    shares: '700',
    investedCapital: '0',
    acquisitionDate: '2020-01-01',
    ...overrides,
  };
}

export function capTableInput(
  overrides: Partial<CapTableModelInput> = {},
): CapTableModelInput {
  return {
    version: '1',
    currency: 'CNY',
    asOfDate: '2026-03-31',
    initialPositions: [
      position({}),
      position({
        securityId: 'employee-esop',
        holderId: 'employees',
        securityType: 'esop',
        shares: '100',
      }),
      position({
        securityId: 'seed-preferred',
        holderId: 'seed-investor',
        securityType: 'preferred',
        shares: '200',
        investedCapital: '1000',
        acquisitionDate: '2024-01-01',
        liquidationPreference: {
          participation: 'non-participating',
          multiple: '1',
          seniorityRank: 2,
        },
      }),
    ],
    events: [
      {
        kind: 'priced-round',
        eventId: 'series-a',
        date: '2026-04-01',
        investorHolderId: 'series-a-investor',
        securityId: 'series-a-preferred',
        securityType: 'preferred',
        preMoneyEquityValue: '5000',
        investmentAmount: '1000',
        postMoneyEquityValue: '6000',
        liquidationPreference: {
          participation: 'participating',
          multiple: '1',
          seniorityRank: 1,
          capMultiple: '3',
        },
        esopPoolExpansion: {
          securityId: 'employee-esop',
          holderId: 'employees',
          timing: 'pre-money',
          targetOwnership: '0.15',
        },
      },
    ],
    ...overrides,
  };
}

function outputPosition(
  source: SecurityPosition,
  ownership: string,
): CapTablePosition {
  return { ...source, ownership };
}

export function waterfallInput(
  overrides: Partial<LiquidationWaterfallInput> = {},
): LiquidationWaterfallInput {
  const initial = capTableInput().initialPositions;
  const positions: CapTablePosition[] = [
    outputPosition(initial[0]!, '0.5833333333333333333333333333333333333333'),
    outputPosition(initial[1]!, '0.08333333333333333333333333333333333333333'),
    outputPosition(initial[2]!, '0.1666666666666666666666666666666666666667'),
    {
      securityId: 'series-a-preferred',
      holderId: 'series-a-investor',
      securityType: 'preferred',
      shares: '200',
      investedCapital: '1000',
      acquisitionDate: '2026-04-01',
      liquidationPreference: {
        participation: 'participating',
        multiple: '1',
        seniorityRank: 1,
        capMultiple: '3',
      },
      ownership: '0.1666666666666666666666666666666666666667',
    },
  ];
  return {
    version: '1',
    currency: 'CNY',
    asOfDate: '2026-04-01',
    exitDate: '2031-04-01',
    exitValue: '12000',
    positions,
    ...overrides,
  };
}

export function investorReturnInput(
  overrides: Partial<InvestorReturnInput> = {},
): InvestorReturnInput {
  const waterfall = waterfallInput();
  return {
    version: '1',
    currency: 'CNY',
    holderId: 'series-a-investor',
    capTable: {
      asOfDate: waterfall.asOfDate,
      positions: waterfall.positions,
      investments: [
        {
          holderId: 'series-a-investor',
          securityId: 'series-a-preferred',
          eventId: 'series-a',
          date: '2026-04-01',
          amount: '1000',
        },
      ],
    },
    scenarios: [
      {
        id: 'downside',
        probability: '0.3',
        exitDate: '2031-04-01',
        exitValue: '500',
      },
      {
        id: 'base',
        probability: '0.5',
        exitDate: '2031-04-01',
        exitValue: '5000',
      },
      {
        id: 'upside',
        probability: '0.2',
        exitDate: '2031-04-01',
        exitValue: '12000',
      },
    ],
    ...overrides,
  };
}
