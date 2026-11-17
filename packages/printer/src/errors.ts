// 프린터 오류 코드와 화면 문장 (LABEL_RULES L-7 표, UX-01·UX-03, AC-P1-43·62).
// 실패는 언제나 코드 + 이 문장으로 알린다. 접어 둘 상세(detail)에는 원래 예외 글을 넣지 않는다 — 쉬운 말 고정 문장만 (FB1, D-FB1-09).

/** L-7 표의 오류 코드 */
export const PRINTER_ERROR_CODES = [
  'UNSUPPORTED',
  'NOT_SELECTED',
  'BLUETOOTH_OFF',
  'PORT_BUSY',
  'WRONG_MODEL',
  'DISCONNECTED',
  'CONNECT_FAILED',
  'NOT_CONNECTED',
  'BUSY',
  'IMAGE_TOO_WIDE',
  'TIMEOUT',
  'PRINT_FAILED',
] as const
export type PrinterTableErrorCode = (typeof PRINTER_ERROR_CODES)[number]

/**
 * 농도가 프로필 범위(B1은 1~5 정수) 밖이면 보내지 않는다(AC-P1-42). L-7 표에 이 경우의 코드가 없어 따로 둔다
 * (dev-notes "스펙에 올린 것" — spec-keeper가 표에 더할지 정한다).
 */
export type PrinterErrorCode = PrinterTableErrorCode | 'INVALID_DENSITY'

/** L-7 표 그대로 (글자까지 같다). NOT_SELECTED·WRONG_MODEL은 PRN2(D-PRN2-05) 문장 — 켠 모델이 B1 하나가 아니다 */
export const PRINTER_MESSAGES: Readonly<Record<PrinterErrorCode, string>> = {
  UNSUPPORTED: '이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.',
  NOT_SELECTED: '프린터를 고르지 않았어요. 다시 연결을 누르고 목록에서 프린터를 골라 주세요.',
  BLUETOOTH_OFF: '블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 연결해 주세요.',
  PORT_BUSY: 'USB 연결을 다른 프로그램이 쓰고 있어요. NIIMBOT 프로그램을 닫거나 블루투스로 연결해 주세요.',
  WRONG_MODEL: '이 프린터는 바로 출력할 수 없어요. 다른 프린터를 고르거나, 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.',
  DISCONNECTED: '프린터 연결이 끊겼어요.',
  CONNECT_FAILED: '프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요.',
  NOT_CONNECTED: '프린터를 먼저 연결해 주세요.',
  BUSY: '앞 라벨을 출력하는 중이에요. 끝난 뒤 다시 해 주세요.',
  IMAGE_TOO_WIDE: '라벨이 프린터보다 넓어요. 라벨 크기를 확인해 주세요.',
  TIMEOUT: '프린터가 응답하지 않아요. 프린터 전원과 라벨을 확인한 뒤 다시 시작해 주세요.',
  PRINT_FAILED: '라벨을 출력하지 못했어요. 프린터의 라벨과 덮개를 확인한 뒤 다시 시작해 주세요.',
  INVALID_DENSITY: '인쇄 농도는 1~5 사이의 정수로 정해 주세요.',
}

/** 끊김·연결 실패 문장과 함께 보일 단추 (LBL-06 AC2, D-FB1-09) */
export const RECONNECT_ACTION = '다시 연결'

/** `다시 연결` 단추가 붙는 코드 */
const RECONNECT_CODES: ReadonlySet<PrinterErrorCode> = new Set(['DISCONNECTED', 'CONNECT_FAILED'])

/** 상세 고정 문장 — 원인이 시간 초과일 때 (L-7 자세히) */
export const TIMEOUT_DETAIL = '프린터가 답하지 않아 기다리는 시간이 지났어요.'
/** 저절로 한 번 더 해 봤을 때 TIMEOUT_DETAIL 뒤에 붙는 문장 (L-7 B1 첫 확인 다시 잇기) */
export const RETRIED_DETAIL_SUFFIX = ' 한 번 더 해 봤지만 안 됐어요.'
/** 시간 초과로 실패해 한 번 더 해 봤지만 또 실패했을 때의 상세 */
export const RETRIED_TIMEOUT_DETAIL = `${TIMEOUT_DETAIL}${RETRIED_DETAIL_SUFFIX}`

