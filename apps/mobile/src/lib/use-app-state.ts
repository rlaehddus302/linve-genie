// 앱이 뒤로 갔다 앞으로 돌아오는 것을 듣는다 (APP-04). React Native AppState('active' ↔ 'background'/'inactive').
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

export interface AppStateHandlers {
  readonly onBackground?: () => void
  readonly onForeground?: () => void
}

export function useAppForeground(handlers: AppStateHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    let active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
    const subscription = AppState.addEventListener('change', (next) => {
      const nowActive = next === 'active'
      if (nowActive && !active) ref.current.onForeground?.()
      else if (!nowActive && active) ref.current.onBackground?.()
      active = nowActive
    })
    return () => subscription.remove()
  }, [])
}
