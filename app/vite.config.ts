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
      },
    },
  }
})
