// 시간이 지난 보류 찜 표시의 시계 (D-MOB2-06). 1초마다 그리지 않고, 다음에 보류 찜 하나가 "시간 지남"으로 바뀌는 순간
// (at + W×1000 + 1ms)에 한 번 다시 그린다 — 화면 낱말·알림 수가 1초 안에 바뀐다. 시계는 Date.now·setTimeout(시험의 당긴 시계가 그대로 쓰인다).
import { useEffect, useMemo, useState } from 'react'
import { nextPendingFlip } from './derive.ts'
import type { ScopeData } from './scope-data.ts'

/** 너무 먼 때(브라우저 타이머 상한 넘음)는 이만큼 뒤에 다시 본다 */
const MAX_WAIT_MS = 60 * 60 * 1000

export function usePendingNow(data: Pick<ScopeData, 'broadcasts' | 'products' | 'pending' | 'claims'>): number {
  const [tick, setTick] = useState(0)
  // 자료가 바뀌거나 타이머가 울리면(tick) 그때의 지금 시각을 다시 읽는다
  const now = useMemo(() => Date.now(), [data, tick])
  useEffect(() => {
    const flip = nextPendingFlip(data, now)
    if (flip === null) return
    const handle = setTimeout(() => setTick((value) => value + 1), Math.min(MAX_WAIT_MS, Math.max(0, flip - now)))
    return () => clearTimeout(handle)
  }, [data, now])
  return now
}
