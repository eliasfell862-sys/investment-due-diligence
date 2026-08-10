/**
 * 个股新闻/公告抓取 —— 东方财富公告 API。
 *
 * np-anotice-stock.eastmoney.com 返回 `Access-Control-Allow-Origin: *`，浏览器
 * 可直连（走 XHR，符合项目"行情数据用 XHR 不用 fetch"的约定）。公告标题自带
 * 利好/利空信号（业绩预增、减持、分红、诉讼等），是情绪引擎的输入源。
 */
import { createMarketDataMeta, currentMarketDataTime, type MarketDataResult } from '../market-data/market-data-meta';

export interface StockNewsItem {
  id: string;
  title: string;
  columnName: string;
  noticeDate: string; // YYYY-MM-DD
  stockCode: string;
  stockName: string;
}

const ANNOUNCEMENT_URL = 'https://np-anotice-stock.eastmoney.com/api/security/ann';

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

/** 解析东财公告响应为结构化新闻项；空/异常响应返回 []。 */
export function parseAnnouncementResponse(text: string): StockNewsItem[] {
  try {
    const payload = JSON.parse(text);
    const rows = payload?.data?.list;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row: any) => {
      const codes = Array.isArray(row?.codes) ? row.codes : [];
      const primary = codes[0];
      if (!primary?.stock_code || !row?.title_ch) return [];
      return [{
        id: row.art_code ?? '',
        title: row.title_ch,
        columnName: Array.isArray(row?.columns) && row.columns[0] ? row.columns[0].column_name ?? '' : '',
        noticeDate: String(row.notice_date || row.display_time || '').slice(0, 10),
        stockCode: primary.stock_code,
        stockName: primary.short_name ?? '',
      }];
    });
  } catch {
    return [];
  }
}

const NEWS_RETRY_DELAYS_MS = [600, 1800] as const;  // 退避重试：最多 3 次尝试

/**
 * 抓取单只股票的最近公告。网络抖动时按 NEWS_RETRY_DELAYS_MS 退避重试；
 * 全部失败优雅降级：返回空列表 + error 状态（友好文案），不阻塞调用方。
 */
export async function fetchStockNews(code: string, count = 20): Promise<MarketDataResult<StockNewsItem[]>> {
  const source = '东方财富个股公告';
  for (let attempt = 0; attempt <= NEWS_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, NEWS_RETRY_DELAYS_MS[attempt - 1]!));
    }
    try {
      const url = `${ANNOUNCEMENT_URL}?sr=-1&page_size=${count}&page_index=1&ann_type=A&client_source=web&stock_list=${code}`;
      const text = await xhrGet(url, 8000);
      const items = parseAnnouncementResponse(text);
      return { data: items, meta: createMarketDataMeta({ source, mode: 'realtime', status: 'success', asOf: currentMarketDataTime() }) };
    } catch {
      /* 网络抖动，按退避重试 */
    }
  }
  return {
    data: [],
    meta: createMarketDataMeta({
      source, mode: 'realtime', status: 'error', asOf: currentMarketDataTime(),
      error: '公告数据暂不可用，请稍后刷新',
    }),
  };
}
