// 모두에게 정산서 보내기 차례 (D-RETRO-64·D-UX4-174 → D-UX4-198): 구매자 정산서가 진짜 쌓인 화면(/console/<방송>/statement)이 되어
// 정산서 목록과 그 화면이 같은 차례를 본다 — 목록이 차례를 정하고 첫 손님 화면을 쌓으면, 쌓인 화면이 다음 손님으로 넘기고 마치면 알림 한 줄을 남긴다.
// 방송마다 하나. 앱 안 기억뿐(서버·기기 저장소에 남기지 않는다).
import { useSyncExternalStore } from 'react'

export interface StatementQueue {
  /** 번호를 아는 구매자 차례 (D-UX4-174) */
  readonly keys: readonly string[]
}

const queues = new Map<string, StatementQueue>()
const notes = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0
const emit = () => {
  version += 1
  for (const listener of listeners) listener()
}

export function startSendQueue(broadcastId: string, keys: readonly string[]): void {
  queues.set(broadcastId, { keys: [...keys] })
  notes.delete(broadcastId)
  emit()
}

/** 차례를 끝낸다 — note가 있으면 목록 위에 한 줄로 남긴다 */
export function endSendQueue(broadcastId: string, note?: string): void {
  const had = queues.delete(broadcastId)
  if (note !== undefined) notes.set(broadcastId, note)
  if (had || note !== undefined) emit()
}

export function sendQueueOf(broadcastId: string): StatementQueue | null {
  return queues.get(broadcastId) ?? null
}

export function sendQueueNote(broadcastId: string): string {
  return notes.get(broadcastId) ?? ''
}

export function clearSendQueueNote(broadcastId: string): void {
  if (notes.delete(broadcastId)) emit()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const snapshot = () => version

/** 차례·알림이 바뀌면 다시 그린다 */
export function useSendQueueVersion(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
