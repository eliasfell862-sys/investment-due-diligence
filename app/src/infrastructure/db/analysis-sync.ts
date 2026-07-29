/**
 * Bridges IndexedDB evidence → localStorage so analysis pages and report export
 * can read structured fields extracted from uploaded Excel/PDF documents.
 */
import type { AppDb } from './app-db';

interface SyncMapping {
  localStorageKey: string;
  fieldMap: Record<string, string>; // evidence fieldId → localStorage field name
  isArray?: boolean;
}

const SYNC_MAPPINGS: { module: string; fieldMap: Record<string, string> }[] = [
  {
    module: 'company-overview',
    fieldMap: { company_name: 'name', business_description: 'description' },
  },
  {
    module: 'financials',
    fieldMap: { revenue: 'revenue', gross_margin: 'grossProfit', net_profit: 'netIncome', operating_cash_flow: 'operatingCashFlow', arr: 'arr', nrr: 'nrr' },
  },
  {
    module: 'industry',
    fieldMap: { market_summary: 'trends' },
  },
];

export async function syncEvidenceToAnalysis(
  db: AppDb,
  projectId: string,
): Promise<{ synced: number; fields: string[] }> {
  const evidence = await db.evidence
    .where('projectId')
    .equals(projectId)
    .toArray();

  if (evidence.length === 0) return { synced: 0, fields: [] };

  const syncedFields: string[] = [];

  for (const mapping of SYNC_MAPPINGS) {
    const key = `dd-p-${projectId}-${mapping.module}`;
    const existingStr = localStorage.getItem(key);
    const existing: Record<string, unknown> = existingStr ? JSON.parse(existingStr) : {};

    for (const item of evidence) {
      const localField = mapping.fieldMap[item.fieldId];
      if (!localField) continue;

      const value = item.normalizedValue;
      if (value !== undefined && value !== '') {
        existing[localField] = value;
        if (!syncedFields.includes(localField)) syncedFields.push(localField);
      }
    }

    if (syncedFields.length > 0) {
      localStorage.setItem(key, JSON.stringify(existing));
    }
  }

  return { synced: syncedFields.length, fields: syncedFields };
}

export function getSyncStatus(projectId: string): { hasEvidence: boolean; syncedFields: string[] } {
  const syncedFields: string[] = [];
  for (const mapping of SYNC_MAPPINGS) {
    const data = localStorage.getItem(`dd-p-${projectId}-${mapping.module}`);
    if (!data) continue;
    const parsed = JSON.parse(data);
    for (const localField of Object.values(mapping.fieldMap)) {
      if (parsed[localField]) syncedFields.push(localField);
    }
  }
  return { hasEvidence: syncedFields.length > 0, syncedFields };
}
