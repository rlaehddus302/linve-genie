// 서버 받는 입구 약속 — SPEC ORD-13 약속 C-01~C-07 (SMS3, D-SMS3-02·05·08·11). 이 파일 한 곳에 모은다.
// 네이티브 전송 파일 두 개(android/.../NoticeContract.kt · ios/NoticeContract.swift)가 같은 값을 쓴다 — 공용 사례(test-vectors)가 잠근다.
//
// C-04 요청: POST /api/inbox/messages, 머리글 Authorization: Bearer <받기 토큰>(C-02), 본문
//   { device: 기기 이름(1~30자), messages: [{ id, channel, from, title, text, receivedAt }] } — messages 0~20건(0건이면 filters만 받는다)
//   - id: 기기가 붙인 고유 글(1~64자). 같은 알림을 다시 보내면 같은 id(C-06) — 여기서는 SHA-256 앞 16바이트 16진 32자
//   - channel: 'SMS'(기본 문자 앱 알림·아이폰 단축어) · 'APP'(filters.bankApps 앱 알림)
//   - from: 문자의 보낸 곳(번호 또는 연락처 이름) 또는 앱 패키지 이름, 없으면 null
//   - title: 앱 알림 제목, 없으면 null (문자는 null)
//   - text: 본문(1,000자 넘으면 앞 1,000자)
//   - receivedAt: 휴대폰이 받은 시각 — 밀리초 숫자(D-SMS2-02 (다): 13자리 이상 숫자 = 밀리초)
// C-04 응답 200: { results: [{ id, status }], filters: { skipWords, bankApps } } — status ∈ SAVED·DUPLICATE·IGNORED.
// 오류: 401 TOKEN_INVALID(보내기를 멈춘다) · 400 BAD_REQUEST(한 건이라도 틀리면 아무것도 처리하지 않는다) · 429 TOO_MANY(1분 뒤 같은 id로 다시).
// 머리글 외 쿠키는 쓰지 않는다(뒤에서 JS 없이 보낸다). 토큰·본문·번호는 로그에 남기지 않는다(C-07).

import { parseNoticeFilters, type NoticeFilters } from './rules.ts'

/** 약속 상태 — 스펙 ORD-13 C-04에 맞춤 */
export const NOTICE_CONTRACT_STATUS: 'ASSUMED' | 'SPEC' = 'SPEC'
/** 약속이 적힌 곳 */
export const NOTICE_CONTRACT_SOURCE = 'docs/spec/SPEC.md ORD-13 C-01~C-07'

/** 서버 입구 경로. 앱은 서버 주소 + 이 경로를 네이티브에 넘기고, 네이티브는 받은 주소로만 보낸다 */
export const NOTICE_INTAKE_PATH = '/api/inbox/messages'

export type InboxChannel = 'SMS' | 'APP'
export const INBOX_CHANNELS: readonly InboxChannel[] = Object.freeze(['SMS', 'APP'])

/** 요청의 메시지 한 건 (C-04) */
export interface InboxMessage {
  readonly id: string
  readonly channel: InboxChannel
  readonly from: string | null
  readonly title: string | null
  readonly text: string
  /** 밀리초 (UTC) */
  readonly receivedAt: number
}

/** 요청 본문 (C-04) */
export interface InboxRequest {
  readonly device: string
  readonly messages: readonly InboxMessage[]
}

/** 메시지 칸 — 네이티브 두 곳도 이 순서로 JSON을 만든다 */
export const INBOX_MESSAGE_FIELDS = Object.freeze(['id', 'channel', 'from', 'title', 'text', 'receivedAt'] as const)
/** 요청 칸 */
export const INBOX_REQUEST_FIELDS = Object.freeze(['device', 'messages'] as const)

/** 본문은 앞 1,000자 (C-04) */
export const NOTICE_TEXT_MAX_CHARS = 1_000
/** 보낸 곳·제목 칸 길이 (기기 쪽 상한 — 서버 약속에 없어 짧은 알림 글 기준으로 넉넉히) */
export const NOTICE_FROM_MAX_CHARS = 200
export const NOTICE_TITLE_MAX_CHARS = 200
/** 기기 이름 1~30자 (C-04) */
export const DEVICE_NAME_MAX_CHARS = 30
/** id 1~64자 (C-04). 이 기기는 16진 32자를 쓴다 */
export const MESSAGE_ID_PATTERN = /^[0-9a-f]{32}$/
/** 한 번에 보내는 건수 (C-04 0~20건) */
export const INBOX_BATCH_MAX = 20
/** 못 보낸 것 대기열 최대 (AC-SMS3-27 — 넘으면 오래된 것부터 버리고 개수만 기억) */
export const NOTICE_QUEUE_MAX = 200
/** 429를 받으면 이만큼 기다렸다 같은 id로 다시 (C-04) */
export const TOO_MANY_WAIT_MS = 60_000
/** 연결 실패·5xx 다시 보내기 시작 간격 (WorkManager 지수 물러서기 시작값) */
export const RETRY_INITIAL_DELAY_MS = 30_000

/** 받기 토큰 모양 (RFC 6750 b64token, 16~512자) — 틀린 토큰은 네이티브에 넘기지 않는다 */
export const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]{16,512}=*$/

/** 기기 이름 다듬기: 앞뒤 빈칸·제어 문자 빼고 1~30자(UTF-16)면 그 글, 아니면 null */
export function cleanDeviceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if ([...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > DEVICE_NAME_MAX_CHARS) return null
  return trimmed
}

