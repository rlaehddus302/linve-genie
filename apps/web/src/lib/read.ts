// 서버 읽기 입구 (SRV1 D-APP-22~24, acceptance "약속" 1·3): 사람이 친 글을 값으로 읽는 일은 서버만 한다.
// 기기는 친 글을 그대로 서버 읽기 입구에 보내고 받은 결과만 보인다 — 화면에 읽기 함수(코어 파서·전화번호·받은 시각)가 없다.
// - 입구: `POST /api/broadcasts/:id/read` `{ kind, text }` → 읽은 결과(모양은 packages/voice-session/src/read.ts의 Reading).
//   방송이 없는 화면(정산·설정)의 돈 칸은 `POST /api/read` `{ kind: 'money', text }` (원 단위라 방송 설정을 쓰지 않는다).
// - 미리 보기(useServerRead): 마지막 글자 뒤 150ms에 묻고, 그 사이 글이 바뀌면 앞 답은 버린다(늦게 온 옛 답을 보이지 않음).
//   답이 없거나 연결이 없으면 null — 미리 보기 줄을 비운다. Enter·보내기는 미리 보기를 기다리지 않는다(약속 3).
import { useEffect, useState } from 'react'
import type { FixNumberReading, MoneyReading, PhoneReading, PriceReading, QuickReading, ReadKind, ReadingOf, ReceivedReading } from '../../../../packages/voice-session/src/read.ts'
import { ApiError, isApiError, post } from '../api/client.ts'

export type { FixNumberReading, MoneyReading, PhoneReading, PriceReading, QuickReading, ReadKind, ReadingOf, ReceivedReading }

/** 마지막 글자 뒤 기다림 (약속 3) */
export const READ_WAIT_MS = 150
/** 한 번에 보내는 글 한도 (약속 1 — 넘으면 묻지 않는다) */
export const READ_TEXT_LIMIT = 2000

/** 읽기 입구 주소: 방송이 있으면 그 방송의 입구, 없으면(정산·설정의 돈 칸) 판매자 입구 */
export function readPath(broadcast: string | null): string {
  return broadcast === null ? '/api/read' : `/api/broadcasts/${encodeURIComponent(broadcast)}/read`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const numberOrNull = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isSafeInteger(value))
const stringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'
const QUICK_ERRORS = ['EMPTY', 'PRICE_MISSING', 'PRICE_TOO_LOW', 'NUMBER_MISSING', 'NUMBER_INVALID']

/** 서버 답이 그 종류의 모양인지 (모르는 모양이면 쓰지 않는다 — 미리 보기는 비우고, 보내기는 서버가 다시 읽는다) */
export function readingOf<K extends ReadKind>(kind: K, value: unknown): ReadingOf[K] | null {
  if (!isRecord(value)) return null
  switch (kind) {
    case 'quick': {
      const ok =
        numberOrNull(value.no) &&
        stringOrNull(value.name) &&
        numberOrNull(value.price) &&
        (value.error === null || (typeof value.error === 'string' && QUICK_ERRORS.includes(value.error))) &&
        stringOrNull(value.message) &&
        (value.noText === undefined || typeof value.noText === 'string') &&
        (value.priceText === undefined || typeof value.priceText === 'string')
      return ok ? (value as unknown as ReadingOf[K]) : null
    }
    case 'fix':
      return numberOrNull(value.no) && (value.error === null || value.error === 'NUMBER_MISSING' || value.error === 'NUMBER_INVALID') && stringOrNull(value.message) ? (value as unknown as ReadingOf[K]) : null
    case 'price':
      return numberOrNull(value.amount) && (value.error === null || value.error === 'PRICE_MISSING' || value.error === 'PRICE_TOO_LOW') && stringOrNull(value.message) ? (value as unknown as ReadingOf[K]) : null
    case 'money':
      return numberOrNull(value.amount) ? (value as unknown as ReadingOf[K]) : null
    case 'received': {
      if (value.kind === 'empty' || value.kind === 'invalid') return value as unknown as ReadingOf[K]
      const ok =
        value.kind === 'ok' &&
        typeof value.value === 'string' &&
        typeof value.minute === 'boolean' &&
        typeof value.time === 'number' &&
        Number.isFinite(value.time) &&
        (value.day === '어제' || value.day === '오늘' || value.day === '내일') &&
        typeof value.late === 'boolean'
      return ok ? (value as unknown as ReadingOf[K]) : null
    }
    case 'phone':
      return stringOrNull(value.phone) && stringOrNull(value.last4) ? (value as unknown as ReadingOf[K]) : null
  }
  return null
}

/** 모르는 모양의 답 */
export class ReadShapeError extends Error {
  constructor() {
    super('서버 답을 읽지 못했어요. 잠시 뒤 다시 해 주세요.')
    this.name = 'ReadShapeError'
  }
}

/**
 * 글 하나를 서버에서 읽는다. 연결·서버 오류는 ApiError 그대로 던진다(부르는 쪽이 "저장하지 못했어요"·다시 보내기를 정한다).
 * broadcast가 null이면 판매자 입구(돈 칸만).
 */
export async function readText<K extends ReadKind>(broadcast: string | null, kind: K, text: string, signal?: AbortSignal): Promise<ReadingOf[K]> {
  const body = await post<unknown>(readPath(broadcast), { kind, text }, signal === undefined ? {} : { signal })
  const reading = readingOf(kind, body)
  if (reading === null) throw new ReadShapeError()
  return reading
}

/**
 * 치는 동안의 미리 보기 (약속 3): 마지막 글자 뒤 150ms에 묻는다. 지금 글의 답이 오기 전·연결이 없을 때·빈 글·한도를 넘는 글이면 null.
 * 글이 바뀌면 앞 요청을 거두고, 늦게 온 옛 답은 지금 글의 답이 아니므로 보이지 않는다.
 */
export function useServerRead<K extends ReadKind>(broadcast: string | null, kind: K, text: string, enabled = true): ReadingOf[K] | null {
  const key = `${broadcast ?? ''}\u0000${kind}\u0000${text}`
  const [answer, setAnswer] = useState<{ readonly key: string; readonly reading: ReadingOf[K] } | null>(null)
  const wanted = enabled && text.trim() !== '' && text.length <= READ_TEXT_LIMIT
  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      readText(broadcast, kind, text, controller.signal).then(
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

/** 읽기 실패 → 화면 오류 (연결·서버 오류는 그대로, 모르는 답 모양은 "다시 보내기"가 남는 오류) */
export function readProblem(error: unknown): ApiError {
  if (isApiError(error)) return error
  return new ApiError({ status: 0, code: 'INTERNAL_ERROR', message: error instanceof ReadShapeError ? error.message : '서버 답을 읽지 못했어요. 잠시 뒤 다시 해 주세요.' })
}
