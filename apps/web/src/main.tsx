// 웹 진입점: index.html의 #root에 첫 화면을 붙인다. 외부 리소스는 없다 (AC-S00-50).
// PWA(D-093): 설치 제안을 먼저 받아 두고(화면이 그리기 전에 올 수 있다), 운영용 빌드에서만 서비스 워커를 등록한다.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { startPwa } from './pwa/pwa.ts'
import './styles.css'

startPwa({ serviceWorker: import.meta.env.PROD })

const container = document.getElementById('root')
if (!container) throw new Error('index.html에 화면을 붙일 자리(#root)가 없어요.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
