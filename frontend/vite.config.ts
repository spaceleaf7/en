/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 开发时把 /api 转发给 FastAPI 后端，前后端同源，refresh token Cookie 无需跨域
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  test: {
    // 学习日按本地时区切分；固定时区保证测试结果与后端一致性 fixture 可复现
    env: { TZ: 'Asia/Shanghai' },
  },
})
