import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { assertProductionAuthEnvironment } from './src/infrastructure/cloud/cloud-environment.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (mode === 'production') assertProductionAuthEnvironment(env)

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/deepseek': {
          target: 'https://api.deepseek.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/deepseek/, ''),
        },
        '/api/kimi': {
          target: 'https://api.moonshot.cn',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/kimi/, ''),
        },
        '/api/openai': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/openai/, ''),
        },
        '/api/market/kline': {
          target: 'https://money.finance.sina.com.cn',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/market\/kline/, '/quotes_service/api/json_v2.php/CN_MarketData.getKLineData'),
        },
        '/api/emf10': {
          target: 'https://emweb.securities.eastmoney.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/emf10/, ''),
        },
        // 新浪全球行情：浏览器里 Referer 是 forbidden header（setRequestHeader 会被忽略），
        // 且新浪只认 finance.sina.com.cn 的 Referer，必须在服务端补头，否则 403。
        '/api/sina': {
          target: 'https://hq.sinajs.cn',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/sina/, ''),
          headers: { Referer: 'https://finance.sina.com.cn' },
        },
        // 东财个股公告：直连会撞上浏览器 IPv6 无路由（DNS 含 IPv6 地址），走同源代理用 IPv4 拉取。
        // 且浏览器自动带的 `Referer: http://localhost:5173/...` 会触发东财 WAF 返回 567 验证页，
        // 转发时必须把 Referer 改成东财来源。
        '/api/news': {
          target: 'https://np-anotice-stock.eastmoney.com/api',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/news/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Referer', 'https://data.eastmoney.com');
            });
          },
        },
      },
    },
  }
})
