// 서버 읽기 입구 (SRV1 D-APP-22~24, AC-SRV1-05, acceptance "약속" 1·3 — 웹 lib/read.ts와 같은 약속).
// 앱은 친 글을 읽지 않는다: 빠른 입력 한 줄을 서버 읽기 입구 `POST /api/broadcasts/:id/read` `{ kind: 'quick', text }`에 보내 받은 결과(`{ read }`)만 보인다.
// 스토어 판이 서버보다 늦게 바뀌어도 읽기 규칙은 서버 한 곳이라 같은 줄이 같은 결과다(D-APP-23). 결과 모양은 타입만 가져온다.
// 미리 보기: 마지막 글자 뒤 150ms에 묻고, 그 사이 글이 바뀌면 앞 답은 버린다. 답이 없거나 연결이 없으면 null(미리 보기를 비운다).
import { useEffect, useState } from 'react'
import type { ReadOf } from '@livejjim/web/src/lib/read.ts'
import { ApiError, post } from '../api/client.ts'

/** 서버가 읽은 빠른 입력 한 줄 */
export type QuickReading = ReadOf<'quick'>

export const READ_WAIT_MS = 150
export const READ_TEXT_LIMIT = 2000

/** 응답 본문 `{ read }` → 빠른 입력 결과 (모르는 모양이면 null) */
export function quickReadingOf(body: unknown): QuickReading | null {
  if (typeof body !== 'object' || body === null) return null
  const read = (body as Record<string, unknown>).read
  if (typeof read !== 'object' || read === null) return null
  const item = read as Record<string, unknown>
  return item.kind === 'quick' && typeof item.decision === 'string' ? (read as QuickReading) : null
}

/** 빠른 입력 한 줄을 서버에서 읽는다. 연결·서버 오류는 ApiError로 던진다 */
export async function readQuickLine(broadcast: string, text: string, signal?: AbortSignal): Promise<QuickReading> {
  const body = await post<unknown>(`/api/broadcasts/${encodeURIComponent(broadcast)}/read`, { kind: 'quick', text }, signal === undefined ? {} : { signal })
  const reading = quickReadingOf(body)
  if (reading === null) throw new ApiError({ status: 0, code: 'INTERNAL_ERROR', message: '서버 답을 읽지 못했어요. 잠시 뒤 다시 해 주세요.' })
  return reading
}

/** 치는 동안의 미리 보기 (150ms 뒤 서버 답, 지금 글의 답이 아니면 null) */
export function useQuickReading(broadcast: string, text: string, enabled = true): QuickReading | null {
  const key = `${broadcast}\u0000${text}`
  const [answer, setAnswer] = useState<{ readonly key: string; readonly reading: QuickReading } | null>(null)
  const wanted = enabled && text.trim() !== '' && text.length <= READ_TEXT_LIMIT
  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      readQuickLine(broadcast, text, controller.signal).then(
        (reading) => {
          if (!controller.signal.aborted) setAnswer({ key, reading })
        },
        () => {
          // 답이 없거나 연결이 없다: 미리 보기를 비운 채로 둔다
        },
      )
    }, READ_WAIT_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, wanted])
  return wanted && answer !== null && answer.key === key ? answer.reading : null
}