export interface PrinterError {
  readonly code: PrinterErrorCode
  /** 화면에 그대로 쓰는 쉬운 한국어 문장 */
  readonly message: string
  /** 함께 보일 단추 (끊김·연결 실패면 `다시 연결`) */
  readonly action?: string
  /**
   * 접어 둘 상세 — 쉬운 말 고정 문장뿐이다(원래 예외 글·라벨 내용은 담지 않는다, D-FB1-09): TIMEOUT_DETAIL,
   * RETRIED_TIMEOUT_DETAIL, WRONG_MODEL의 "모델: {모델 이름}". 그 밖엔 없다
   */
  readonly detail?: string
  /**
   * 프린터가 알린 까닭 (PRINT_FAILED에만, D-ALERTFLOAT-01) — 덮개 열림·용지 없음·배터리·과열. 모르는 까닭이면 없다.
   * 출력 기기 앱이 출력 결과의 까닭으로 서버에 올려 라이브 화면이 "라벨이 안 나가요"의 까닭을 보인다
   */
  readonly issue?: PrinterIssue
}

/** 프린터가 알린 출력 실패 까닭 (서버 ATTEMPT_CAUSE_REASONS·웹 PrintIssue와 같은 낱말) */
export const PRINTER_ISSUES = ['COVER_OPEN', 'NO_PAPER', 'LOW_BATTERY', 'OVERHEAT'] as const
export type PrinterIssue = (typeof PRINTER_ISSUES)[number]

/** 까닭이 있는 출력 실패의 화면 문장 (PRINT_FAILED 문장 대신) */
export const PRINT_ISSUE_MESSAGES: Readonly<Record<PrinterIssue, string>> = {
  COVER_OPEN: '프린터 덮개가 열려 있어요. 덮개를 닫은 뒤 다시 시작해 주세요.',
  NO_PAPER: '프린터에 라벨이 없어요. 라벨을 넣은 뒤 다시 시작해 주세요.',
  LOW_BATTERY: '프린터 배터리가 부족해요. 충전한 뒤 다시 시작해 주세요.',
  OVERHEAT: '프린터가 너무 뜨거워요. 잠시 식힌 뒤 다시 시작해 주세요.',
}

/**
 * NIIMBOT 프린터 오류 번호(niimbluelib PrinterErrorCode — PrintError.reasonId) → 까닭.
 * 1 덮개 열림 · 2 용지 없음 · 3 배터리 부족 · 4 배터리 이상 · 7 과열. 그 밖의 번호는 모른다(붙이지 않는다)
 */
const NIIMBOT_REASON_ISSUES: ReadonlyMap<number, PrinterIssue> = new Map([
  [1, 'COVER_OPEN'],
  [2, 'NO_PAPER'],
  [3, 'LOW_BATTERY'],
  [4, 'LOW_BATTERY'],
  [7, 'OVERHEAT'],
])

/** 원래 예외가 niimbluelib PrintError(reasonId 칸)면 그 까닭 — 모양으로 본다(라이브러리 사본이 둘이어도 instanceof에 기대지 않는다) */
export function niimbotIssueOf(cause: unknown): PrinterIssue | undefined {
  if (typeof cause !== 'object' || cause === null || !('reasonId' in cause)) return undefined
  const reasonId = (cause as { readonly reasonId: unknown }).reasonId
  return typeof reasonId === 'number' ? NIIMBOT_REASON_ISSUES.get(reasonId) : undefined
}

/** 출력 실패(PRINT_FAILED) — 프린터가 까닭을 알렸으면 그 까닭과 맞는 문장, 아니면 L-7 표 문장 */
export function printFailed(cause: unknown, issue: PrinterIssue | undefined): PrinterResult {
  if (issue === undefined) return fail('PRINT_FAILED', cause)
  return { ok: false, error: { ...printerErrorWithMessage('PRINT_FAILED', PRINT_ISSUE_MESSAGES[issue], cause), issue } }
}

export type PrinterResult = { readonly ok: true } | { readonly ok: false; readonly error: PrinterError }

export const OK: PrinterResult = Object.freeze({ ok: true })

