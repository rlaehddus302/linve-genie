// 화면을 떠나기 전 확인 (AC-S06-01, D-083): 5초 대기 중인 방송자 조치가 있는 화면은 떠나기 전에 묻는다 — 떠나면 보내지 않는다.
import { createContext, useContext, useEffect } from 'react'

export type LeaveCheck = () => boolean

/** 지금 화면이 "떠나기 전에 물을 것이 있는가"를 알리는 곳 (앱이 하나 둔다) */
export const LeaveGuardContext = createContext<(check: LeaveCheck | null) => void>(() => {})

/** 이 화면이 열린 동안 check가 참이면 메뉴로 다른 화면에 가기 전에 묻는다 */
export function useLeaveGuard(check: LeaveCheck): void {
  const register = useContext(LeaveGuardContext)
  useEffect(() => {
    register(check)
    return () => register(null)
  }, [register, check])
}

/** 떠나기 전 물음 (D-083) */
export const LEAVE_QUESTION = '보내기 전인 조치가 있어요. 떠나면 보내지 않아요.'
