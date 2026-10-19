// 화면을 떠나기 전 확인 (AC-S06-01, D-083): 5초 대기 중인 방송자 조치가 있는 화면은 떠나기 전에 묻는다 — 떠나면 보내지 않는다.
// - 묻는 길: 메뉴·링크·화면 안의 이동(구매자 목록 ↔ 자세히, 날짜 바꾸기), 브라우저 뒤로·앞으로(앱이 묻는다), 새로고침·탭 닫기(브라우저가 묻는다).
// - 묻는 동안은 대기 시계를 멈춘다(hold) — 판매자가 고르기 전에 보내지 않는다. "닫기"면 다시 흐르고(release),
//   "보내지 않고 떠나기"면 그 화면의 기다리던 조치를 보내지 않는다(discard). 화면이 내려가는지(언마운트)에 기대지 않는다.
import { createContext, useContext, useEffect } from 'react'
import type { UndoQueue } from './undo-queue.ts'

export interface LeaveGuard {
  /** 보내기 전인(5초 대기 중인) 조치가 있는가 */
  readonly pending: () => boolean
  /** 떠날지 묻는 동안 대기 시계를 멈춘다 */
  readonly hold: () => void
  /** 묻기를 닫았다 — 시계가 남은 시간부터 다시 흐른다 */
  readonly release: () => void
  /** "보내지 않고 떠나기" — 기다리던 조치를 보내지 않는다 */
  readonly discard: () => void
}

/** 화면이 자기 확인을 등록한다 (앱이 하나 둔다). 돌려준 함수로 뺀다 */
export type RegisterLeaveGuard = (guard: LeaveGuard) => () => void

export const LeaveGuardContext = createContext<RegisterLeaveGuard>(() => () => {})

/** 되돌리기 목록의 떠나기 확인 */
export function queueLeaveGuard(queue: UndoQueue): LeaveGuard {
  return {
    pending: () => queue.waitingCount > 0,
    hold: () => queue.pause(),
    release: () => queue.resume(),
    discard: () => {
      queue.discardWaiting()
    },
  }
}

/** 이 화면이 열린 동안, 기다리는 조치가 있으면 다른 곳으로 가기 전에 묻는다 */
export function useLeaveGuard(queue: UndoQueue): void {
  const register = useContext(LeaveGuardContext)
  useEffect(() => register(queueLeaveGuard(queue)), [register, queue])
}

/** 떠나기 전 물음 (D-083) */
export const LEAVE_QUESTION = '보내기 전인 조치가 있어요. 떠나면 보내지 않아요.'
