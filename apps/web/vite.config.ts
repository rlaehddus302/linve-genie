// 웹 빌드·개발 서버 설정 (AC-S00-51). `pnpm --filter @livejjim/web dev | build | preview`
// S00은 서버를 부르지 않으므로 프록시를 두지 않는다.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
})
