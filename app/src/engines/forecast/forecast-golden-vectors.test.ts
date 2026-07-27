import { describe, expect, it } from 'vitest';

import { forecastInput } from './forecast-test-fixtures';
import { forecastThreeScenarios } from './forecast-three-scenarios';

describe('three-scenario forecast golden vectors', () => {
  it('matches the complete 36-month hand-calculated vector', () => {
    const result = forecastThreeScenarios(forecastInput());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const downside = result.value.scenarios[0]!;
    const base = result.value.scenarios[1]!;
    const upside = result.value.scenarios[2]!;

    expect(downside).toMatchObject({
      id: 'downside',
      probability: '0.3',
      cashSummary: {
        minimumPreFinancingCash: '23.2',
        minimumPreFinancingPeriodId: 'forecast-2027-04',
        firstFinancingPeriodId: 'forecast-2027-03',
        minimumFinancingRequirement: '1864.8',
        finalEndingCash: '100',
      },
    });
    expect(downside.months[0]).toMatchObject({
      revenue: '640',
      grossProfit: '288',
      ebitda: '-44.8',
      preTaxIncome: '-60.8',
      incomeTax: '0',
      freeCashFlow: '-76.8',
      fcff: '-72.8',
      endingCash: '923.2',
    });
    expect(downside.months[11]).toMatchObject({
      period: { id: 'forecast-2027-03' },
      preFinancingEndingCash: '78.4',
      financingInflow: '21.6',
      endingCash: '100',
    });
    expect(downside.months[12]).toMatchObject({
      period: { id: 'forecast-2027-04' },
      preFinancingEndingCash: '23.2',
      financingInflow: '76.8',
      endingCash: '100',
    });
    expect(downside.modelYears.map((year) => ({
      revenue: year.revenue,
      freeCashFlow: year.freeCashFlow,
      fcff: year.fcff,
      financingInflow: year.financingInflow,
      endingCash: year.endingCash,
    }))).toEqual([
      {
        revenue: '7680',
        freeCashFlow: '-921.6',
        fcff: '-873.6',
        financingInflow: '21.6',
        endingCash: '100',
      },
      {
        revenue: '7680',
        freeCashFlow: '-921.6',
        fcff: '-873.6',
        financingInflow: '921.6',
        endingCash: '100',
      },
      {
        revenue: '7680',
        freeCashFlow: '-921.6',
        fcff: '-873.6',
        financingInflow: '921.6',
        endingCash: '100',
      },
    ]);

    expect(base.months[0]).toMatchObject({
      revenue: '1000',
      grossProfit: '550',
      ebitda: '100',
      incomeTax: '21.75',
      freeCashFlow: '52.25',
      fcff: '54.5',
    });
    expect(base.modelYears[0]).toMatchObject({
      revenue: '12000',
      freeCashFlow: '627',
      fcff: '654',
    });
    expect(base.cashSummary).toEqual({
      minimumPreFinancingCash: '1052.25',
      minimumPreFinancingPeriodId: 'forecast-2026-04',
      minimumFinancingRequirement: '0',
      finalEndingCash: '2881',
    });

    expect(upside.months[0]).toMatchObject({
      revenue: '1440',
      grossProfit: '936',
      ebitda: '388.8',
      incomeTax: '75.76',
      freeCashFlow: '293.04',
      fcff: '294.64',
    });
    expect(upside.modelYears[0]).toMatchObject({
      revenue: '17280',
      freeCashFlow: '3516.48',
      fcff: '3535.68',
    });
    expect(upside.cashSummary).toEqual({
      minimumPreFinancingCash: '1293.04',
      minimumPreFinancingPeriodId: 'forecast-2026-04',
      minimumFinancingRequirement: '0',
      finalEndingCash: '11549.44',
    });
  });

  it.each([
    [48, 4],
    [60, 5],
  ] as const)('keeps a complete %i-month output with %i years', (horizon, years) => {
    const result = forecastThreeScenarios(forecastInput({
      baseline: { horizonMonths: horizon },
    }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.value.scenarios.every((scenario) =>
        scenario.months.length === horizon &&
        scenario.modelYears.length === years)).toBe(true);
    }
  });
});
