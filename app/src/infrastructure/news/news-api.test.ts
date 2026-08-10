import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStockNews, parseAnnouncementResponse } from './news-api';

function stubXHR(status: number, text: string) {
  class FakeXHR {
    status = status;
    responseText = text;
    open = vi.fn();
    send = vi.fn(() => { this.onload?.(); });
    abort = vi.fn();
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
  }
  (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('parseAnnouncementResponse', () => {
  const fixture = JSON.stringify({
    data: { list: [
      {
        art_code: 'AN202607171827064564',
        codes: [{ ann_type: 'A,SHA', market_code: '1', short_name: '贵州茅台', stock_code: '600519' }],
        columns: [{ column_code: '001002008', column_name: '其他' }],
        notice_date: '2026-07-18 00:00:00',
        display_time: '2026-07-17 21:26:22:245',
        title_ch: '贵州茅台:贵州茅台重大事项公告',
      },
      {
        art_code: 'AN202606211823708334',
        codes: [{ short_name: '贵州茅台', stock_code: '600519' }],
        columns: [{ column_code: '001002002001005', column_name: '分配方案实施' }],
        notice_date: '2026-06-22 00:00:00',
        title_ch: '贵州茅台:贵州茅台2025年年度权益分派实施公告',
      },
    ]},
  });

  it('parses announcement rows into structured news items', () => {
    const items = parseAnnouncementResponse(fixture);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'AN202607171827064564',
      title: '贵州茅台:贵州茅台重大事项公告',
      columnName: '其他',
      noticeDate: '2026-07-18',
      stockCode: '600519',
      stockName: '贵州茅台',
    });
    expect(items[1].columnName).toBe('分配方案实施');
    expect(items[1].noticeDate).toBe('2026-06-22');
  });

  it('returns [] for malformed / empty payloads', () => {
    expect(parseAnnouncementResponse('not json')).toEqual([]);
    expect(parseAnnouncementResponse('{"data":{"list":null}}')).toEqual([]);
    expect(parseAnnouncementResponse('{"data":{}}')).toEqual([]);
    expect(parseAnnouncementResponse('')).toEqual([]);
  });

  it('skips rows without a valid stock code or title', () => {
    const payload = JSON.stringify({ data: { list: [
      { art_code: 'x', codes: [], title_ch: '无代码' },
      { art_code: 'y', codes: [{ stock_code: '000001' }], title_ch: '' },
      { art_code: 'z', codes: [{ stock_code: '000002', short_name: '万科A' }], title_ch: '万科A:正常公告' },
    ]}});
    const items = parseAnnouncementResponse(payload);
    expect(items).toHaveLength(1);
    expect(items[0].stockCode).toBe('000002');
  });
});

describe('fetchStockNews', () => {
  it('reports non-2xx status as error instead of fake empty success', async () => {
    stubXHR(500, 'server error');
    const result = await fetchStockNews('600519', 5);
    expect(result.meta.status).toBe('error');
    expect(result.data).toEqual([]);
  });

  it('parses a 2xx success response into items', async () => {
    stubXHR(200, JSON.stringify({ data: { list: [
      { art_code: 'a1', codes: [{ stock_code: '600519', short_name: '贵州茅台' }],
        columns: [{ column_name: '其他' }], notice_date: '2026-07-18 00:00:00', title_ch: '贵州茅台:重大事项公告' },
    ]}}));
    const result = await fetchStockNews('600519', 5);
    expect(result.meta.status).toBe('success');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toContain('重大事项');
  });
});
