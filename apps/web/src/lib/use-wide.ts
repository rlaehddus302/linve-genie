// 화면 폭 (UX-04, NFR-08, D-101·D-102): 48rem(768px) 이상이면 PC 모양 — 구매자·정산 목록은 표, 조치 기록은 표.
// 좁으면 휴대폰 모양(카드·기록마다 한 묶음). CSS의 휴대폰 경계(max-width: 47.99rem)와 같은 값이다.
// 한 모양만 그린다(숨긴 사본을 두지 않는다 — 같은 글자가 두 번 있으면 보조 기술·찾기가 헷갈린다).
import { useEffect, useState } from 'react'

export const WIDE_QUERY = '(min-width: 48rem)'

function matches(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches
}

/** 지금 PC 폭인가 (폭이 바뀌면 다시 그린다). 폭을 알 수 없는 환경이면 휴대폰 모양 */
export function useWide(): boolean {
  const [wide, setWide] = useState(matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(WIDE_QUERY)
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}
