import { describe, expect, it, vi } from 'vitest';
import {
  EASTMONEY_QUOTE_HOSTS,
  replaceEastmoneyHost,
  requestWithEastmoneyFailover,
} from './eastmoney-host-failover';

describe('eastmoney host failover', () => {
  const baseUrl = 'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519';

  it('returns from the primary host on first success without retries', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const result = await requestWithEastmoneyFailover(baseUrl, request, 8000);

    expect(result).toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(baseUrl, 8000);
  });

  it('fails over to the backup host when the primary host rejects', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('network reset'))
      .mockResolvedValueOnce({ ok: true });

    const result = await requestWithEastmoneyFailover(baseUrl, request, 8000);

    expect(result).toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toBe('https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519');
    expect(request.mock.calls[1]?.[0]).toBe('https://push2his.eastmoney.com/api/qt/stock/get?secid=1.600519');
  });

  it('throws the last error once every host fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('all down'));
    await expect(requestWithEastmoneyFailover(baseUrl, request, 8000)).rejects.toThrow('all down');
    expect(request).toHaveBeenCalledTimes(EASTMONEY_QUOTE_HOSTS.length);
  });

  it('replaces the primary host in the URL, leaving other hosts untouched', () => {
    expect(replaceEastmoneyHost(baseUrl, 'push2his.eastmoney.com')).toBe(
      'https://push2his.eastmoney.com/api/qt/stock/get?secid=1.600519',
    );
    // push2his 打头的 URL 不误改
    const hisUrl = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000300';
    expect(replaceEastmoneyHost(hisUrl, 'push2delay.eastmoney.com')).toBe(hisUrl);
  });
});
