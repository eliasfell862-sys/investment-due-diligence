export type TargetFieldIdentityKind = 'measure' | 'period' | 'dimension';

export interface TargetFieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly importable: boolean;
  readonly identityKind: TargetFieldIdentityKind;
}

export const targetFieldDefinitions = [
  {
    id: 'company_name',
    label: '公司名称',
    importable: true,
    identityKind: 'dimension',
  },
  {
    id: 'business_description',
    label: '业务描述',
    importable: true,
    identityKind: 'measure',
  },
  {
    id: 'period_end',
    label: '期间',
    importable: true,
    identityKind: 'period',
  },
  {
    id: 'revenue',
    label: '营业收入',
    importable: true,
    identityKind: 'measure',
  },
  {
    id: 'gross_margin',
    label: '毛利率',
    importable: true,
    identityKind: 'measure',
  },
  {
    id: 'net_profit',
    label: '净利润',
    importable: true,
    identityKind: 'measure',
  },
  {
    id: 'operating_cash_flow',
    label: '经营现金流',
    importable: true,
    identityKind: 'measure',
  },
  { id: 'arr', label: 'ARR', importable: true, identityKind: 'measure' },
  { id: 'nrr', label: 'NRR', importable: false, identityKind: 'measure' },
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
