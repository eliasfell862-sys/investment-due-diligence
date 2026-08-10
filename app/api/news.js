// Vercel serverless proxy for np-anotice-stock.eastmoney.com (个股公告).
//
// 浏览器自动带 `Referer: <本站域名>`，东财 WAF 对非东财来源 Referer 返回 567 验证页。
// 本地走 vite 代理补 Referer（见 vite.config.ts），生产走本函数在服务端改写 Referer。
//
// 用法：GET /api/news/security/ann?...  →  https://np-anotice-stock.eastmoney.com/api/security/ann?...
export default async function handler(req, res) {
  const targetUrl = `https://np-anotice-stock.eastmoney.com/api${req.url}`;
  try {
    const upstream = await fetch(targetUrl, {
      headers: { Referer: 'https://data.eastmoney.com' },
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(text);
  } catch (error) {
    res.status(502).send(`news proxy error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
