import type { ModelYearForecast } from '../forecast/forecast-types';
import type {
  ComparableValuationInput,
  DcfInput,
  ValuationRange,
  ValuationTriangulationInput,
  VcMethodInput,
} from './valuation-types';

function modelYear(
  index: number,
  overrides: Partial<ModelYearForecast> = {},
): ModelYearForecast {
  const year = 2026 + index;
  const startYear = year;
  const endYear = year + 1;
  return {
    period: {
      kind: 'flow',
      id: `model-year-${index + 1}`,
      startDate: `${startYear}-04-01`,
      endDate: `${endYear}-03-31`,
      durationMonths: 12,
      granularity: 'year',
    },
    revenue: String(1000 + index * 200),
    costOfGoodsSold: String(400 + index * 70),
    grossProfit: String(600 + index * 130),
    salesAndMarketing: String(150 + index * 10),
    researchAndDevelopment: String(100 + index * 10),
    generalAndAdministrative: String(80 + index * 5),
    ebitda: String(270 + index * 105),
    depreciationAndAmortization: String(40 + index * 5),
    ebit: String(230 + index * 100),
    interestExpense: '20',
    preTaxIncome: String(210 + index * 100),
    incomeTax: String(52.5 + index * 25),
    netIncome: String(157.5 + index * 75),
    increaseInNetWorkingCapital: String(20 + index * 5),
    operatingCashFlow: String(177.5 + index * 80),
    capitalExpenditure: String(50 + index * 5),
    freeCashFlow: String(127.5 + index * 75),
    fcff: String(142.5 + index * 80),
    beginningCash: String(500 + index * 100),
    preFinancingEndingCash: String(627.5 + index * 175),
    financingInflow: '0',
    endingCash: String(627.5 + index * 175),
    ...overrides,
  };
}

export function dcfInput(
  overrides: Partial<DcfInput> = {},
): DcfInput {
  return {
    version: '1',
    currency: 'CNY',
    valuationDate: '2026-03-31',
    scenarioId: 'base',
    probability: '0.5',
    modelYears: [modelYear(0), modelYear(1), modelYear(2)],
    discountingConvention: 'year-end',
    wacc: '0.1',
    perpetuityGrowthRate: '0.03',
    exitMultiple: '8',
    exitMetric: 'ebitda',
    interestBearingDebt: '300',
    cashAndCashEquivalents: '500',
    terminalMethodWeights: {
      perpetuityGrowth: '0.5',
      exitMultiple: '0.5',
    },
    sensitivity: {
      wacc: ['0.08', '0.09', '0.1', '0.11', '0.12'],
      perpetuityGrowthRate: ['0.01', '0.02', '0.03', '0.04', '0.05'],
      exitMultiple: ['6', '7', '8', '9', '10'],
    },
    ...overrides,
  };
}

export function comparableInput(
  overrides: Partial<ComparableValuationInput> = {},
): ComparableValuationInput {
  return {
    version: '1',
    currency: 'CNY',
    valuationDate: '2026-03-31',
    subject: {
      period: modelYear(2).period,
      revenue: '1400',
      ebitda: '480',
      netIncome: '307.5',
      interestBearingDebt: '300',
      cashAndCashEquivalents: '500',
    },
    peers: [
      {
        companyId: 'peer-a',
        enterpriseValue: '5000',
        equityValue: '5200',
        revenue: '1000',
        ebitda: '250',
        netIncome: '200',
      },
      {
        companyId: 'peer-b',
        enterpriseValue: '7200',
        equityValue: '7400',
        revenue: '1200',
        ebitda: '300',
        netIncome: '220',
      },
      {
        companyId: 'peer-c',
        enterpriseValue: '9100',
        equityValue: '9300',
        revenue: '1300',
        ebitda: '350',
        netIncome: '250',
      },
      {
        companyId: 'peer-d',
        enterpriseValue: '12000',
        equityValue: '12200',
        revenue: '1500',
        ebitda: '400',
        netIncome: '300',
      },
    ],
    adjustments: {
      growth: '0.05',
      profitability: '0.03',
      size: '-0.02',
      liquidity: '-0.01',
    },
    ...overrides,
  };
}

export function vcInput(
  overrides: Partial<VcMethodInput> = {},
): VcMethodInput {
  return {
    version: '1',
    currency: 'CNY',
    valuationDate: '2026-03-31',
    exitEquityValue: {
      low: '8000',
      midpoint: '10000',
      high: '12000',
    },
    targetOwnership: '0.2',
    expectedDilution: '0.1',
    holdingYears: '5',
    targetIrr: '0.25',
    sensitivity: {
      exitEquityValue: ['8000', '9000', '10000', '11000', '12000'],
      targetIrr: ['0.15', '0.2', '0.25', '0.3', '0.35'],
    },
    ...overrides,
  };
}

function range(
  low: string,
  midpoint: string,
  high: string,
): ValuationRange {
  return {
    low,
    midpoint,
    high,
    currency: 'CNY',
    valuationDate: '2026-03-31',
    basis: 'pre-money-equity',
  };
}

export function triangulationInput(
  overrides: Partial<ValuationTriangulationInput> = {},
): ValuationTriangulationInput {
  return {
    version: '1',
    methods: [
      {
        methodId: 'dcf',
        label: 'DCF',
        weight: '0.4',
        range: range('3000', '4000', '5000'),
      },
      {
        methodId: 'comparable-ev-revenue',
        label: 'EV/Revenue',
        weight: '0.3',
        range: range('3500', '4500', '5500'),
      },
      {
        methodId: 'vc-method',
        label: 'VC Method',
        weight: '0.3',
        range: range('2500', '3500', '4500'),
      },
    ],
    ...overrides,
  };
}
