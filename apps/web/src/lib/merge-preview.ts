// 합치기 미리 보기 받기 (BUY-03, R-11 "미리 보기", D-100, AC-S06b-33).
// 서버 GET /api/days/:date/merge-preview가 그 범위의 지금 상태로 코어 previewMerge를 부른 결과를 받는다 — 화면은 계산하지 않는다.
// - 창이 열린 동안 보는 범위의 seq(범위 조회·증분·실시간 알림으로 따라잡은 값)가 미리 보기의 seq보다 앞서면(다른 기기의 변화) 다시 받는다.
// - 받는 동안·받지 못했을 때·낡았을 때는 view가 null — "합치기"를 누를 수 없다. "방향 바꾸기"(from·into가 바뀜)도 새로 받는다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, UNKNOWN_MESSAGE, get, isApiError, withQuery } from '../api/client.ts'
import type { MergePreviewView } from './buyers.ts'

export const PREVIEW_LOADING = '미리 보기를 받는 중이에요.'
export const PREVIEW_REFRESHING = '미리 보기를 새로 받는 중이에요.'
export const PREVIEW_FAILED = '미리 보기를 받지 못했어요.'

export interface MergePreviewState {
  /** 지금 상태로 받은 미리 보기 (받는 중·낡았으면 null) */
  readonly view: MergePreviewView | null
  /** 이 상대·방향으로 마지막에 받은 미리 보기 (낡았을 수 있다 — 막힘 여부로 사유 칸을 둘지만 정한다) */
  readonly last: MergePreviewView | null
  /** 받는 중 (처음이 아니면 refreshing) */
  readonly loading: boolean
  readonly refreshing: boolean
  readonly error: ApiError | null
  /** 다시 받기 */
  readonly retry: () => void
}

export interface MergePreviewScope {
  readonly date: string
  readonly rehearsal: boolean
  /** 보는 범위의 지금 seq */
  readonly seq: number
}

interface Loaded {
  readonly key: string
  readonly view: MergePreviewView
}

export function mergePreviewPath(date: string, rehearsal: boolean, from: string, into: string): string {
  return withQuery(`/api/days/${encodeURIComponent(date)}/merge-preview`, { from, into, rehearsal })
}

export function useMergePreview(scope: MergePreviewScope, from: string, into: string): MergePreviewState {
  const key = JSON.stringify([scope.date, scope.rehearsal, from, into])
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  /** 이 창에서 미리 보기를 한 번이라도 받았는가 ("새로 받는 중") */
  const [seen, setSeen] = useState(false)
  const latest = useRef(0)

  const request = useCallback(() => {
    const id = ++latest.current
    setBusy(true)
    setError(null)
    get<MergePreviewView>(mergePreviewPath(scope.date, scope.rehearsal, from, into)).then(
      (view) => {
        if (id !== latest.current) return
        setLoaded({ key, view })
        setSeen(true)
        setBusy(false)
      },
      (caught: unknown) => {
        if (id !== latest.current) return
        setBusy(false)
        setLoaded(null)
        setError(isApiError(caught) ? caught : new ApiError({ status: 0, code: 'UNKNOWN', message: UNKNOWN_MESSAGE }))
      },
    )
  }, [key, scope.date, scope.rehearsal, from, into])

  // 처음·방향을 바꿨을 때
  useEffect(() => {
    request()
    return () => {
      latest.current++
    }
  }, [request])

  const current = loaded !== null && loaded.key === key ? loaded.view : null
  const stale = current !== null && scope.seq > current.seq
  // 다른 기기의 변화로 보는 범위가 앞서면 다시 받는다 (받는 중이면 끝난 뒤 다시 본다)
  useEffect(() => {
    if (stale && !busy) request()
  }, [stale, busy, request])

  const loading = busy || stale || (current === null && error === null)
  return {
    view: loading ? null : current,
    last: current,
    loading,
    refreshing: loading && seen,
    error: loading ? null : error,
    retry: request,
  }
}
