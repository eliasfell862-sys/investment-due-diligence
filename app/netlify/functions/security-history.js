// Netlify Function: Sina daily K-line proxy.
// Route: /api/securities/history -> this function (see public/_redirects).
export default async (event) => {
  const query = event.rawQuery || '';
  const target = `https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData${query ? `?${query}` : ''}`;

  try {
    const upstream = await fetch(target, {
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    return new Response(
      `security history proxy error: ${error instanceof Error ? error.message : String(error)}`,
      { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
};