/** 원래 예외의 글 (이름 + 메시지) — 상세에 넣지 않고 원인을 가리는 데만 쓴다 */
function causeText(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`
  if (typeof cause === 'object' && cause !== null && 'name' in cause && 'message' in cause) return `${String(cause.name)}: ${String(cause.message)}`
  return String(cause)
}

/** 원인이 시간 초과인지 (예외 글에 `timeout`·`timed out`, 대소문자 무시 — L-7 자세히) */
export function isTimeoutCause(cause: unknown): boolean {
  if (cause === undefined || cause === null) return false
  return /timeout|timed out/i.test(causeText(cause))
}

/**
 * 원래 예외 → 상세 고정 문장. 시간 초과면 TIMEOUT_DETAIL, 그 밖엔 undefined.
 * FB1(D-FB1-09)부터 원래 예외 글을 돌려주지 않는다 — 전에는 예외 이름·메시지를 돌려줬다.
 */
export function describeCause(cause: unknown): string | undefined {
  return isTimeoutCause(cause) ? TIMEOUT_DETAIL : undefined
}

/** 상세를 정해 둔 원인 (WRONG_MODEL의 모델 이름, 다시 잇기 뒤의 상세) — 밖에서는 modelDetail·retriedTimeoutDetail로만 만든다 */
class FixedDetail {
  readonly text: string
  constructor(text: string) {
    this.text = text
  }
}

/** 고정 상세: "모델: {모델 이름}" (WRONG_MODEL) */
export function modelDetail(model: string): unknown {
  return new FixedDetail(`모델: ${model}`)
}

/** 고정 상세: 시간 초과로 한 번 더 해 봤지만 안 됐다 */
export function retriedTimeoutDetail(): unknown {
  return new FixedDetail(RETRIED_TIMEOUT_DETAIL)
}

function detailOf(cause: unknown): string | undefined {
  if (cause instanceof FixedDetail) return cause.text
  return describeCause(cause)
}

export function printerError(code: PrinterErrorCode, cause?: unknown): PrinterError {
  return printerErrorWithMessage(code, PRINTER_MESSAGES[code], cause)
}

/** 코드 + 정한 문장으로 오류를 만든다 (어댑터마다 문장이 다른 코드 — L-12 6). 끊김·연결 실패면 `다시 연결` 단추가 붙는다 */
export function printerErrorWithMessage(code: PrinterErrorCode, message: string, cause?: unknown): PrinterError {
  const detail = detailOf(cause)
  return {
    code,
    message,
    ...(RECONNECT_CODES.has(code) ? { action: RECONNECT_ACTION } : {}),
    ...(detail === undefined ? {} : { detail }),
  }
}

/** Marklife·바우아토 어댑터가 쓰는 코드 — PORT_BUSY(USB)는 쓰지 않는다 (L-12 6) */
export type MarklifeErrorCode = Exclude<PrinterErrorCode, 'PORT_BUSY'>

/**
 * Marklife·바우아토 어댑터의 문장 (L-12 6 — 글자 그대로). NIIMBOT·B1을 말하지 않는다. 문장이 다른 것은 NOT_SELECTED·WRONG_MODEL·
 * INVALID_DENSITY이고 나머지는 L-7 표 그대로다. UNSUPPORTED는 까닭에 따라 다르므로 unsupportedMessage(까닭, 앱)로 만든다
 * (여기 값은 까닭 OTHER + Marklife 앱). B1 어댑터의 문장(PRINTER_MESSAGES)은 바꾸지 않는다.
 */
export const MARKLIFE_MESSAGES: Readonly<Record<MarklifeErrorCode, string>> = {
  UNSUPPORTED: '이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 Marklife 앱에서 인쇄해 주세요.',
  NOT_SELECTED: '프린터를 고르지 않았어요. 다시 연결을 누르고 목록에서 프린터를 골라 주세요.',
  BLUETOOTH_OFF: PRINTER_MESSAGES.BLUETOOTH_OFF,
  WRONG_MODEL: '연결할 수 없는 프린터예요. 목록에 있는 프린터를 골라 주세요.',
  DISCONNECTED: PRINTER_MESSAGES.DISCONNECTED,
  CONNECT_FAILED: PRINTER_MESSAGES.CONNECT_FAILED,
  NOT_CONNECTED: PRINTER_MESSAGES.NOT_CONNECTED,
  BUSY: PRINTER_MESSAGES.BUSY,
  IMAGE_TOO_WIDE: PRINTER_MESSAGES.IMAGE_TOO_WIDE,
  TIMEOUT: PRINTER_MESSAGES.TIMEOUT,
  PRINT_FAILED: PRINTER_MESSAGES.PRINT_FAILED,
  INVALID_DENSITY: '인쇄 농도는 1~3 사이의 정수로 정해 주세요.',
}

/** INVALID_DENSITY 문장 — {최소}~{최대} = 프로필의 농도 범위 (L-7 표, D-PRN2-05). B1(1~5)은 PRINTER_MESSAGES와 글자까지 같다 */
export function densityMessage(range: { readonly min: number; readonly max: number }): string {
  return `인쇄 농도는 ${String(range.min)}~${String(range.max)} 사이의 정수로 정해 주세요.`
}

export function fail(code: PrinterErrorCode, cause?: unknown): PrinterResult {
  return { ok: false, error: printerError(code, cause) }
}
