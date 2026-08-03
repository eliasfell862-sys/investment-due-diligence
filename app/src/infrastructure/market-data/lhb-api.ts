/**
 * Dragon-Tiger Board (龙虎榜) API — TypeScript port of InStock's stock_lhb_em.
 * Eastmoney datacenter API for daily institutional trading rankings.
 *
 * Original: instock/core/crawling/stock_lhb_em.py
 */

export interface LHBRecord {
  code: string;
  name: string;
  date: string;
  reason: string;
  closePrice: number;
  changeRate: number;
  /** 龙虎榜净买额(元) */
  netAmt: number;
  /** 龙虎榜买入额(元) */
  buyAmt: number;
  /** 龙虎榜卖出额(元) */
  sellAmt: number;
  /** 龙虎榜成交额(元) */
  dealAmt: number;
  /** 总成交额(元) */
  totalAmt: number;
  /** 净买额占总成交比(%) */
  netRatio: number;
  /** 成交额占总成交比(%) */
  dealRatio: number;
  /** 换手率(%) */
  turnoverRate: number;
  /** 流通市值(元) */
  freeCap: number;
  /** 后续1/2/5/10日涨跌幅(%) */
  d1Return: number;
  d2Return: number;
  d5Return: number;
  d10Return: number;
}

// ── Fetch today's LHB ──
export async function fetchLHBToday(page: number = 1, pageSize: number = 50): Promise<LHBRecord[]> {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return fetchLHB(dateStr, dateStr, page, pageSize);
}

// ── Fetch LHB by date range ──
export async function fetchLHB(
  startDate: string,
  endDate: string,
  page: number = 1,
  pageSize: number = 50,
): Promise<LHBRecord[]> {
  const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?' + [
    'sortColumns=SECURITY_CODE,TRADE_DATE',
    'sortTypes=1,-1',
    `pageSize=${pageSize}`,
    `pageNumber=${page}`,
    'reportName=RPT_DAILYBILLBOARD_DETAILSNEW',
    'columns=SECURITY_CODE,SECUCODE,SECURITY_NAME_ABBR,TRADE_DATE,EXPLAIN,CLOSE_PRICE,CHANGE_RATE,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,BILLBOARD_DEAL_AMT,ACCUM_AMOUNT,DEAL_NET_RATIO,DEAL_AMOUNT_RATIO,TURNOVERRATE,FREE_MARKET_CAP,EXPLANATION,D1_CLOSE_ADJCHRATE,D2_CLOSE_ADJCHRATE,D5_CLOSE_ADJCHRATE,D10_CLOSE_ADJCHRATE,SECURITY_TYPE_CODE',
    'source=WEB',
    'client=WEB',
    `filter=(TRADE_DATE<='${endDate}')(TRADE_DATE>='${startDate}')`,
  ].join('&');

  try {
    const text = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 10000);
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.setRequestHeader('Referer', 'https://data.eastmoney.com');
      xhr.onload = () => { clearTimeout(timer); resolve(xhr.responseText); };
      xhr.onerror = () => { clearTimeout(timer); reject(new Error('xhr error')); };
      xhr.ontimeout = () => { clearTimeout(timer); reject(new Error('timeout')); };
      xhr.send();
    });
    const data = JSON.parse(text);
    const items = data?.result?.data || [];

    return items.map((item: any) => ({
      code: item.SECURITY_CODE || '',
      name: item.SECURITY_NAME_ABBR || '',
      date: item.TRADE_DATE || '',
      reason: item.EXPLAIN || '',
      closePrice: item.CLOSE_PRICE || 0,
      changeRate: item.CHANGE_RATE || 0,
      netAmt: item.BILLBOARD_NET_AMT || 0,
      buyAmt: item.BILLBOARD_BUY_AMT || 0,
      sellAmt: item.BILLBOARD_SELL_AMT || 0,
      dealAmt: item.BILLBOARD_DEAL_AMT || 0,
      totalAmt: item.ACCUM_AMOUNT || 0,
      netRatio: item.DEAL_NET_RATIO || 0,
      dealRatio: item.DEAL_AMOUNT_RATIO || 0,
      turnoverRate: item.TURNOVERRATE || 0,
      freeCap: item.FREE_MARKET_CAP || 0,
      d1Return: item.D1_CLOSE_ADJCHRATE || 0,
      d2Return: item.D2_CLOSE_ADJCHRATE || 0,
      d5Return: item.D5_CLOSE_ADJCHRATE || 0,
      d10Return: item.D10_CLOSE_ADJCHRATE || 0,
    }));
  } catch {
    return [];
  }
}

/** Format amount to readable */
export function fmtLHBAmt(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(0)}万`;
  return `${value.toFixed(0)}`;
}
