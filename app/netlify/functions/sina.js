// Netlify Function: 新浪全球行情代理。
// hq.sinajs.cn 只接受 `Referer: https://finance.sina.com.cn`，浏览器发不了该头，
// 由本函数在服务端补头。路由：/api/sina/* → 本函数（见 public/_redirects）。
// 注意：event.rawUrl 可能不含查询串，需显式拼 event.rawQuery。
export default async (event) => {
  // list=... 是路径段（非 query），用 event.path 取，避免 rawUrl/rawQuery 编码问题
  // Netlify Functions v2 passes a standard Request, while legacy/local runtimes
  // pass an event object. Preserve both formats so the rewritten path is not lost.
  const requestUrl = typeof event?.url === 'string' ? new URL(event.url) : null;
  const path = requestUrl
    ? requestUrl.pathname
      .replace(/^\/api\/sina/, '')
      .replace(/^\/\.netlify\/functions\/sina/, '')
    : (event.path || '').replace(/^\/api\/sina/, '');
  const qs = requestUrl
    ? requestUrl.searchParams.toString()
    : new URLSearchParams(event.queryStringParameters || {}).toString();
  const target = `https://hq.sinajs.cn${path}${qs ? `?${qs}` : ''}`;
  try {
    const upstream = await fetch(target, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    const bytes = await upstream.arrayBuffer();
    const text = new TextDecoder('gbk').decode(bytes);
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (error) {
    return new Response(`sina proxy error: ${error instanceof Error ? error.message : String(error)}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
};
