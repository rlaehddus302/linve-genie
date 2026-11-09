// 방송의 최근 채팅 읽기 (D-APPX-03 — 웹 ChatPanel과 같은 경로·규칙): 채팅·문자 탭·아래 창이 쓴다. 범위가 바뀌면 짧게 모아 다시 읽는다.
// 따로 보던 "채팅 보기"(D-UX4-84)·"댓글 붙여넣기"(D-UX4-78)는 앱에서 없앴다 (사용자 지시 2026-11-10) — 웹에는 남아 있다.
import { useEffect, useState } from 'react'
import type { MessagesView } from '@livejjim/web/src/api/types.ts'
import { get, isApiError, withQuery, type ApiError } from '../../api/client.ts'
import { useServices } from '../../services.tsx'
import { useConsoleApi } from './context.ts'

export const CHAT_LIMIT = 100
const RELOAD_MS = 500

/** 이 방송의 최근 채팅 (창이 열린 동안 범위가 바뀌면 짧게 모아 다시 읽는다) — 채팅·문자 탭·아래 창이 함께 쓴다 */
export function useMessages(): { readonly view: MessagesView | null; readonly error: ApiError | null } {
  const api = useConsoleApi()
  const { stream } = useServices()
  const [view, setView] = useState<MessagesView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const rehearsal = api.data.rehearsal
  const path = withQuery(`/api/days/${api.data.date}/messages`, { b: api.b, limit: CHAT_LIMIT, rehearsal })
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      get<MessagesView>(path).then(
        (next) => {
          if (!alive) return
          setView(next)
          setError(null)
        },
        (caught: unknown) => {
          if (alive && isApiError(caught)) setError(caught)
        },
      )
    void load()
    const source = stream.open()
    source.addEventListener('change', () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void load()
      }, RELOAD_MS)
    })
    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
      source.close()
    }
  }, [path, stream])
  return { view, error }
}
