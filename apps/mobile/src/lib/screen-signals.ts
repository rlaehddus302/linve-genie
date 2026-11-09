// 쌓인 화면 → 아래 화면 알림 (D-UX4-58): 위 화면에서 바꾼 뒤 돌아가면 아래 화면이 다시 받게 한다(주문 손님 자세히에서 입금 기록 → 주문 목록).
import { useEffect, useRef } from 'react'

const listeners = new Map<string, Set<() => void>>()

export function signalScreens(topic: string): void {
  for (const listener of listeners.get(topic) ?? []) listener()
}

export function useScreenSignal(topic: string, onSignal: () => void): void {
  const latest = useRef(onSignal)
  latest.current = onSignal
  useEffect(() => {
    const fire = () => latest.current()
    let set = listeners.get(topic)
    if (set === undefined) {
      set = new Set()
      listeners.set(topic, set)
    }
    set.add(fire)
    return () => {
      set.delete(fire)
    }
  }, [topic])
}
