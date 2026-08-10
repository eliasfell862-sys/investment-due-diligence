/**
 * 未来事件引擎 —— 筛选未来一段时间内会影响情绪/股价的具体事件。
 *
 * 纯函数、离线可跑。输入分红计划（F10）、限售解禁（datacenter）与法定披露日历，
 * 选出未来 45 天窗口内的 定期报告 / 除权除息 / 解禁，按日期升序返回（未定日期
 * 的预案类排在最后）。
 */
export type FutureEventType = 'report' | 'dividend' | 'unlock';

export interface FutureEvent {
  /** YYYY-MM-DD；未定日期的预案为 '' */
  date: string;
  title: string;
  type: FutureEventType;
}

export interface DividendPlanInput {
  /** EX_DIVIDEND_DATE（YYYY-MM-DD），预案阶段可能为空 */
  exDate: string | null;
  /** IMPL_PLAN_PROFILE，如 "10派280.2423元" */
  plan: string;
  /** ASSIGN_PROGRESS：实施方案 / 董事会预案 / 预披露 */
  progress: string;
}

export interface UnlockInput {
  /** FREE_DATE（YYYY-MM-DD） */
  freeDate: string;
  /** 解禁市值（亿元），可为 null */
  marketCap: number | null;
}

const FUTURE_WINDOW_DAYS = 45;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A股法定定期报告披露截止日：半年报 8-31 / 三季报 10-31 / 年报 次年 4-30。 */
function nextReportSchedule(today: string): { date: string; title: string } | null {
  const y = Number(today.slice(0, 4));
  const candidates = [
    { date: `${y}-08-31`, title: `${y}年半年报披露截止（法定）` },
    { date: `${y}-10-31`, title: `${y}年三季报披露截止（法定）` },
    { date: `${y + 1}-04-30`, title: `${y}年年报披露截止（法定）` },
  ];
  return candidates.find(c => c.date > today) ?? null;
}

export function selectFutureEvents(opts: {
  today: string;
  dividends: DividendPlanInput[];
  unlocks: UnlockInput[];
}): FutureEvent[] {
  const { today, dividends, unlocks } = opts;
  const end = addDays(today, FUTURE_WINDOW_DAYS);
  const events: FutureEvent[] = [];

  for (const div of dividends) {
    if (div.exDate && div.exDate > today && div.exDate <= end) {
      events.push({ date: div.exDate, title: `除权除息：${div.plan}`, type: 'dividend' });
    } else if (!div.exDate && /10派[\d.]+元/.test(div.plan)) {
      // 预案/预披露已明确派息方案但未定实施日 → 提示待实施
      events.push({ date: '', title: `${div.plan}（${div.progress}，待实施）`, type: 'dividend' });
    }
  }

  for (const u of unlocks) {
    if (u.freeDate && u.freeDate > today && u.freeDate <= end) {
      const cap = u.marketCap ? `，解禁市值${u.marketCap.toFixed(1)}亿` : '';
      events.push({ date: u.freeDate, title: `限售股解禁${cap}`, type: 'unlock' });
    }
  }

  const report = nextReportSchedule(today);
  if (report && report.date > today && report.date <= end) {
    events.push({ date: report.date, title: report.title, type: 'report' });
  }

  return events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
}
