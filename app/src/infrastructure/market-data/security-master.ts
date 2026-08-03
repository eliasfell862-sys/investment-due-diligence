export type SecurityExchange = 'SSE' | 'SZSE' | 'BSE';
export type SecurityBoard = 'main' | 'chinext' | 'star' | 'bse';
export type SecurityClassificationStatus = 'official' | 'inferred' | 'unclassified';

export interface SecurityMasterInput {
  code: string;
  name: string;
  industry: string;
  classificationStatus?: SecurityClassificationStatus;
  classificationStandard?: string | null;
  classificationSource?: string;
  classificationVersion?: string;
  classificationAsOf?: string;
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
  classificationStandard: string | null;
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
    const source = (stock.classificationSource ?? provenance.classificationSource).toLowerCase();
    const classificationStatus: SecurityClassificationStatus = !industry
      ? 'unclassified'
      : stock.classificationStatus
        ?? (source.includes('heuristic') ? 'inferred' : source === 'unavailable' ? 'unclassified' : 'official');
    const classificationStandard = classificationStatus === 'unclassified'
      ? null
      : stock.classificationStandard ?? stock.classificationSource ?? provenance.classificationSource;

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
      classificationStandard,
      classificationStatus,
      provenance: {
        ...provenance,
        classificationSource: stock.classificationSource ?? provenance.classificationSource,
        classificationVersion: stock.classificationVersion ?? provenance.classificationVersion,
        asOf: stock.classificationAsOf ?? provenance.asOf,
      },
    };
  });
}
