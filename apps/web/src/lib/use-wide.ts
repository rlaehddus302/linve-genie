// 화면 폭 (UX-04, NFR-08, D-101·D-102, D-I4-03): 48rem(768px) 이상이면 PC 모양 — 구매자·정산 목록은 표, 조치 기록은 표,
// 음성 카드는 빠른 입력칸과 함께 고정 영역에 두고 Enter로 등록한다. 좁으면 휴대폰 모양(카드·기록마다 한 묶음).
// CSS의 휴대폰 경계(max-width: 47.99rem)와 같은 rem 값이다 — 판매자가 글자 크기를 키워도 CSS와 같은 때 바뀐다.
// 한 모양만 그린다(숨긴 사본을 두지 않는다 — 같은 글자가 두 번 있으면 보조 기술·찾기가 헷갈린다).
// S06b와 I4가 각자 만든 같은 훅을 합쳤다(구독은 useSyncExternalStore — 그리는 도중 폭이 바뀌어도 어긋나지 않는다).
import { useSyncExternalStore } from 'react'

export const WIDE_QUERY = '(min-width: 48rem)'

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY) : null
}

function subscribe(listener: () => void): () => void {
  const list = media()
  if (list === null) return () => {}
  list.addEventListener('change', listener)
  return () => list.removeEventListener('change', listener)
}

/** matchMedia가 없으면(폭을 알 수 없는 환경) 휴대폰 모양 — 창 너비로 짐작하지 않는다(S06b 규칙) */
function snapshot(): boolean {
  return media()?.matches ?? false
}

/** 지금 PC 폭인가 (폭이 바뀌면 다시 그린다). 폭을 알 수 없는 환경(서버 그리기·matchMedia 없음)이면 휴대폰 모양 */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
