// 방송 콘솔 1등 옆 손님 꼬리표 (CR-7·D-KP1-08, D-CRM1-07 — 웹 lib/ledger.ts useChatBadges와 같은 서버 입구, D-APPX-01).
// 앱 콘솔에는 채팅 줄이 없어서 상품 줄의 1등 이름 옆에 "단골 · 누적 …원"·"입금 늦음 주의"·"처음"을 붙인다.
// 실제 방송만(리허설 없음), 설정 "방송 화면에 손님 표시"가 켜졌을 때만(서버 `show`) — 녹화·송출 화면에 손님 정보가 나가지 않게.
// 받기 사이는 4초 이상(BADGE_GAP_MS), 한 번에 50명까지. 받지 못하면 아무것도 보이지 않는다(판매는 그대로).
import { useEffect, useRef, useState } from 'react'
import { get } from '../api/client.ts'

export const BADGE_GAP_MS = 4_000
export const BADGE_BATCH = 50

interface BadgesView {
  readonly show: boolean
  readonly badges: readonly { readonly buyer: string; readonly text: string | null; readonly spoken: string | null }[]
}

export function badgesPath(date: string, buyers: readonly string[]): string {
  const search = new URLSearchParams()
  for (const buyer of new Set(buyers)) search.append('buyer', buyer)
  return `/api/days/${date}/customer-badges?${search.toString()}`
}

/** 구매자 → 꼬리표 글 (없으면 비어 있다) */
export function useWinnerBadges(date: string, rehearsal: boolean, buyers: readonly string[]): ReadonlyMap<string, string> {
  const [badges, setBadges] = useState<ReadonlyMap<string, string>>(new Map())
  const last = useRef(0)
  const key = [...new Set(buyers)].sort().slice(0, BADGE_BATCH).join('\n')
  useEffect(() => {
    if (rehearsal || key === '') return
    let alive = true
    const wait = Math.max(0, last.current + BADGE_GAP_MS - Date.now())
    const timer = setTimeout(() => {
      last.current = Date.now()
      get<BadgesView>(badgesPath(date, key.split('\n'))).then(
        (view) => {
          if (!alive) return
          const next = new Map<string, string>()
          if (view.show) for (const badge of view.badges) if (badge.text !== null && badge.text !== '') next.set(badge.buyer, badge.text)
          setBadges(next)
        },
        () => undefined,
      )
    }, wait)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [date, rehearsal, key])
  return badges
}
