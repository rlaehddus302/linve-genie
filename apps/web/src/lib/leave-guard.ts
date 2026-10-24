// 화면을 떠나기 전 확인 (AC-S06-01, D-083): 5초 대기 중인 방송자 조치가 있는 화면은 떠나기 전에 묻는다 — 떠나면 보내지 않는다.
// - 묻는 길: 메뉴·링크·화면 안의 이동(구매자 목록 ↔ 자세히, 날짜 바꾸기), 브라우저 뒤로·앞으로(앱이 묻는다), 새로고침·탭 닫기(브라우저가 묻는다).
// - 묻는 동안은 대기 시계를 멈춘다(hold) — 판매자가 고르기 전에 보내지 않는다. "닫기"면 다시 흐르고(release),
//   "보내지 않고 떠나기"면 그 화면의 기다리던 조치를 보내지 않는다(discard). 화면이 내려가는지(언마운트)에 기대지 않는다.
// - 닫으면 멈췄던 조치는 대기 시간 전체를 다시 기다린다(D-103). 처음 연 화면(앱 안에 뒤로 갈 기록이 없음)에 보내기 전인 조치가 생기면
//   앱이 같은 주소의 기록을 하나 더 쌓아 뒤로 가기가 앱을 떠나지 않고 묻게 한다(subscribe로 조치가 생기는 때를 안다).
import { createContext, useContext, useEffect, useRef } from 'react'
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
  /** 묻는 문장·떠나기 버튼 (없으면 5초 대기 조치의 문장 — 설정 화면은 "저장하지 않은 값"을 묻는다, AC-I3-46) */
  readonly question?: string
  readonly leaveLabel?: string
  /** 보내기 전인 조치가 바뀔 때 알린다 (돌려준 함수로 그만 듣는다) */
  readonly subscribe?: (listener: () => void) => () => void
}

/**
 * 앱 밖(간편 로그인 공급자 등)으로 같은 탭에서 떠나기 (FB1 D-FB1-08, AC-FB1-31~33):
 * - confirm: 남은 값(저장하지 않은 값·보내기 전인 조치)이 있으면 앱의 떠나기 창으로 먼저 묻는다 — "떠나기"면 true, "닫기"면 false. 없으면 바로 true(창 없음)
 * - allowUnload: 이동을 시작한 동안 브라우저의 떠나기 확인(beforeunload)을 묻지 않게 한다 — 앱이 이미 물었다. 돌려준 함수로 다시 묻게 한다(이동이 막혔을 때)
 */
export interface ExternalLeave {
  readonly confirm: () => Promise<boolean>
  readonly allowUnload: () => () => void
}

export const ExternalLeaveContext = createContext<ExternalLeave>({ confirm: () => Promise.resolve(true), allowUnload: () => () => {} })

export function useExternalLeave(): ExternalLeave {
  return useContext(ExternalLeaveContext)
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
    subscribe: (listener) => queue.subscribe(listener),
  }
}

/** 이 화면이 열린 동안, 기다리는 조치가 있으면 다른 곳으로 가기 전에 묻는다 */
export function useLeaveGuard(queue: UndoQueue): void {
  const register = useContext(LeaveGuardContext)
  useEffect(() => register(queueLeaveGuard(queue)), [register, queue])
}

/** 떠나기 확인 창 제목 (D-083) */
export const LEAVE_TITLE = '다른 화면으로 갈까요?'

/** 떠나기 전 물음 (D-083) */
export const LEAVE_QUESTION = '보내기 전인 조치가 있어요. 떠나면 보내지 않아요.'

/** 저장하지 않은 값 (설정 화면, AC-I3-46) */
export const UNSAVED_QUESTION = '저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.'
export const UNSAVED_LEAVE = '저장하지 않고 떠나기'

/**
 * 이 화면에 저장하지 않은 값이 있으면 다른 곳으로 가기 전에 같은 창으로 묻는다 (새로고침·탭 닫기는 브라우저가 묻는다).
 * dirty는 값 또는 그때그때 묻는 함수(마법사처럼 칸들이 따로 알리는 화면 — 묻는 순간의 값을 쓴다).
 */
export function useUnsavedGuard(dirty: boolean | (() => boolean)): void {
  const register = useContext(LeaveGuardContext)
  const ref = useRef(dirty)
  ref.current = dirty
  useEffect(
    () =>
      register({
        pending: () => {
          const current = ref.current
          return typeof current === 'function' ? current() : current
        },
        hold: () => {},
        release: () => {},
        discard: () => {},
        question: UNSAVED_QUESTION,
        leaveLabel: UNSAVED_LEAVE,
      }),
    [register],
  )
}
