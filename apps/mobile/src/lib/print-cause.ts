// 출력이 실패한 까닭 (F2-2, D-RETRO-43): 시간 초과·끊김으로 끝난 출력 시도에 앱이 아는 까닭과 시각을 붙여 서버의 출력 시도 기록에 남긴다.
// 11월 12일 방송에서 시간 초과가 9번 났는데 왜 끊겼는지(블루투스·거리·앱이 뒤로 감) 서버 기록으로 알 수 없었다.
// - 까닭은 앱이 본 사실로만 정한다: 휴대폰 블루투스 상태, 앱이 앞에 있었는지, 프린터 쪽에서 끊긴 때와 그 오류 번호, 어댑터의 오류 코드.
//   사실을 모르면(시험용 프린터처럼 블루투스를 쓰지 않는 연결) 붙이지 않는다 — 오류 코드만으로 짐작한 까닭은 서버가 이미 아는 것(코드)을 되풀이할 뿐이다.
// - 남기는 것: 까닭 낱말·시각·블루투스 상태·앱 앞/뒤·오류 번호(수)·걸린 시간·프린터 프로필 ID(모델). 기기 주소·이름·오류 문장·라벨 내용은 남기지 않는다.
// - 화면에 보이는 값이 아니다(판매자 화면 문구는 그대로 — 기록·복기용).

/** 휴대폰 블루투스 상태 (@livejjim/mobile-ble BleRadioState와 같은 낱말) */
export type LinkRadio = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown'
export type LinkAppState = 'active' | 'background' | 'inactive' | 'unknown'

/** 프린터 쪽에서 끊긴 때와 그 오류 번호 (블루투스 모듈·안드로이드·아이폰·ATT — 없으면 없다) */
export interface LinkLost {
  /** 끊긴 때 (앱 시계, 밀리초) */
  readonly at: number
  readonly ble?: number
  readonly android?: number
  readonly ios?: number
  readonly att?: number
}

/** 네이티브 쪽이 아는 연결 사실 (native/link-facts.ts가 모은다) */
export interface LinkFacts {
  readonly radio: LinkRadio
  readonly app: LinkAppState
  /** 앱이 마지막으로 앞에서 벗어난 때 (없으면 null) */
  readonly leftAt: number | null
  /** 마지막으로 프린터 쪽에서 끊긴 것 (없으면 null) */
  readonly lost: LinkLost | null
}

/** 서버 print.ts ATTEMPT_CAUSE_REASONS와 같은 낱말 */
export type PrintCauseReason = 'BLUETOOTH_OFF' | 'BLUETOOTH_DENIED' | 'OUT_OF_RANGE' | 'PRINTER_CLOSED' | 'LINK_LOST' | 'APP_BACKGROUND' | 'NO_RESPONSE' | 'UNKNOWN'

/** POST /api/print/result의 cause */
export interface PrintCause {
  readonly reason: PrintCauseReason
  /** 실패를 본 시각 (앱 시계, UTC ISO) */
  readonly at: string
  readonly radio?: LinkRadio
  readonly app?: LinkAppState
  /** 이 시도 중에 앱이 앞에서 벗어난 적이 있다 */
  readonly wentBackground?: boolean
  /** 출력을 보낸 뒤 실패까지 걸린 시간 */
  readonly elapsedMs: number
  /** 프린터 쪽에서 끊긴 지 얼마나 됐는지 (이 시도와 이어진 끊김일 때만) */
  readonly lostAgoMs?: number
  readonly ble?: number
  readonly android?: number
  readonly ios?: number
  readonly att?: number
  /** 프린터 프로필 ID (모델 — 예 NIIMBOT_B1). 기기 이름·주소가 아니다 */
  readonly profileId?: string
}

/** 까닭을 붙이는 오류 코드: 시간 초과·끊김, 그리고 연결·블루투스 탓인 실패. 라벨을 못 그린 실패(크기·그림)는 프린터 연결과 상관없어 붙이지 않는다 */
const LINK_CODES: ReadonlySet<string> = new Set(['TIMEOUT', 'DISCONNECTED', 'NOT_CONNECTED', 'BLUETOOTH_OFF', 'CONNECT_FAILED', 'PRINT_FAILED', 'BUSY'])
export const needsCause = (code: string): boolean => LINK_CODES.has(code)

