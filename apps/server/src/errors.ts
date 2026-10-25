// 서버 오류 응답 (AC-S00-41).
// - 본문은 항상 JSON {"error":{"code","message"}}이다.
// - 스택 추적·파일 경로·프레임워크 내부 메시지를 담지 않는다. 받은 요청 값(경로·헤더·본문)도 되돌려 주지 않는다.
// - message는 화면에 그대로 보여 줘도 되는 쉬운 한국어다. code는 프로그램이 분기할 때 쓴다.

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'REQUEST_TIMEOUT'
  | 'PAYLOAD_TOO_LARGE'
  | 'HEADERS_TOO_LARGE'
  | 'REQUEST_ERROR'
  | 'INTERNAL_ERROR'
  // S04 API (AC-S04-22·31·40·41·50·51)
  | 'INVALID_INPUT'
  | 'UNKNOWN_FIELD'
  | 'INVALID_REQUEST_ID'
  | 'NOT_JSON'
  | 'UNAUTHORIZED'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'FORBIDDEN_ORIGIN'
  | 'NOT_SUPPORTED'
  | 'BUYER_NOT_FOUND'
  // V1 음성 문자찜: 끝자리가 같은 손님이 여럿 (AC-V1-10)
  | 'BUYER_AMBIGUOUS'
  // V1: 여러 기기의 같은 음성 문자찜 쓰기 (D-V1-13, AC-V1-14)
  | 'VOICE_REPEATED'
  | 'STATE_FORMAT'
  | 'SAVE_FAILED'
  | 'PROCESSING_FAILED'
  // S05 API (AC-S05-51·61)
  | 'BROADCAST_ENDED'
  | 'GENERATOR_RUNNING'
  | 'RESYNC_REQUIRED'
  // S06 API (AC-S06-71)
  | 'GENERATOR_RUNNING_ELSEWHERE'
  // Y1 유튜브 (AC-Y1-01~62)
  | 'SEALED'
  // PL1A 봉인 날짜의 장부를 읽을 수 없음 (D-PL1-04)
  | 'LEDGER_UNREADABLE'
  | 'YOUTUBE_NOT_CONFIGURED'
  | 'YOUTUBE_NOT_CONNECTED'
  | 'YOUTUBE_RECONNECT_NEEDED'
  | 'YOUTUBE_UNAVAILABLE'
  | 'INVALID_VIDEO_URL'
  | 'REHEARSAL_LINK'
  | 'ALREADY_LINKED'
  | 'NOT_MY_CHANNEL'
  | 'NO_LIVE_CHAT'
  | 'VIDEO_IN_USE'
  | 'NOT_LINKED'
  | 'QUOTA_PAUSED'
  | 'NO_PERMISSION'
  | 'CHAT_ENDED'
  | 'EFFECT_CANCELLED'
  | 'ALREADY_SENT'
  | 'RESEND_NOT_ALLOWED'
  | 'COLLECTOR_NOT_RESTARTABLE'
  // I3 (AC-I3-36·60~67)
  | 'ASSISTANT_FORBIDDEN'
  | 'ASSISTANT_LIMIT'
  | 'LOGIN_RATE_LIMITED'
  | 'LOGIN_BUSY'
  | 'CONFIRM_NOT_ALLOWED'
  | 'DISMISS_NOT_ALLOWED'
  | 'REHEARSAL_OUTBOX'
  // I1 출력 API (LABEL_RULES L-8·L-11)
  | 'PRINT_REHEARSAL'
  | 'PRINT_NOT_DEVICE'
  | 'PRINT_DEVICE_TAKEN'
  | 'PRINT_RECONNECT_REQUIRED'
  | 'PRINT_NOT_WINNER'
  | 'PRINT_LABEL_EXISTS'
  | 'PRINT_VOIDED'
  | 'PRINT_IN_PROGRESS'
  | 'PRINT_NOT_PRINTED'
  | 'PRINT_WINNER_CHANGED'
  | 'PRINT_JOB_PRINTING'
  | 'PRINT_NOT_DISCARDABLE'
  | 'PRINT_NO_ITEMS'
  | 'PRINT_CONFIRM_REQUIRED'
  | 'PRINT_STALE'
  | 'PRINT_NO_REPORT'
  | 'INVALID_TEMPLATE'
  // N2b-2 틱톡·붙여넣기 (AC-N2b-2-21·24·30·34·56·57)
  | 'NOTHING_TO_ADD'
  | 'REQUEST_REUSED'
  | 'TOO_LONG'
  | 'TOO_MANY_LINES'
  | 'INVALID_TIKTOK_ID'
  | 'NOTICE_CHANGED'
  | 'TIKTOK_LINKED'
  | 'TIKTOK_IN_USE'
  | 'TOO_SOON'
  | 'TEMPLATE_TOO_LARGE'
  | 'TEMPLATE_CONFLICT'
  // N2 인스타그램·라이브 연결 API
  | 'NOT_CONFIGURED'
  | 'NOT_CONNECTED'
  | 'RECONNECT_NEEDED'
  | 'UNAVAILABLE'
  // N4a 라벨 기능 끄기 (LABEL_RULES L-13 5)
  | 'LABELS_OFF'
  // I2 API (harness/sprints/I2/dev-notes.md)
  | 'NO_ITEMS'
  | 'AMOUNT_MISMATCH'
  | 'AMOUNT_MISSING'
  | 'LABEL_INVALID'
  | 'PERIOD_INVALID'
  | 'NO_BROADCASTS'
  | 'PACKING_STATE'
  | 'ITEMS_CHANGED'
  | 'PACKING_RECORDED'
  | 'IMPORT_CHANGED'
  | 'IMPORT_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE'
  | 'FILE_UNREADABLE'
  | 'NO_RECORDS'
  | 'BUSY'
  | 'FILE_FAILED'
  // N5 요금 API (BILLING_RULES BL-4·BL-6·BL-7·BL-8)
  | 'NO_PASS'
  | 'TERMS_REQUIRED'
  | 'ITEM_UNAVAILABLE'
  | 'BUSINESS_REQUIRED'
  | 'REFUND_NOT_ALLOWED'
  | 'REFUND_IN_PROGRESS'
  | 'REFUND_FAILED'
  // N4b 구매자 확인서 공유 링크 (harness/sprints/N4b/dev-notes.md)
  | 'REHEARSAL_RECEIPT_LINK'
  // N3 입금 확인 API (DEPOSIT_RULES DP-1·DP-2·DP-6)
  | 'BUNDLE_CHANGED'
  | 'DEPOSIT_APPLIED'
  | 'DEPOSIT_IGNORED'
  | 'DEPOSIT_NOT_REVIEW'
  | 'DEPOSIT_NOT_IGNORED'
  | 'DEPOSIT_NOT_APPLIED'
  | 'DEPOSIT_CHANGED'
  | 'REFUND_RECORDED'
  | 'DUPLICATE_ITEM'
  | 'PASTE_NO_HEADER'
  | 'PASTE_TOO_MANY_ROWS'
  | 'POPBILL_NOT_READY'
  | 'SOURCE_NO_FETCH'
  | 'SOURCE_DISABLED'
  | 'SOURCE_FAILED'
  | 'FETCH_TOO_SOON'
  | 'CORP_NOT_ALLOWED'
  // T1 택배 자동 접수 (PARCEL_RULES PC-3~PC-8)
  | 'PARCEL_BLOCKED'
  | 'PARCEL_LOCKED'
  | 'PARCEL_STATE'
  | 'PICKED_UP'
  | 'ADDRESS_CHANGED'
  | 'ADDRESS_EXPIRED'
  | 'NO_ADDRESS'
  | 'NO_PARCELS'
  | 'CARRIER_UNAVAILABLE'
  | 'TOO_MANY'
  | 'REHEARSAL_PARCEL'
  | 'REQUEST_BUSY'
  | 'WAYBILL_TOO_LONG'
  // L1 간편 로그인
  | 'LOGIN_METHOD_LAST'
  // X1 크롬 확장으로 채팅 읽기 (YT-10)
  | 'EXT_DISCONNECTED'
  | 'EXT_CODE_INVALID'
  | 'EXT_CODE_LIMITED'
  | 'EXT_RATE_LIMITED'
  | 'EXT_NOT_BOUND'
  | 'EXT_BIND_REJECTED'
  | 'EXT_ENDED'
  | 'NOT_OWN_LIVE'
  | 'PLATFORM_NOT_READY'
  | 'NO_CONSENT'
  // A1 AI 제안: 켜기에 동의가 없음
  | 'CONSENT_REQUIRED'

