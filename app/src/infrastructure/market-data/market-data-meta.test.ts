import { describe, expect, it } from 'vitest';
import { createMarketDataMeta } from './market-data-meta';

describe('market data metadata', () => {
  it('distinguishes live, static and failed data explicitly', () => {
    expect(createMarketDataMeta({ source: '????', mode: 'realtime', status: 'success', asOf: '2026-08-03T10:00:00.000Z' }))
      .toMatchObject({ source: '????', mode: 'realtime', status: 'success' });
    expect(createMarketDataMeta({ source: '????', mode: 'static', status: 'stale', asOf: '2026-08-01' }))
      .toMatchObject({ mode: 'static', status: 'stale' });
    expect(createMarketDataMeta({ source: '????', mode: 'realtime', status: 'error', error: 'Failed to fetch' }))
      .toMatchObject({ status: 'error', error: 'Failed to fetch' });
  });
});
