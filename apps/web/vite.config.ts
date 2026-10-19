// 웹 빌드·개발 서버 설정 (AC-S00-51, AC-S05-91). `pnpm --filter @livejjim/web dev | build | preview`
// 서버는 CORS를 내지 않으므로 화면과 API는 같은 출처로 띄운다: 개발·미리 보기 서버가 /api를 서버로 넘긴다(SSE 포함).
// 서버 주소는 LIVEJJIM_API_URL(기본 http://localhost:3000). 서버의 LIVEJJIM_APP_ORIGIN은 이 화면 주소(예: http://localhost:5173)로 둔다.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env['LIVEJJIM_API_URL'] ?? 'http://localhost:3000'
const proxy = { '/api': { target: apiTarget, changeOrigin: false } }

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
