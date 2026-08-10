import { describe, expect, it } from 'vitest';
import { buildGlobalUniverse } from './monitoring-universe';
import type { UserMonitoringAssignment } from './types';

describe('buildGlobalUniverse', () => {
  it('unions every watchlist, actual, and virtual code without truncation', () => {
    const watchlistCodes = Array.from({ length: 36 }, (_, index) => String(index + 1).padStart(6, '0'));
    const assignments: UserMonitoringAssignment[] = [{
      userId: 'user-a',
      watchlistCodes,
      actualPositionCodes: ['600519', '000001'],
      virtualPositionCodes: ['300750', '600519'],
      strategies: [],
    }];

    const result = buildGlobalUniverse(assignments);

    expect(result.codes).toHaveLength(38);
    expect(result.codes).toContain('300750');
    expect(result.codes).toContain('600519');
    expect(result.byUser.get('user-a')?.allCodes).toHaveLength(38);
  });

  it('deduplicates shared codes globally while preserving each user membership', () => {
    const assignments: UserMonitoringAssignment[] = [
      { userId: 'user-a', watchlistCodes: ['000001'], actualPositionCodes: [], virtualPositionCodes: [], strategies: [] },
      { userId: 'user-b', watchlistCodes: [], actualPositionCodes: ['000001', '600000'], virtualPositionCodes: [], strategies: [] },
    ];

    const result = buildGlobalUniverse(assignments);

    expect(result.codes).toEqual(['000001', '600000']);
    expect(result.byUser.get('user-a')?.allCodes).toEqual(['000001']);
    expect(result.byUser.get('user-b')?.allCodes).toEqual(['000001', '600000']);
  });
});
