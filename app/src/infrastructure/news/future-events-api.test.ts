import { describe, expect, it } from 'vitest';
import { parseDividendEvents, parseUnlockResponse } from './future-events-api';

describe('parseUnlockResponse', () => {
  const fixture = JSON.stringify({
    result: { data: [
      { FREE_DATE: '2026-10-28 00:00:00', LIFT_MARKET_CAP: 9077953.4304, SECURITY_NAME_ABBR: '西安奕材' },
      { FREE_DATE: '2026-04-28 00:00:00', LIFT_MARKET_CAP: 45725.359936 },
    ]},
  });

  it('parses unlock rows, converting market cap from 万元 to 亿元', () => {
    const rows = parseUnlockResponse(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ freeDate: '2026-10-28', marketCap: 9077953.4304 / 10000 });
    expect(rows[1]).toEqual({ freeDate: '2026-04-28', marketCap: 45725.359936 / 10000 });
  });

  it('returns [] for malformed payloads', () => {
    expect(parseUnlockResponse('not json')).toEqual([]);
    expect(parseUnlockResponse('{"result":null}')).toEqual([]);
    expect(parseUnlockResponse('{"result":{"data":[]}}')).toEqual([]);
  });
});

describe('parseDividendEvents', () => {
  const fixture = JSON.stringify({
    fhyx: [
      { ASSIGN_PROGRESS: '实施方案', IMPL_PLAN_PROFILE: '10派280.2423元', EX_DIVIDEND_DATE: '2026-06-26 00:00:00' },
      { ASSIGN_PROGRESS: '董事会预案', IMPL_PLAN_PROFILE: '10派10元', EX_DIVIDEND_DATE: null },
    ],
  });

  it('parses dividend plans with dates and progress', () => {
    const rows = parseDividendEvents(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ exDate: '2026-06-26', plan: '10派280.2423元', progress: '实施方案' });
    expect(rows[1]).toEqual({ exDate: null, plan: '10派10元', progress: '董事会预案' });
  });

  it('returns [] for malformed payloads', () => {
    expect(parseDividendEvents('{}')).toEqual([]);
    expect(parseDividendEvents('{"fhyx":null}')).toEqual([]);
  });
});
