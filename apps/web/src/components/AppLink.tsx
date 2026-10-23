// 앱 안 이동 링크 (PL1B, U-PL1B-02·06): 화면 어디서든(이동 함수를 받지 않은 조각 — 라벨 꺼짐 안내·포장 라벨 결과) 다른 화면으로 가는 링크.
// - 앱이 준 이동 함수(NavigateContext)가 있으면 그걸로 옮긴다(5초 대기 조치가 있으면 먼저 묻는 길 그대로). 없으면 보통 링크(주소로 연다).
// - 새 탭·창으로 여는 클릭(가운데 단추·Ctrl·⌘·Shift·Alt)은 브라우저에 맡긴다.
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react'
import { routePath, type Navigate, type Route } from '../lib/router.ts'

export const NavigateContext = createContext<Navigate | null>(null)

export function AppLink({ to, className = 'text-link', label, children }: { readonly to: Route; readonly className?: string; readonly label?: string; readonly children: ReactNode }) {
  const navigate = useContext(NavigateContext)
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (navigate === null || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  return (
    <a className={className} href={routePath(to)} aria-label={label} onClick={onClick}>
      {children}
    </a>
  )
}