/** 이 시도와 이어진 끊김으로 보는 범위: 출력을 보내기 이만큼 전부터 (보내기 직전에 끊겨 보내자마자 실패한 경우) */
export const LOST_BEFORE_START_MS = 5_000

/**
 * 끊긴 오류 번호 → 낱말. 안드로이드 GATT 8(연결 시간 초과 — 거리가 멀거나 프린터 전원)·아이폰 CBError 6(연결 시간 초과)은 OUT_OF_RANGE,
 * 안드로이드 GATT 19(상대가 끊음)·아이폰 CBError 7(주변 기기가 끊음)은 PRINTER_CLOSED(프린터가 꺼지거나 절전), 그 밖은 LINK_LOST
 */
function lostReason(lost: LinkLost): PrintCauseReason {
  if (lost.android === 8 || lost.ios === 6) return 'OUT_OF_RANGE'
  if (lost.android === 19 || lost.ios === 7) return 'PRINTER_CLOSED'
  return 'LINK_LOST'
}

export interface PrintCauseInput {
  /** 어댑터의 오류 코드 (L-7 표) */
  readonly code: string
  /** 출력을 보낸 때·실패를 본 때 (앱 시계, 밀리초) */
  readonly startedAt: number
  readonly failedAt: number
  /** 네이티브 쪽이 아는 사실 — 모르면(시험용 프린터) null: 까닭을 붙이지 않는다 */
  readonly facts: LinkFacts | null
  readonly profileId: string | null
}

/**
 * 까닭 정하기. 차례: 블루투스 꺼짐 → 블루투스 권한 없음 → 이 시도와 이어진 끊김(오류 번호로 거리/프린터/그 밖) →
 * 이 시도 중 앱이 뒤로 감 → 이어져 있는데 답이 없음(시간 초과) → 모름. 까닭을 붙이지 않는 코드거나 사실을 모르면 null
 */
export function printCause(input: PrintCauseInput): PrintCause | null {
  const { facts, startedAt, failedAt } = input
  if (!needsCause(input.code) || facts === null) return null
  const elapsedMs = Math.max(0, Math.round(failedAt - startedAt))
  const lost = facts.lost !== null && facts.lost.at >= startedAt - LOST_BEFORE_START_MS && facts.lost.at <= failedAt ? facts.lost : null
  // 앱이 지금 뒤에 있거나(모름은 뒤로 치지 않는다), 이 시도 중에 앞에서 벗어난 적이 있다
  const wentBackground = facts.app === 'background' || facts.app === 'inactive' || (facts.leftAt !== null && facts.leftAt >= startedAt && facts.leftAt <= failedAt)
  let reason: PrintCauseReason
  if (facts.radio === 'off' || input.code === 'BLUETOOTH_OFF') reason = 'BLUETOOTH_OFF'
  else if (facts.radio === 'unauthorized') reason = 'BLUETOOTH_DENIED'
  else if (lost !== null) reason = lostReason(lost)
  else if (wentBackground) reason = 'APP_BACKGROUND'
  else if (input.code === 'DISCONNECTED' || input.code === 'NOT_CONNECTED') reason = 'LINK_LOST'
  else if (input.code === 'TIMEOUT') reason = 'NO_RESPONSE'
  else reason = 'UNKNOWN'
  const code = (value: number | undefined): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined)
  const numbers = lost === null ? {} : { lostAgoMs: Math.max(0, Math.round(failedAt - lost.at)), ble: code(lost.ble), android: code(lost.android), ios: code(lost.ios), att: code(lost.att) }
  const cause: Record<string, unknown> = {
    reason,
    at: new Date(failedAt).toISOString(),
    radio: facts.radio,
    app: facts.app,
    wentBackground,
    elapsedMs,
    ...numbers,
    ...(input.profileId === null ? {} : { profileId: input.profileId }),
  }
  for (const key of Object.keys(cause)) if (cause[key] === undefined) delete cause[key]
  return cause as unknown as PrintCause
}