export interface ErrorBody {
  readonly error: {
    readonly code: ErrorCode
    readonly message: string
  }
}

/**
 * 입력 문제 하나: 필드 이름(알 수 없거나 되돌려 보내면 안 되는 이름이면 null)과 쉬운 한국어 문장. 받은 값은 담지 않는다.
 * hint는 있을 때만 — message 뒤에 덧붙여 보여 줄 다음 할 일(예: 구매자 칸의 휴대폰 번호 → "전화번호 대신 구매자를 골라 주세요.")
 */
export interface FieldProblem {
  readonly field: string | null
  readonly message: string
  readonly hint?: string
}

export interface DescribedError {
  readonly status: number
  readonly body: ErrorBody
}

const KNOWN: ReadonlyMap<number, ErrorBody['error']> = new Map([
  [400, { code: 'BAD_REQUEST', message: '요청 형식이 올바르지 않아요.' }],
  [404, { code: 'NOT_FOUND', message: '요청한 주소를 찾을 수 없어요.' }],
  [405, { code: 'METHOD_NOT_ALLOWED', message: '이 주소에서는 할 수 없는 요청이에요.' }],
  [408, { code: 'REQUEST_TIMEOUT', message: '요청이 너무 오래 걸려서 끊었어요.' }],
  [413, { code: 'PAYLOAD_TOO_LARGE', message: '보낸 내용이 너무 커요.' }],
  [431, { code: 'HEADERS_TOO_LARGE', message: '요청 정보가 너무 커요.' }],
])

