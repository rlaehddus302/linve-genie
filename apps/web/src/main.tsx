// 웹 진입점: index.html의 #root에 첫 화면을 붙인다. 서버 호출·외부 리소스는 없다 (AC-S00-50).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('index.html에 화면을 붙일 자리(#root)가 없어요.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
