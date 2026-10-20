// 볼 수만 있는 화면 (봉인한 날짜, DAT-06, AC-I3-41). 이 값이 참인 화면 안의 쓰기 버튼은 잠긴다 — 눌러도 요청을 보내지 않는다.
// 창(Modal)은 안의 칸·버튼을 통째로 잠그고("닫기"만 된다), 화면 조각은 <Lock>으로 쓰기 영역을 감싼다.
import { createContext, useContext } from 'react'

export const ReadOnlyContext = createContext(false)

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext)
}
