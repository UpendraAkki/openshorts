import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local `npm run dev`: defaults to localhost. Docker Compose sets these to service hostnames.
const apiProxyTarget = process.env.OPENSORTS_API_PROXY ?? 'http://127.0.0.1:8000'
const renderProxyTarget = process.env.OPENSORTS_RENDER_PROXY ?? 'http://127.0.0.1:3100'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      'openshorts.app',
      'www.openshorts.app'
    ],
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/videos': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/thumbnails': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/gallery': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/video': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/render': {
        target: renderProxyTarget,
        changeOrigin: true,
      }
    }
  }
})
