// 그날 범위 자료 받기 (정산·구매자 화면이 같이 쓴다, D-APPX-01·03): 처음 전체 조회, 그날 실제 범위의 바뀜 알림·다시 붙음이면 다시 받는다.
import { useCallback, useEffect, useState } from 'react'
import type { FullView } from '@livejjim/web/src/api/types.ts'
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import { useServices } from '../services.tsx'
import { fromFull, type ScopeData } from './scope-data.ts'

/** 그날 범위 자료 — 처음 전체 조회, 실시간 알림이 오면 다시 받는다 */
export function useDayScope(date: string): { data: ScopeData | null; error: ApiError | null; reload: () => void } {
  const { stream } = useServices()
  const [data, setData] = useState<ScopeData | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((n) => n + 1), [])
  useEffect(() => {
    let alive = true
    get<FullView>(withQuery(`/api/days/${date}`, { rehearsal: false })).then(
      (view) => {
        if (!alive) return
        setData(fromFull(view))
        setError(null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [date, version])
  useEffect(() => {
    const view = stream.open()
    let ready = 0
    view.addEventListener('ready', () => {
      ready++
      if (ready > 1) reload()
    })
    view.addEventListener('change', (event) => {
      try {
        const scope = JSON.parse(event.data ?? '{}') as { date?: string; rehearsal?: boolean }
        if (scope.date === date && scope.rehearsal !== true) reload()
      } catch {
        reload()
      }
    })
    return () => view.close()
  }, [date, reload, stream])
  return { data, error, reload }
}
