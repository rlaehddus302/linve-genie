// 서버 읽기 입구 (SRV1 D-APP-22~24, acceptance "약속" 1·3): 사람이 친 글을 값으로 읽는 일은 서버만 한다.
// 기기는 친 글을 그대로 서버 읽기 입구에 보내고 받은 결과만 보인다 — 화면에 읽기 함수(코어 파서·전화번호·받은 시각)가 없다.
// - 입구: `POST /api/broadcasts/:id/read` `{ kind, text }` → `{ read }` (모양은 서버 packages/voice-session/src/read/index.ts의 ReadResult —
//   여기서는 타입만 가져온다. 값 import는 의존 검사가 막는다, D-APP-23). `fix`만 text가 세 칸 `{ no, name, price }`.
//   방송과 무관한 칸(money·received·phone — 정산·설정·문자찜 화면)은 `POST /api/read`도 된다.
// - 미리 보기(useServerRead): 마지막 글자 뒤 150ms에 묻고, 그 사이 글이 바뀌면 앞 답은 버린다(늦게 온 옛 답을 보이지 않음).
//   답이 없거나 연결이 없으면 null — 미리 보기 줄을 비운다. Enter·보내기는 미리 보기를 기다리지 않는다(약속 3).
import { useEffect, useState } from 'react'
import type { FixText, QuickRead, ReadKind, ReadResult } from '../../../../packages/voice-session/src/read/index.ts'
import { ApiError, isApiError, post } from '../api/client.ts'

export type { FixText, QuickRead, ReadKind, ReadResult }

/** 그 종류의 읽은 결과 */
export type ReadOf<K extends ReadKind> = Extract<ReadResult, { readonly kind: K }>
/** 그 종류에 보내는 글 (fix만 세 칸) */
export type ReadInput<K extends ReadKind> = K extends 'fix' ? FixText : string

/** 마지막 글자 뒤 기다림 (약속 3) */
export const READ_WAIT_MS = 150
/** 한 칸 글 한도 (약속 1 — 넘으면 묻지 않는다. 보내기는 서버가 같은 한도로 거절한다) */
export const READ_TEXT_MAX = 2000

/** 읽기 입구 주소: 방송이 있으면 그 방송의 입구, 없으면(정산·설정의 돈 칸) 판매자 입구 */
export function readPath(broadcast: string | null): string {
  return broadcast === null ? '/api/read' : `/api/broadcasts/${encodeURIComponent(broadcast)}/read`
}

/** 서버 답을 모르는 모양으로 받았다 (서버 판이 다를 때 — 미리 보기는 비우고, 보내기는 서버가 다시 읽는다) */
export class ReadShapeError extends Error {
  constructor() {
    super('서버 답을 읽지 못했어요. 잠시 뒤 다시 해 주세요.')
    this.name = 'ReadShapeError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 응답 본문 `{ read }` → 그 종류의 결과 (종류가 다르면 모르는 모양) */
export function readOfBody<K extends ReadKind>(kind: K, body: unknown): ReadOf<K> {
  const read = isRecord(body) ? body.read : undefined
  if (!isRecord(read) || read.kind !== kind) throw new ReadShapeError()
  return read as unknown as ReadOf<K>
}

const tooLong = (text: string | FixText): boolean =>
  typeof text === 'string' ? text.length > READ_TEXT_MAX : text.no.length > READ_TEXT_MAX || text.name.length > READ_TEXT_MAX || text.price.length > READ_TEXT_MAX

const isBlank = (text: string | FixText): boolean => (typeof text === 'string' ? text.trim() === '' : text.no.trim() === '' && text.name.trim() === '' && text.price.trim() === '')

/**
 * 글 하나를 서버에서 읽는다. 연결·서버 오류는 ApiError 그대로 던진다(부르는 쪽이 "저장하지 못했어요"·다시 보내기를 정한다).
 * broadcast가 null이면 판매자 입구(money·received·phone만).
 */
export async function readText<K extends ReadKind>(broadcast: string | null, kind: K, text: ReadInput<K>, signal?: AbortSignal): Promise<ReadOf<K>> {
  const body = await post<unknown>(readPath(broadcast), { kind, text }, signal === undefined ? {} : { signal })
  return readOfBody(kind, body)
}

/** 미리 보기 키 (같은 글이면 같은 답) */
const keyOf = (broadcast: string | null, kind: ReadKind, text: string | FixText): string => JSON.stringify([broadcast, kind, text])

/**
 * 치는 동안의 미리 보기 (약속 3): 마지막 글자 뒤 150ms에 묻는다. 지금 글의 답이 오기 전·연결이 없을 때·빈 글·한도를 넘는 글이면 null.
 * 글이 바뀌면 앞 요청을 거두고, 늦게 온 옛 답은 지금 글의 답이 아니므로 보이지 않는다.
 */
export function useServerRead<K extends ReadKind>(broadcast: string | null, kind: K, text: ReadInput<K>, enabled = true): ReadOf<K> | null {
  const key = keyOf(broadcast, kind, text)
  const [answer, setAnswer] = useState<{ readonly key: string; readonly read: ReadOf<K> } | null>(null)
  const wanted = enabled && !isBlank(text) && !tooLong(text)
  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      readText(broadcast, kind, text, controller.signal).then(
        (read) => {
          if (!controller.signal.aborted) setAnswer({ key, read })
        },
        () => {
          // 답이 없거나 연결이 없다: 미리 보기를 비운 채로 둔다 (옛 답도 보이지 않는다 — 키가 다르다)
        },
      )
    }, READ_WAIT_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // text는 key에 담겨 있다
  }, [key, wanted])
  return wanted && answer !== null && answer.key === key ? answer.read : null
}

/** 읽기 실패 → 화면 오류 (연결·서버 오류는 그대로, 모르는 답 모양은 다시 보내기가 남는 오류) */
export function readProblem(error: unknown): ApiError {
  if (isApiError(error)) return error
  return new ApiError({ status: 0, code: 'INTERNAL_ERROR', message: error instanceof ReadShapeError ? error.message : '서버 답을 읽지 못했어요. 잠시 뒤 다시 해 주세요.' })
}

/** 쓰기 거절 본문의 읽은 결과 (원문 쓰기의 409 QUICK_EXISTS·QUICK_OPEN·400 QUICK_FIX — `read`) */
export function rejectedRead(error: ApiError): QuickRead | null {
  const read = error.details.read
  if (!isRecord(read) || typeof read.decision !== 'string') return null
  return read as unknown as QuickRead
}
