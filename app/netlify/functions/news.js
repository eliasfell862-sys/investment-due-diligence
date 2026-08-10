// Netlify Function: 东财个股公告代理。
// np-anotice-stock.eastmoney.com 的 WAF 对非东财来源 Referer 返回 567，浏览器
// 自动带的站点 Referer 会触发，由本函数在服务端改写为东财来源。
// 路由：/api/news/* → 本函数（见 public/_redirects）。
// 注意：event.rawUrl 可能不含查询串，需显式拼 event.rawQuery。
export default async (event) => {
  const raw = event.rawUrl || '';
  let rest = raw.includes('/api/news') ? (raw.split('/api/news')[1] ?? '') : '';
  if (!rest) {
    const path = (event.path || '').replace(/^\/api\/news/, '');
    const qs = event.rawQuery ? `?${event.rawQuery}` : '';
    rest = `${path}${qs}`;
  }
  const target = `https://np-anotice-stock.eastmoney.com/api${rest}`;
  try {
    const upstream = await fetch(target, {
      headers: { Referer: 'https://data.eastmoney.com' },
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    return new Response(`news proxy error: ${error instanceof Error ? error.message : String(error)}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
};
