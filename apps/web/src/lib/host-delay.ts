// 방송자 조치 대기 시간 (D-083): 서버 /api/client-config의 hostActionDelayMs(운영 5000). 읽지 못하면 운영 값.
import { useEffect, useState } from 'react'
import { get } from '../api/client.ts'
import { HOST_ACTION_DELAY_MS, UndoQueue } from './undo-queue.ts'

export function useHostDelay(): number | null {
  const [delay, setDelay] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    get<{ hostActionDelayMs: number }>('/api/client-config').then(
      (config) => {
        if (alive) setDelay(Number.isFinite(config.hostActionDelayMs) && config.hostActionDelayMs >= 0 ? config.hostActionDelayMs : HOST_ACTION_DELAY_MS)
      },
      () => {
        if (alive) setDelay(HOST_ACTION_DELAY_MS)
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return delay
}

/** 화면이 열린 동안의 되돌리기 목록. 화면이 내려가면(다른 화면·새로고침·로그아웃) 기다리던 조치는 보내지 않는다 (D-083) */
export function useUndoQueue(): UndoQueue | null {
  const delay = useHostDelay()
  const [queue, setQueue] = useState<UndoQueue | null>(null)
  useEffect(() => {
    if (delay === null) return
    const next = new UndoQueue({ delayMs: delay })
    setQueue(next)
    return () => next.cancelAll()
  }, [delay])
  return queue
}
