/**
 * Block Trade (大宗交易) API — TypeScript port of InStock's stock_dzjy_em.
 * Eastmoney datacenter API for large block trade data.
 *
 * Original: instock/core/crawling/stock_dzjy_em.py
 */

export interface BlockTrade {
  code: string;
  name: string;
  date: string;
  price: number;
  volume: number;       // 成交量(万股)
  amount: number;        // 成交额(万元)
  buyerDept: string;     // 买方营业部
  sellerDept: string;    // 卖方营业部
  discount: number;      // 折溢价率(%)
}

export async function fetchBlockTrades(
  page: number = 1,
  pageSize: number = 50,
): Promise<BlockTrade[]> {
  const today = new Date();
  const endDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const startDate = `${today.getFullYear()}-01-01`;

  const params = new URLSearchParams({
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
    pageSize: String(pageSize),
    pageNumber: String(page),
    reportName: 'RPT_BLOCKTRADE_DETAILS',
    columns: 'SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,CLOSE_PRICE,TRADE_VOL,TRADE_AMT,BUYER_DEPT_NAME,SELLER_DEPT_NAME,DISCOUNT_RATIO',
    source: 'WEB',
    client: 'WEB',
    filter: `(TRADE_DATE<='${endDate}')(TRADE_DATE>='${startDate}')`,
  });

  try {
    const text = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 10000);
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `https://datacenter-web.eastmoney.com/api/data/v1/get?${params}`);
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
      date: item.TRADE_DATE?.slice(0, 10) || '',
      price: item.CLOSE_PRICE || 0,
      volume: (item.TRADE_VOL || 0) / 10000,
      amount: (item.TRADE_AMT || 0) / 10000,
      buyerDept: item.BUYER_DEPT_NAME || '',
      sellerDept: item.SELLER_DEPT_NAME || '',
      discount: item.DISCOUNT_RATIO || 0,
    }));
  } catch {
    return [];
  }
}
