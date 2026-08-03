export type SecurityExchange = 'SSE' | 'SZSE' | 'BSE';
export type SecurityBoard = 'main' | 'chinext' | 'star' | 'bse';
export type SecurityClassificationStatus = 'classified' | 'unclassified';

export interface SecurityMasterInput {
  code: string;
  name: string;
  industry: string;
}

export interface SecurityMasterProvenance {
  directorySource: string;
  classificationSource: string;
  asOf: string;
  classificationVersion: string;
}

export interface SecurityMasterRecord {
  securityId: string;
  code: string;
  name: string;
  assetType: 'stock';
  country: 'CN';
  currency: 'CNY';
  exchange: SecurityExchange;
  board: SecurityBoard;
  listingStatus: 'unknown';
  specialTreatment: boolean;
  industry: string | null;
  classificationStandard: 'eastmoney';
  classificationStatus: SecurityClassificationStatus;
  provenance: SecurityMasterProvenance;
}

function inferExchange(code: string): SecurityExchange {
  if (/^(4|8|92)/.test(code)) return 'BSE';
  if (/^(6|68)/.test(code)) return 'SSE';
  return 'SZSE';
}

function inferBoard(code: string, exchange: SecurityExchange): SecurityBoard {
  if (exchange === 'BSE') return 'bse';
  if (/^(300|301)/.test(code)) return 'chinext';
  if (/^(688|689)/.test(code)) return 'star';
  return 'main';
}

export function buildSecurityMaster(
  stocks: SecurityMasterInput[],
  provenance: SecurityMasterProvenance,
): SecurityMasterRecord[] {
  return stocks.map((stock) => {
    const exchange = inferExchange(stock.code);
    const rawIndustry = stock.industry.trim();
    const industry = rawIndustry && rawIndustry !== '\u672a\u5206\u7c7b'
      ? rawIndustry
      : null;

    return {
      securityId: `CN.${exchange}.${stock.code}`,
      code: stock.code,
      name: stock.name,
      assetType: 'stock',
      country: 'CN',
      currency: 'CNY',
      exchange,
      board: inferBoard(stock.code, exchange),
      listingStatus: 'unknown',
      specialTreatment: /^\*?ST/i.test(stock.name),
      industry,
      classificationStandard: 'eastmoney',
      classificationStatus: industry ? 'classified' : 'unclassified',
      provenance: { ...provenance },
    };
  });
}