const OTHER_CLIENT_ERROR: ErrorBody['error'] = { code: 'REQUEST_ERROR', message: '요청을 처리할 수 없어요.' }
const SERVER_ERROR: ErrorBody['error'] = { code: 'INTERNAL_ERROR', message: '서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' }

/**
 * 상태 코드에 맞는 오류 본문을 고른다.
 * 4xx는 그대로 두고, 5xx도 그대로 두되 내용은 일반 문구로 바꾼다. 그 밖의 값(2xx·3xx·잘못된 숫자)은 500으로 본다.
 */
export function describeError(status: number): DescribedError {
  if (Number.isInteger(status) && status >= 400 && status <= 499) {
    return { status, body: { error: KNOWN.get(status) ?? OTHER_CLIENT_ERROR } }
  }
  if (Number.isInteger(status) && status >= 500 && status <= 599) {
    return { status, body: { error: SERVER_ERROR } }
  }
  return { status: 500, body: { error: SERVER_ERROR } }
}

export const JSON_CONTENT_TYPE = 'application/json'

/** 오류 응답(Response). 추가 헤더(예: 405의 Allow)를 받을 수 있다. Content-Type은 항상 JSON이다. */
export function errorResponse(status: number, extraHeaders: Readonly<Record<string, string>> = {}): Response {
  const described = describeError(status)
  const headers = new Headers(extraHeaders)
  headers.set('Content-Type', JSON_CONTENT_TYPE)
  return new Response(JSON.stringify(described.body), { status: described.status, headers })
}

/**
 * API 오류 응답 (S04). 본문: `{"error":{"code","message","problems"?}, ...extra}`.
 * 받은 값은 되돌려 보내지 않는다(문제에는 필드 이름과 서버가 정한 문장만). 개인 데이터가 섞일 수 있어 캐시하지 않는다.
 */
export function apiError(
  status: number,
  code: ErrorCode,
  message: string,
  problems: readonly FieldProblem[] = [],
  extra: Readonly<Record<string, unknown>> = {},
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const error = problems.length === 0 ? { code, message } : { code, message, problems }
  const headers = new Headers(extraHeaders)
  headers.set('Content-Type', JSON_CONTENT_TYPE)
  headers.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify({ ...extra, error }), { status, headers })
}
