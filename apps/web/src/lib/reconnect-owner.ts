// 한 화면에 이 기기의 프린터를 다시 잇는 "다시 연결"은 하나 (QL2 D-QL2-03 (c), LABEL_RULES L-7).
// 화면 안에 프린터 칸(라벨 화면·마법사 4/5)이나 출력 멈춤 띠(라벨 화면·알림 띠 "출력 멈춤" 창)가 떠 있으면 그 화면이 "다시 연결"을 맡는다 —
// 위 줄(TopBar) 프린터 상태 옆 "다시 연결"(D-WIZ-01, AC-WIZ-04)은 그동안 숨는다. 그 밖의 화면에서는 위 줄 그대로.
import { useEffect, useSyncExternalStore } from 'react'

let owners = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 이 부품이 떠 있는 동안 화면이 "다시 연결"을 맡는다 */
export function useOwnReconnect(on = true): void {
  useEffect(() => {
    if (!on) return
    owners++
    notify()
    return () => {
      owners--
      notify()
    }
  }, [on])
}

/** 화면 안의 부품이 "다시 연결"을 맡고 있나 (위 줄이 숨는다) */
export function useReconnectOwned(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => owners > 0,
    () => false,
  )
}
