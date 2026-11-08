// 택배·포장·정산 실시간 알림으로 다시 읽기 (택배 화면·정산 배송지 칸·포장 화면이 같이 쓴다, D-UX3-35).
import { useCallback, useEffect, useState } from 'react'
import { useServices } from '../services.tsx'

/** 실시간 알림(택배·포장·정산 바뀜·다시 붙음)으로 늘어나는 값 */
export function useParcelVersion(date: string | null): [number, () => void] {
  const { stream } = useServices()
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((n) => n + 1), [])
  useEffect(() => {
    const view = stream.open()
    let ready = 0
    const parse = (data: string | undefined): { date?: string; rehearsal?: boolean; settings?: boolean } => {
      try {
        return JSON.parse(data ?? '{}') as { date?: string; rehearsal?: boolean; settings?: boolean }
      } catch {
        return {}
      }
    }
    view.addEventListener('ready', () => {
      ready++
      if (ready > 1) bump()
    })
    view.addEventListener('parcel', (event) => {
      const scope = parse(event.data)
      if (scope.settings === true || scope.date === undefined || scope.date === date) bump()
    })
    view.addEventListener('packing', (event) => {
      if (parse(event.data).date === date) bump()
    })
    view.addEventListener('change', (event) => {
      const scope = parse(event.data)
      if (scope.rehearsal !== true && scope.date === date) bump()
    })
    return () => view.close()
  }, [date, bump, stream])
  return [version, bump]
}