/**
 * 서버 답 → 대기열이 할 일 (C-04).
 * - done: 2xx — 보낸 묶음을 대기열에서 지운다(결과마다 SAVED·DUPLICATE·IGNORED를 센다)
 * - bad: 400(모양) 등 그 밖의 4xx — 서버가 아무것도 처리하지 않았다. 여러 건 묶음이면 한 건씩 다시 보내 틀린 한 건만 골라 버린다
 * - token: 401(·403) — 받기 토큰이 끊겼다. 대기열은 그대로 두고 보내기를 멈춘다("받기 토큰을 다시 넣어 주세요")
 * - wait: 429 — 1분 뒤 같은 id로 다시
 * - retry: 408·425·5xx·연결 실패(null) — 나중에 같은 id로 다시
 */
export type NoticeResponseAction = 'done' | 'bad' | 'token' | 'wait' | 'retry'
export function classifyIntakeResponse(status: number | null): NoticeResponseAction {
  if (status === null || !Number.isInteger(status)) return 'retry'
  if (status >= 200 && status < 300) return 'done'
  if (status === 401 || status === 403) return 'token'
  if (status === 429) return 'wait'
  if (status === 408 || status === 425) return 'retry'
  if (status >= 400 && status < 500) return 'bad'
  return 'retry'
}

export type InboxResultStatus = 'SAVED' | 'DUPLICATE' | 'IGNORED'
export const INBOX_RESULT_STATUSES: readonly InboxResultStatus[] = Object.freeze(['SAVED', 'DUPLICATE', 'IGNORED'])

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2', '[::1]'])

/**
 * 서버 주소 → 입구 주소. https만 받는다(토큰이 실린다). 개발용 루프백(에뮬레이터 10.0.2.2·localhost)만 http를 허용한다.
 * 틀리면 null.
 */
export function noticeIntakeUrl(serverUrl: string): string | null {
  let url: URL
  try {
    url = new URL(serverUrl)
  } catch {
    return null
  }
  if (url.username !== '' || url.password !== '') return null
  const secure = url.protocol === 'https:'
  const devLoopback = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
  if (!secure && !devLoopback) return null
  const base = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
  return `${url.protocol}//${url.host}${base}${NOTICE_INTAKE_PATH}`
}

/** 요청 본문 JSON (칸 순서 = INBOX_REQUEST_FIELDS · INBOX_MESSAGE_FIELDS) */
export function inboxRequestJson(device: string, messages: readonly InboxMessage[]): string {
  return JSON.stringify({
    device,
    messages: messages.map((m) => ({ id: m.id, channel: m.channel, from: m.from, title: m.title, text: m.text, receivedAt: m.receivedAt })),
  })
}

const optionalText = (value: unknown, max: number): boolean => value === null || (typeof value === 'string' && value.length > 0 && value.length <= max)

/** 메시지 한 건이 약속 모양인가 */
export function isInboxMessage(value: unknown): value is InboxMessage {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).sort().join(',') !== [...INBOX_MESSAGE_FIELDS].sort().join(',')) return false
  return (
    typeof v.id === 'string' &&
    v.id.length >= 1 &&
    v.id.length <= 64 &&
    INBOX_CHANNELS.includes(v.channel as InboxChannel) &&
    optionalText(v.from, NOTICE_FROM_MAX_CHARS) &&
    optionalText(v.title, NOTICE_TITLE_MAX_CHARS) &&
    (v.channel === 'APP' || v.title === null) &&
    typeof v.text === 'string' &&
    v.text.length > 0 &&
    v.text.length <= NOTICE_TEXT_MAX_CHARS &&
    Number.isSafeInteger(v.receivedAt) &&
    (v.receivedAt as number) > 0
  )
}

/** 요청 본문이 약속 모양인가 (가짜 구현·시험이 쓴다) */
export function isInboxRequest(value: unknown): value is InboxRequest {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).sort().join(',') !== [...INBOX_REQUEST_FIELDS].sort().join(',')) return false
  if (cleanDeviceName(v.device) !== v.device) return false
  if (!Array.isArray(v.messages) || v.messages.length > INBOX_BATCH_MAX) return false
  return v.messages.every(isInboxMessage)
}

/** 200 응답에서 읽은 것. 모양이 틀린 칸은 버린다(그래도 서버가 받았으니 묶음은 지운다) */
export interface InboxResponse {
  /** id → 결과. 모르는 상태 글은 뺀다 */
  readonly results: ReadonlyMap<string, InboxResultStatus>
  /** 모양이 맞을 때만 — 아니면 null(전에 저장한 목록을 그대로 쓴다) */
  readonly filters: NoticeFilters | null
}

/** 200 응답 본문 읽기. JSON이 아니면 빈 결과 */
export function parseInboxResponse(body: string): InboxResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { results: new Map(), filters: null }
  }
  if (typeof parsed !== 'object' || parsed === null) return { results: new Map(), filters: null }
  const o = parsed as Record<string, unknown>
  const results = new Map<string, InboxResultStatus>()
  if (Array.isArray(o.results)) {
    for (const item of o.results) {
      if (typeof item !== 'object' || item === null) continue
      const r = item as Record<string, unknown>
      if (typeof r.id === 'string' && INBOX_RESULT_STATUSES.includes(r.status as InboxResultStatus)) results.set(r.id, r.status as InboxResultStatus)
    }
  }
  return { results, filters: parseNoticeFilters(o.filters) }
}
