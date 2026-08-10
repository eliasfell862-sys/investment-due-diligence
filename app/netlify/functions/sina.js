// Netlify Function: 新浪全球行情代理。
// hq.sinajs.cn 只接受 `Referer: https://finance.sina.com.cn`，浏览器发不了该头，
// 由本函数在服务端补头。路由：/api/sina/* → 本函数（见 public/_redirects）。
export default async (event) => {
  const raw = event.rawUrl || event.path || '';
  const rest = raw.split('/api/sina')[1] ?? '';
  const target = `https://hq.sinajs.cn${rest}`;
  try {
    const upstream = await fetch(target, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { 'Content-Type': 'text/plain; charset=GBK', 'Cache-Control': 'no-cache' },
      body: text,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: `sina proxy error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
