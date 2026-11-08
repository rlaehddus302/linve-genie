// 확인 필요 목록 받기 (CMT-04, D-O2-14 — O2 dev-notes "화면에게" 5). GET /api/reviews[?broadcast=][&rehearsal=true].
// 새 SSE 이름은 없다: 같은 리허설 구분의 `change` 알림을 받으면 첫 알림부터 짧게 모아(REVIEW_RELOAD_MS, 최대 대기) 다시 읽는다. 끊겼다 다시 붙어도 다시 읽는다.
// 권한 없음(403)·옵션 방송이 없는 판매자는 빈 목록으로 본다 — 화면은 "확인 필요"를 보이지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import type { ReviewsView } from '../api/types.ts'
import { useLiveEvents } from './live-events.ts'

/** 알림을 모으는 시간 */
export const REVIEW_RELOAD_MS = 250

export interface ReviewsQuery {
  readonly broadcast?: string
  readonly rehearsal: boolean
}

export const reviewsPath = (query: ReviewsQuery): string => withQuery('/api/reviews', { broadcast: query.broadcast, rehearsal: query.rehearsal })

export interface ReviewsState {
  readonly view: ReviewsView | null
  readonly error: ApiError | null
  /** 지금 다시 읽는다 (보낸 뒤 결과 보기) */
  readonly reload: () => Promise<ReviewsView | null>
}

/** query가 null이면 받지 않는다 */
export function useReviews(query: ReviewsQuery | null): ReviewsState {
  const [view, setView] = useState<ReviewsView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const key = query === null ? null : reviewsPath(query)
  const keyRef = useRef(key)
  keyRef.current = key
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const version = useRef(0)

  const reload = useCallback(async (): Promise<ReviewsView | null> => {
    const path = keyRef.current
    if (path === null) return null
    const mine = ++version.current
    try {
      const next = await get<ReviewsView>(path)
      if (mine === version.current && keyRef.current === path) {
        setView(next)
        setError(null)
      }
      return next
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (mine === version.current) {
        // 권한 없음·없는 방송: 목록 없음으로 본다
        if (caught.status === 403 || caught.status === 404) setView(null)
        else setError(caught)
      }
      return null
    }
  }, [])

  useEffect(() => {
    setView(null)
    setError(null)
    if (key !== null) void reload()
    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [key, reload])

  // 모으기는 첫 알림부터 REVIEW_RELOAD_MS 뒤 한 번 (뒤 알림이 타이머를 미루지 않는다 — 채팅이 몰려도 늦어야 그만큼, RA-O2-02).
  // 읽는 중에 알림이 오면 끝난 뒤 한 번만 더 읽는다.
  const loading = useRef(false)
  const again = useRef(false)
  const schedule = useCallback(() => {
    if (timer.current !== undefined) return
    if (loading.current) {
      again.current = true
      return
    }
    timer.current = setTimeout(() => {
      timer.current = undefined
      loading.current = true
      again.current = false
      void reload().finally(() => {
        loading.current = false
        if (again.current) {
          again.current = false
          schedule()
        }
      })
    }, REVIEW_RELOAD_MS)
  }, [reload])

  useLiveEvents(
    {
      onChange: (change) => {
        if (query !== null && change.rehearsal === query.rehearsal) schedule()
      },
      onReconnect: schedule,
    },
    key !== null,
  )

  return { view, error, reload }
}
