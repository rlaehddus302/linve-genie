// 프린터 오류 코드와 화면 문장 (LABEL_RULES L-7 표, UX-01·UX-03, AC-P1-43·62).
// 실패는 언제나 코드 + 이 문장으로 알린다. 원래 예외는 접어 둘 기술 상세(detail)에만 담고, 라벨 내용은 담지 않는다.

/** L-7 표의 오류 코드 */
export const PRINTER_ERROR_CODES = [
  'UNSUPPORTED',
  'NOT_SELECTED',
  'BLUETOOTH_OFF',
  'PORT_BUSY',
  'WRONG_MODEL',
  'DISCONNECTED',
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

/** L-7 표 그대로 (글자까지 같다) */
export const PRINTER_MESSAGES: Readonly<Record<PrinterErrorCode, string>> = {
  UNSUPPORTED: '이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.',
  NOT_SELECTED: '프린터를 고르지 않았어요. 다시 연결을 누르고 목록에서 B1을 골라 주세요.',
  BLUETOOTH_OFF: '블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 연결해 주세요.',
  PORT_BUSY: 'USB 연결을 다른 프로그램이 쓰고 있어요. NIIMBOT 프로그램을 닫거나 블루투스로 연결해 주세요.',
  WRONG_MODEL: '지금은 NIIMBOT B1만 연결할 수 있어요. B1을 골라 주세요.',
  DISCONNECTED: '프린터 연결이 끊겼어요.',
  NOT_CONNECTED: '프린터를 먼저 연결해 주세요.',
  BUSY: '앞 라벨을 출력하는 중이에요. 끝난 뒤 다시 해 주세요.',
  IMAGE_TOO_WIDE: '라벨이 프린터보다 넓어요. 라벨 크기를 확인해 주세요.',
  TIMEOUT: '프린터가 응답하지 않아요. 프린터 전원과 라벨을 확인한 뒤 다시 시작해 주세요.',
  PRINT_FAILED: '라벨을 출력하지 못했어요. 프린터의 라벨과 덮개를 확인한 뒤 다시 시작해 주세요.',
  INVALID_DENSITY: '인쇄 농도는 1~5 사이의 정수로 정해 주세요.',
}

/** 끊김 문장과 함께 보일 단추 (LBL-06 AC2) */
export const RECONNECT_ACTION = '다시 연결'

export interface PrinterError {
  readonly code: PrinterErrorCode
  /** 화면에 그대로 쓰는 쉬운 한국어 문장 */
  readonly message: string
  /** 함께 보일 단추 (끊김이면 `다시 연결`) */
  readonly action?: string
  /** 접어 둘 기술 상세 — 원래 예외의 이름과 메시지(전화번호 꼴 숫자는 가린다). 라벨 내용은 담지 않는다 */
  readonly detail?: string
}

export type PrinterResult = { readonly ok: true } | { readonly ok: false; readonly error: PrinterError }

export const OK: PrinterResult = Object.freeze({ ok: true })

const DETAIL_MAX = 300

/** 원래 예외 → 기술 상세 글. 7자리 이상 이어진 숫자(구분자 포함)는 가린다 — 전화번호가 상세로 새지 않게 */
export function describeCause(cause: unknown): string | undefined {
  if (cause === undefined) return undefined
  let text: string
  if (cause instanceof Error) text = `${cause.name}: ${cause.message}`
  else if (typeof cause === 'object' && cause !== null && 'name' in cause && 'message' in cause) text = `${String(cause.name)}: ${String(cause.message)}`
  else text = String(cause)
  text = text.replace(/\d(?:[\s-]?\d){6,}/g, '***')
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text
}

export function printerError(code: PrinterErrorCode, cause?: unknown): PrinterError {
  const detail = describeCause(cause)
  return {
    code,
    message: PRINTER_MESSAGES[code],
    ...(code === 'DISCONNECTED' ? { action: RECONNECT_ACTION } : {}),
    ...(detail === undefined ? {} : { detail }),
  }
}

export function fail(code: PrinterErrorCode, cause?: unknown): PrinterResult {
  return { ok: false, error: printerError(code, cause) }
}
