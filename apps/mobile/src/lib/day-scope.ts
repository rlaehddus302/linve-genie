// 그날 범위 자료 받기 (정산·구매자 화면이 같이 쓴다, D-APPX-01·03): 처음 전체 조회, 그날 실제 범위의 바뀜 알림·다시 붙음이면 다시 받는다.
import { useCallback, useEffect, useMemo } from 'react'
import type { FullView } from '@livejjim/web/src/api/types.ts'
import { withQuery, type ApiError } from '../api/client.ts'
import { useServices } from '../services.tsx'
import { useCachedGet } from './cached-get.ts'
import { fromFull, type ScopeData } from './scope-data.ts'

/** 그날 범위 자료 — 처음 전체 조회, 실시간 알림이 오면 다시 받는다. 기억해 둔 것이 있으면 바로 보이고 뒤에서 다시 받는다 (D-UX4-77) */
export function useDayScope(date: string): { data: ScopeData | null; error: ApiError | null; reload: () => void } {
  const { stream } = useServices()
  const view = useCachedGet<FullView>(withQuery(`/api/days/${date}`, { rehearsal: false }))
  const full = view.data
  const data = useMemo(() => (full === null ? null : fromFull(full)), [full])
  const error = view.error
  const fetchAgain = view.reload
  const reload = useCallback(() => void fetchAgain(), [fetchAgain])
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
