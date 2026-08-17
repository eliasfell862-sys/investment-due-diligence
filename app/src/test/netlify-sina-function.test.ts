import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Netlify deploys this runtime entry as JavaScript.
import handler from '../../netlify/functions/sina.js';

describe('sina Netlify function', () => {
  it('forwards a Netlify v2 Request using its original path and query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await handler(new Request(
      'https://example.netlify.app/api/sina/list=sh000001?format=text',
    ) as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hq.sinajs.cn/list=sh000001?format=text',
      { headers: { Referer: 'https://finance.sina.com.cn' } },
    );
  });
  it('decodes upstream GBK bytes and returns UTF-8 text', async () => {
    const prefix = new TextEncoder().encode('v_sz000333="51~');
    const name = Uint8Array.from([0xc3, 0xc0, 0xb5, 0xc4, 0xbc, 0xaf, 0xcd, 0xc5]);
    const suffix = new TextEncoder().encode('~000333";');
    const body = new Uint8Array(prefix.length + name.length + suffix.length);
    body.set(prefix);
    body.set(name, prefix.length);
    body.set(suffix, prefix.length + name.length);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

    const response = await handler(new Request(
      'https://example.netlify.app/api/sina/list=sz000333',
    ) as never);

    expect(await response.text()).toContain('美的集团');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });
});
