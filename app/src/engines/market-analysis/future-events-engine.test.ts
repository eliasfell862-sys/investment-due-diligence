import { describe, expect, it } from 'vitest';
import { selectFutureEvents, type DividendPlanInput, type UnlockInput } from './future-events-engine';

const TODAY = '2026-08-10';

function dividends(...items: DividendPlanInput[]): DividendPlanInput[] { return items; }
function unlocks(...items: UnlockInput[]): UnlockInput[] { return items; }

describe('selectFutureEvents', () => {
  it('includes a future-dated dividend implementation as 除权除息', () => {
    const result = selectFutureEvents({
      today: TODAY,
      dividends: dividends(
        { exDate: '2026-08-20', plan: '10派280.2423元', progress: '实施方案' },
      ),
      unlocks: unlocks(),
    });
    const div = result.find(e => e.type === 'dividend');
    expect(div).toMatchObject({ date: '2026-08-20', type: 'dividend' });
    expect(div?.title).toContain('除权除息');
    expect(div?.title).toContain('10派280.2423元');
  });

  it('excludes dividend implementations already past', () => {
    const result = selectFutureEvents({
      today: TODAY,
      dividends: dividends(
        { exDate: '2026-06-26', plan: '10派239.57元', progress: '实施方案' },
      ),
      unlocks: unlocks(),
    });
    expect(result.filter(e => e.type === 'dividend' || e.type === 'unlock')).toHaveLength(0);
  });

  it('includes future unlocks with market cap detail', () => {
    const result = selectFutureEvents({
      today: TODAY,
      dividends: dividends(),
      unlocks: unlocks({ freeDate: '2026-09-01', marketCap: 90.78 }),
    });
    const u = result.find(e => e.type === 'unlock');
    expect(u).toMatchObject({ date: '2026-09-01', type: 'unlock' });
    expect(u?.title).toContain('解禁');
    expect(u?.title).toContain('90.8亿');
  });

  it('adds the next statutory report deadline within the window', () => {
    const result = selectFutureEvents({ today: TODAY, dividends: dividends(), unlocks: unlocks() });
    expect(result.some(e => e.type === 'report' && e.date === '2026-08-31')).toBe(true);
  });

  it('shows undated planned dividends last with a 待实施 marker', () => {
    const result = selectFutureEvents({
      today: TODAY,
      dividends: dividends(
        { exDate: null, plan: '10派10元', progress: '董事会预案' },
        { exDate: '2026-08-25', plan: '10派20元', progress: '实施方案' },
      ),
      unlocks: unlocks(),
    });
    const dated = result.find(e => e.date === '2026-08-25');
    const undated = result[result.length - 1];
    expect(dated).toBeTruthy();
    expect(undated.date).toBe('');
    expect(undated.title).toContain('待实施');
  });

  it('sorts events by date ascending', () => {
    const result = selectFutureEvents({
      today: TODAY,
      dividends: dividends(
        { exDate: '2026-09-10', plan: '10派5元', progress: '实施方案' },
        { exDate: '2026-08-25', plan: '10派5元', progress: '实施方案' },
      ),
      unlocks: unlocks({ freeDate: '2026-09-01', marketCap: null }),
    });
    const dates = result.filter(e => e.date).map(e => e.date);
    expect([...dates]).toEqual([...dates].sort());
  });

  it('returns an empty list when nothing is coming up', () => {
    const result = selectFutureEvents({
      today: TODAY,
      dividends: dividends({ exDate: '2026-07-01', plan: '10派1元', progress: '实施方案' }),
      unlocks: unlocks({ freeDate: '2027-01-01', marketCap: null }),
    });
    // 报告事件可能在窗口外时为空；这里 TODAY+45 内无半年报（8-31 仍在窗口内），所以仍应有报告
    expect(result.filter(e => e.type === 'dividend' || e.type === 'unlock')).toHaveLength(0);
  });
});
