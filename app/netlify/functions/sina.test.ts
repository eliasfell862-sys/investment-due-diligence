import { describe, expect, it, vi } from 'vitest';
import handler from './sina.js';

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
});
