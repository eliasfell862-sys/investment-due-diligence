import type { MetricDirection } from '../metrics/metric-definition';

export type TargetFieldIdentityKind = 'measure' | 'period' | 'dimension';
export type TargetFieldValueKind = 'number' | 'period' | 'dimension' | 'text';
export type TargetFieldUnit = 'text' | 'date' | 'currency' | 'percent';

export interface TargetFieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly importable: boolean;
  readonly identityKind: TargetFieldIdentityKind;
  readonly valueKind: TargetFieldValueKind;
  readonly unit: TargetFieldUnit;
  readonly locale: 'en-US';
  readonly direction: MetricDirection;
}

export const targetFieldDefinitions = [
  {
    id: 'company_name',
    label: '公司名称',
    importable: true,
    identityKind: 'dimension',
    valueKind: 'dimension',
    unit: 'text',
    locale: 'en-US',
    direction: 'neutral',
  },
  {
    id: 'business_description',
    label: '业务描述',
    importable: true,
    identityKind: 'measure',
    valueKind: 'text',
    unit: 'text',
    locale: 'en-US',
    direction: 'neutral',
  },
  {
    id: 'period_end',
    label: '期间',
    importable: true,
    identityKind: 'period',
    valueKind: 'period',
    unit: 'date',
    locale: 'en-US',
    direction: 'neutral',
  },
  {
    direction: 'higher_is_better',
    id: 'revenue',
    label: '营业收入',
    importable: true,
    identityKind: 'measure',
    valueKind: 'number',
    unit: 'currency',
    locale: 'en-US',
  },
  {
    id: 'gross_margin',
    direction: 'higher_is_better',
    label: '毛利率',
    importable: true,
    identityKind: 'measure',
    valueKind: 'number',
    unit: 'percent',
    locale: 'en-US',
  },
  {
    id: 'net_profit',
    label: '净利润',
    direction: 'higher_is_better',
    importable: true,
    identityKind: 'measure',
    valueKind: 'number',
    unit: 'currency',
    locale: 'en-US',
  },
  {
    id: 'operating_cash_flow',
    label: '经营现金流',
    importable: true,
    direction: 'higher_is_better',
    identityKind: 'measure',
    valueKind: 'number',
    unit: 'currency',
    locale: 'en-US',
  },
  {
    id: 'arr',
    label: 'ARR',
    importable: true,
    identityKind: 'measure',
    direction: 'higher_is_better',
    valueKind: 'number',
    unit: 'currency',
    locale: 'en-US',
  },
  {
    id: 'nrr',
    label: 'NRR',
    importable: false,
    identityKind: 'measure',
    valueKind: 'number',
    direction: 'higher_is_better',
    unit: 'percent',
    locale: 'en-US',
  },
] as const satisfies readonly TargetFieldDefinition[];

const targetFieldById = new Map<string, TargetFieldDefinition>(
  targetFieldDefinitions.map((definition) => [definition.id, definition]),
);

export const importableTargetFieldDefinitions = targetFieldDefinitions.filter(
  (definition) => definition.importable,
);

export function findTargetFieldDefinition(id: string): TargetFieldDefinition | undefined {
  return targetFieldById.get(id);
}
