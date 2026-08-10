/**
 * 未来事件抓取 —— 解禁（东财数据中心 RPT_LIFT_STAGE）+ 除权除息（F10 BonusFinancing）。
 *
 * 都走同源代理（/api/emdc、/api/emf10），由服务端用 IPv4 拉取，绕开浏览器
 * IPv6 无路由问题。解析结果喂给 future-events-engine 选出未来窗口内的事件。
 */
import { createMarketDataMeta, currentMarketDataTime, type MarketDataResult } from '../market-data/market-data-meta';
import { selectFutureEvents, type DividendPlanInput, type FutureEvent, type UnlockInput } from '../../engines/market-analysis/future-events-engine';

export interface UnlockEvent extends UnlockInput {}
export interface DividendEvent extends DividendPlanInput {}

function xhrGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const timer = setTimeout(() => { xhr.abort(); reject(new Error('timeout')); }, timeoutMs);
    xhr.open('GET', url);
    xhr.onload = () => {
      clearTimeout(timer);
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new Error(`request failed: ${xhr.status}`));
    };
    xhr.onerror = () => { clearTimeout(timer); reject(new Error('xhr error')); };
    xhr.ontimeout = () => { clearTimeout(timer); reject(new Error('timeout')); };
    xhr.send();
  });
}

/** 解析东财解禁响应。LIFT_MARKET_CAP 单位为万元 → 换算成亿元。 */
export function parseUnlockResponse(text: string): UnlockEvent[] {
  try {
    const payload = JSON.parse(text);
    const rows = payload?.result?.data;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row: any) => {
      const freeDate = String(row.FREE_DATE ?? '').slice(0, 10);
      if (!freeDate) return [];
      const capWan = Number(row.LIFT_MARKET_CAP) || 0;
      return [{ freeDate, marketCap: capWan > 0 ? capWan / 10000 : null }];
    });
  } catch {
    return [];
  }
}

/** 解析 F10 分红融资 fhyx。 */
export function parseDividendEvents(text: string): DividendEvent[] {
  try {
    const payload = JSON.parse(text);
    const rows = payload?.fhyx;
    if (!Array.isArray(rows)) return [];
    return rows.map((row: any) => ({
      exDate: row.EX_DIVIDEND_DATE ? String(row.EX_DIVIDEND_DATE).slice(0, 10) : null,
      plan: String(row.IMPL_PLAN_PROFILE ?? ''),
      progress: String(row.ASSIGN_PROGRESS ?? ''),
    }));
  } catch {
    return [];
  }
}

/** 抓取个股未来限售解禁。失败优雅降级返回空列表 + error 状态。 */
export async function fetchUnlockEvents(code: string): Promise<MarketDataResult<UnlockEvent[]>> {
  const source = '东方财富限售解禁';
  try {
    const url = `/api/emdc?reportName=RPT_LIFT_STAGE&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=20&pageNumber=1&sortColumns=FREE_DATE&sortTypes=1`;
    const text = await xhrGet(url, 8000);
    const data = parseUnlockResponse(text);
    return { data, meta: createMarketDataMeta({ source, mode: 'realtime', status: 'success', asOf: currentMarketDataTime() }) };
  } catch (error) {
    return {
      data: [],
      meta: createMarketDataMeta({ source, mode: 'realtime', status: 'error', asOf: currentMarketDataTime(), error: '解禁数据暂不可用' }),
    };
  }
}

/** 抓取个股分红计划（含预案）。 */
export async function fetchDividendEvents(code: string): Promise<MarketDataResult<DividendEvent[]>> {
  const source = '东方财富分红融资';
  try {
    const prefix = code.startsWith('6') ? 'SH' : 'SZ';
    const text = await xhrGet(`/api/emf10/PC_HSF10/BonusFinancing/PageAjax?code=${prefix}${code}`, 8000);
    const data = parseDividendEvents(text);
    return { data, meta: createMarketDataMeta({ source, mode: 'realtime', status: 'success', asOf: currentMarketDataTime() }) };
  } catch {
    return {
      data: [],
      meta: createMarketDataMeta({ source, mode: 'realtime', status: 'error', asOf: currentMarketDataTime(), error: '分红数据暂不可用' }),
    };
  }
}

function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 组装未来事件：解禁 + 分红 + 法定披露日历 → 未来 45 天窗口内按日期排序。 */
export async function fetchFutureEvents(code: string, today: string = localToday()): Promise<MarketDataResult<FutureEvent[]>> {
  const [unlockRes, divRes] = await Promise.all([fetchUnlockEvents(code), fetchDividendEvents(code)]);
  const events = selectFutureEvents({ today, dividends: divRes.data, unlocks: unlockRes.data });
  const bothFailed = unlockRes.meta.status === 'error' && divRes.meta.status === 'error';
  return {
    data: events,
    meta: createMarketDataMeta({
      source: '东方财富未来事件', mode: 'realtime',
      status: bothFailed ? 'error' : 'success', asOf: currentMarketDataTime(),
      error: bothFailed ? '未来事件数据暂不可用' : undefined,
    }),
  };
}
