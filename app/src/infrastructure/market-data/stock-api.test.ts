import { describe, expect, it, vi } from 'vitest';
import { fetchAllAStocks, filterAStocks } from './stock-api';

describe('A-share stock directory', () => {
  it('loads every page and removes duplicate stock codes', async () => {
    const request = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('pn'));
      const pages = {
        1: [
          { f12: '000001', f14: '平安银行', f100: '银行' },
          { f12: '000002', f14: '万科A', f100: '房地产' },
        ],
        2: [
          { f12: '000002', f14: '万科A', f100: '房地产' },
          { f12: '600519', f14: '贵州茅台', f100: '酿酒行业' },
        ],
        3: [
          { f12: '300750', f14: '宁德时代', f100: '电池' },
        ],
      } as const;

      return { data: { total: 4, diff: pages[page as keyof typeof pages] ?? [] } };
    });

    const stocks = await fetchAllAStocks({ pageSize: 2, request });

    expect(request).toHaveBeenCalledTimes(3);
    expect(stocks.map((stock) => stock.code)).toEqual([
      '000001',
      '000002',
      '300750',
      '600519',
    ]);
  });

  it('uses the JSONP fallback when browser fetch is blocked', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const fallbackRequest = vi.fn().mockResolvedValue({
      data: {
        total: 1,
        diff: [{ f12: '688981', f14: '中芯国际', f100: '半导体' }],
      },
    });

    const stocks = await fetchAllAStocks({ request, fallbackRequest });

    expect(fallbackRequest).toHaveBeenCalledOnce();
    expect(stocks[0]).toMatchObject({ code: '688981', name: '中芯国际' });
  });

  it('supports industry-only browsing and code or name search', () => {
    const stocks = [
      { code: '000001', name: '平安银行', industry: '银行' },
      { code: '600519', name: '贵州茅台', industry: '酿酒行业' },
      { code: '300750', name: '宁德时代', industry: '电池' },
    ];

    expect(filterAStocks(stocks, '', '银行')).toEqual([stocks[0]]);
    expect(filterAStocks(stocks, '600519', '')).toEqual([stocks[1]]);
    expect(filterAStocks(stocks, '宁德', '')).toEqual([stocks[2]]);
  });
});
