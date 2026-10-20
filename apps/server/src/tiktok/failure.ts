// 연결 실패 → 실패 종류 (D-N2b-1-05·07, AC-N2b-1-35). 대응표는 harness/sprints/N2b-1/dev-notes.md "실패 종류 대응표".
// 실제 연결기(tiktok-live-connector 2.1.0)와 가짜 웹캐스트가 같은 코드로 가른다: 오류 형의 이름(생성자 이름 사슬)과 몇몇 칸만 본다.
// 라이브러리를 import하지 않는다(라이브러리는 감싸개 파일 하나에서만 부른다 — AC-N2b-1-01). 오류 메시지는 로그·상태에 옮기지 않는다.

/** 다시 시도하는 실패 */
export type TikTokRetryKind = 'NETWORK' | 'NOT_LIVE' | 'BLOCKED' | 'SIGN_FAILED'
/** 실패 종류 — USER_NOT_FOUND만 바로 멈춘다 */
export type TikTokFailureKind = TikTokRetryKind | 'USER_NOT_FOUND'

export const TIKTOK_FAILURE_KINDS: readonly TikTokFailureKind[] = Object.freeze(['NETWORK', 'NOT_LIVE', 'BLOCKED', 'SIGN_FAILED', 'USER_NOT_FOUND'])

/** 틱톡 웹 API가 없는 사용자에게 주는 상태 코드와 문구 (라이브러리 InvalidResponseError 메시지 `API Error 19881007 (user_not_found)`) */
const USER_NOT_FOUND_TEXT = /\b19881007\b|user[_ ]not[_ ]found/i
/** 라이브러리가 틱톡 페이지에서 확인 문자·차단을 만났을 때의 문구 (fetch-room-info-html: "blocked by TikTok", "captcha-blocked") */
const BLOCKED_TEXT = /captcha|blocked by tiktok/i
/** 틱톡의 거부·요청 한도 HTTP 상태 */
const BLOCKED_STATUS: ReadonlySet<number> = new Set([403, 429])

const MAX_NODES = 32
const MAX_DEPTH = 4

interface Signals {
  userNotFound: boolean
  notLive: boolean
  sign: boolean
  blocked: boolean
}

/** 오류 값의 형 이름들 (생성자 사슬 + name). 읽다 오류가 나면 빈 목록 */
function typeNames(value: object): Set<string> {
  const names = new Set<string>()
  try {
    const name: unknown = (value as { name?: unknown }).name
    if (typeof name === 'string') names.add(name)
    let proto: unknown = Object.getPrototypeOf(value)
    for (let i = 0; i < 8 && typeof proto === 'object' && proto !== null && proto !== Object.prototype; i += 1) {
      const ctor: unknown = Object.getOwnPropertyDescriptor(proto, 'constructor')?.value
      if (typeof ctor === 'function' && typeof ctor.name === 'string') names.add(ctor.name)
      proto = Object.getPrototypeOf(proto)
    }
  } catch {
    // 이상한 값은 이름 없이 본다
  }
  return names
}

function readField(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

function httpStatus(value: object): number | null {
  const response = readField(value, 'response')
  if (typeof response !== 'object' || response === null) return null
  const status = readField(response, 'status')
  return typeof status === 'number' ? status : null
}

function visit(value: unknown, depth: number, seen: Set<object>, signals: Signals): void {
  if (typeof value !== 'object' || value === null || seen.has(value) || seen.size >= MAX_NODES || depth > MAX_DEPTH) return
  seen.add(value)
  const names = typeNames(value)
  const message = readField(value, 'message')
  const text = typeof message === 'string' ? message.slice(0, 2000) : ''
  if (names.has('InvalidUniqueIdError') || (names.has('InvalidResponseError') && USER_NOT_FOUND_TEXT.test(text))) signals.userNotFound = true
  if (names.has('UserOfflineError')) signals.notLive = true
  if (names.has('SignAPIError')) {
    // 서명 서비스 오류·한도 (SignatureRateLimitError·SignatureMissingTokensError·PremiumFeatureError 포함). 안쪽은 보지 않는다
    signals.sign = true
    return
  }
  const status = httpStatus(value)
  if ((status !== null && BLOCKED_STATUS.has(status)) || BLOCKED_TEXT.test(text)) signals.blocked = true
  // 여러 경로를 시도한 끝의 오류(FetchIsLiveError.errors), 감싼 요청 오류(InvalidResponseError.requestErr), 표준 cause
  const errors = readField(value, 'errors')
  if (Array.isArray(errors)) for (const inner of errors.slice(0, MAX_NODES)) visit(inner, depth + 1, seen, signals)
  visit(readField(value, 'requestErr'), depth + 1, seen, signals)
  visit(readField(value, 'cause'), depth + 1, seen, signals)
}

/**
 * 연결 시도의 실패(거부된 값)를 실패 종류로 바꾼다. 어떤 값이 와도 예외를 던지지 않는다.
 * 우선순위: 없는 사용자 → 방송 중 아님 → 서명 서비스 → 틱톡의 거부·한도·확인 문자 → 그 밖(네트워크·시간 초과·모르는 오류·오류가 아닌 값).
 */
export function classifyWebcastFailure(error: unknown): TikTokFailureKind {
  const signals: Signals = { userNotFound: false, notLive: false, sign: false, blocked: false }
  try {
    visit(error, 0, new Set(), signals)
  } catch {
    return 'NETWORK'
  }
  if (signals.userNotFound) return 'USER_NOT_FOUND'
  if (signals.notLive) return 'NOT_LIVE'
  if (signals.sign) return 'SIGN_FAILED'
  if (signals.blocked) return 'BLOCKED'
  return 'NETWORK'
}
