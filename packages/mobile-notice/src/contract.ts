// 서버 입구 약속 — 이 파일 한 곳에 모은다 (SMS3).
// 지금 값은 **가정**이다: spec-keeper가 `spec/sms-deposit-intake`에 약속을 쓰는 중이라, 나오면 이 파일과
// 네이티브 전송 파일 두 개(android/.../NoticeContract.kt · ios/NoticeContract.swift)만 맞춘다. 구조 시험이 세 곳이 같은지 잠근다.
//
// 가정한 봉투(요청 본문 JSON 하나 = 알림 한 건):
//   { kindHint: "sms"|"bank", sourceType: "sms_number"|"app_package", source, body, receivedAtMs, sentAtMs, deviceId, localId }
// - receivedAtMs: 휴대폰이 그 문자·알림을 받은 기기 벽시계(UTC ms). 메시지 스타일이면 메시지마다의 시각, 아니면 알림 시각.
// - sentAtMs: 이 봉투를 서버로 보낸 순간의 기기 벽시계(UTC ms) — 다시 보낼 때마다 새로 적는다. 서버가 (받은 시각 − sentAtMs)로 기기 시계 어긋남을 잴 수 있다.
// - localId: 같은 알림 두 번 막기 열쇠(기기 안에서 만든 32자 16진). 서버도 (deviceId, localId)로 두 번 받기를 막는다고 가정한다.
// 머리글: Authorization: Bearer <기기 토큰>, Content-Type: application/json. 쿠키는 쓰지 않는다(뒤에서 JS 없이 보낸다).

/** 약속 상태 — 서버 약속이 나오면 'SPEC'으로 바꾸고 아래 값을 맞춘다 */
export const NOTICE_CONTRACT_STATUS: 'ASSUMED' | 'SPEC' = 'ASSUMED'
/** 약속이 나올 갈래 */
export const NOTICE_CONTRACT_SOURCE = 'spec/sms-deposit-intake'

/** 서버 입구 경로 (받는 주소 — 사용자 지시 /api/inbox/messages). 앱은 서버 주소 + 이 경로를 네이티브에 넘기고, 네이티브는 받은 주소로만 보낸다 */
export const NOTICE_INTAKE_PATH = '/api/inbox/messages'

export type NoticeKindHint = 'sms' | 'bank'
export const NOTICE_KIND_HINTS: readonly NoticeKindHint[] = Object.freeze(['sms', 'bank'])
export type NoticeSourceType = 'sms_number' | 'app_package'
export const NOTICE_SOURCE_TYPES: readonly NoticeSourceType[] = Object.freeze(['sms_number', 'app_package'])

/** 서버로 보내는 봉투 (가정) */
export interface NoticeEnvelope {
  readonly kindHint: NoticeKindHint
  readonly sourceType: NoticeSourceType
  /** 보낸 번호(문자) 또는 알림을 띄운 앱 패키지(은행). 문자는 연락처에 저장된 사람이면 번호 대신 이름일 수 있다 */
  readonly source: string
  readonly body: string
  readonly receivedAtMs: number
  readonly sentAtMs: number
  readonly deviceId: string
  readonly localId: string
}

/** 봉투 칸 이름 — 네이티브 두 곳도 이 이름 그대로 JSON을 만든다(구조 시험) */
export const ENVELOPE_FIELDS = Object.freeze(['kindHint', 'sourceType', 'source', 'body', 'receivedAtMs', 'sentAtMs', 'deviceId', 'localId'] as const)

/** 본문은 이 길이에서 자른다 (문자찜·입금 알림은 짧다 — 긴 광고·뉴스가 대기열을 채우지 않게) */
export const NOTICE_BODY_MAX_CHARS = 2_000
/** 보낸 사람·패키지 칸 최대 길이 */
export const NOTICE_SOURCE_MAX_CHARS = 200
/** localId 모양: 16진 32자 (SHA-256 앞 16바이트) */
export const LOCAL_ID_PATTERN = /^[0-9a-f]{32}$/
/** 기기 토큰 모양 (RFC 6750 b64token, 16~512자) — 틀린 토큰은 네이티브에 넘기지 않는다 */
export const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]{16,512}=*$/
/** 기기 번호 모양 */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * 서버 답 → 대기열이 할 일 (가정).
 * - accepted: 2xx — 대기열에서 지운다
 * - duplicate: 409 — 이미 받은 것. 지운다
 * - rejected: 그 밖의 4xx(400·404·413·422 등) — 이 봉투는 다시 보내도 안 된다. 지우고 건수만 센다
 * - token: 401·403 — 기기 토큰이 끊겼다. 대기열은 그대로 두고 보내기를 멈춘다(앱이 새 토큰을 넣으면 다시 보낸다)
 * - retry: 408·425·429·5xx·연결 실패(null) — 나중에 다시 보낸다
 */
export type NoticeResponseAction = 'accepted' | 'duplicate' | 'rejected' | 'token' | 'retry'
export function classifyIntakeResponse(status: number | null): NoticeResponseAction {
  if (status === null || !Number.isInteger(status)) return 'retry'
  if (status >= 200 && status < 300) return 'accepted'
  if (status === 409) return 'duplicate'
  if (status === 401 || status === 403) return 'token'
  if (status === 408 || status === 425 || status === 429) return 'retry'
  if (status >= 400 && status < 500) return 'rejected'
  return 'retry'
}

/** 다시 보내기 간격 (WorkManager 지수 물러서기 시작값·아이폰 대기열 다시 보내기 최소 간격) */
export const RETRY_INITIAL_DELAY_MS = 30_000

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

/** 봉투가 약속 모양인가 (가짜 구현·시험이 쓴다) */
export function isNoticeEnvelope(value: unknown): value is NoticeEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const keys = Object.keys(v).sort()
  if (keys.join(',') !== [...ENVELOPE_FIELDS].sort().join(',')) return false
  return (
    NOTICE_KIND_HINTS.includes(v.kindHint as NoticeKindHint) &&
    NOTICE_SOURCE_TYPES.includes(v.sourceType as NoticeSourceType) &&
    typeof v.source === 'string' &&
    v.source.length > 0 &&
    v.source.length <= NOTICE_SOURCE_MAX_CHARS &&
    typeof v.body === 'string' &&
    v.body.length > 0 &&
    v.body.length <= NOTICE_BODY_MAX_CHARS &&
    Number.isSafeInteger(v.receivedAtMs) &&
    Number.isSafeInteger(v.sentAtMs) &&
    typeof v.deviceId === 'string' &&
    DEVICE_ID_PATTERN.test(v.deviceId) &&
    typeof v.localId === 'string' &&
    LOCAL_ID_PATTERN.test(v.localId)
  )
}
