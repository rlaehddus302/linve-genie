// 쓰기 영역 잠금 (AC-I3-41): 볼 수만 있는 화면이면 안의 칸·버튼을 모두 잠근다(disabled fieldset — 눌러도 아무것도 보내지 않는다).
import type { ReactNode } from 'react'
import { useReadOnly } from '../lib/read-only.ts'

export function Lock({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  const readOnly = useReadOnly()
  return (
    <fieldset className={className === undefined ? 'lock' : `lock ${className}`} disabled={readOnly}>
      {children}
    </fieldset>
  )
}
