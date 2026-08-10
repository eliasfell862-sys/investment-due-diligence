// Vercel serverless proxy for hq.sinajs.cn.
//
// 新浪全球行情要求请求带 `Referer: https://finance.sina.com.cn`，否则返回 403。
// 浏览器无法设置 Referer（forbidden header），本地走 vite 代理补头（见 vite.config.ts），
// 生产环境走本函数在服务端补头。
//
// 用法：GET /api/sina/list=gb_aapl,gb_tsla  →  https://hq.sinajs.cn/list=gb_aapl,gb_tsla
export default async function handler(req, res) {
  const targetUrl = `https://hq.sinajs.cn${req.url}`;
  try {
    const upstream = await fetch(targetUrl, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'text/plain; charset=GBK');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(text);
  } catch (error) {
    res.status(502).send(`sina proxy error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
