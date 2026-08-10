import type {
  GlobalMonitoringUniverse,
  UserMonitoringAssignment,
  UserMonitoringProjection,
} from './types';

function normalizeCode(value: string): string | null {
  const digits = value.trim().replace(/\D/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  return digits;
}

function uniqueCodes(...groups: string[][]): string[] {
  const codes = new Set<string>();
  for (const value of groups.flat()) {
    const normalized = normalizeCode(value);
    if (normalized) codes.add(normalized);
  }
  return [...codes].sort();
}

export function buildGlobalUniverse(
  assignments: UserMonitoringAssignment[],
): GlobalMonitoringUniverse {
  const globalCodes = new Set<string>();
  const byUser = new Map<string, UserMonitoringProjection>();

  for (const assignment of assignments) {
    const allCodes = uniqueCodes(
      assignment.watchlistCodes,
      assignment.actualPositionCodes,
      assignment.virtualPositionCodes,
    );
    for (const code of allCodes) globalCodes.add(code);
    byUser.set(assignment.userId, { ...assignment, allCodes });
  }

  return { codes: [...globalCodes].sort(), byUser };
}
