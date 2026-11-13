// 프린터 연결 사실 모으기 (F2-2, D-RETRO-43): 출력이 시간 초과·끊김으로 끝났을 때 까닭을 정하는 데 쓴다(lib/print-cause.ts).
// 마지막으로 프린터 쪽에서 끊긴 때와 오류 번호(printer-diag가 알린다), 앱이 마지막으로 앞에서 벗어난 때, 지금 블루투스 상태·앱 앞/뒤.
// 남기는 것은 수(오류 번호·시각)뿐이다 — 기기 주소·이름·오류 문장은 읽지 않는다. 아이폰·안드로이드 같은 코드다(오류 번호 칸만 플랫폼마다 다르게 온다).
import type { LinkAppState, LinkFacts, LinkLost, LinkRadio } from '../lib/print-cause.ts'

let lost: LinkLost | null = null
let leftAt: number | null = null
let app: LinkAppState = 'unknown'

const int = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined)

/** 프린터 쪽에서 끊겼다 (BleManager onDeviceDisconnected) — 오류 번호만 읽는다. 오류 없이 끊기면 번호 없이 때만 */
export function noteLinkLost(error: unknown, now: number = Date.now()): void {
  const e = (typeof error === 'object' && error !== null ? error : {}) as { errorCode?: unknown; androidErrorCode?: unknown; iosErrorCode?: unknown; attErrorCode?: unknown; reason?: unknown }
  const ble = int(e.errorCode)
  // 안드로이드는 번호 칸이 비고 까닭 글에 "status 8"처럼만 올 때가 있다 — 그 수만 읽는다(글은 남기지 않는다)
  const status = typeof e.reason === 'string' ? /status\s*(\d{1,5})/i.exec(e.reason)?.[1] : undefined
  const android = int(e.androidErrorCode) ?? (status === undefined ? undefined : Number(status))
  const ios = int(e.iosErrorCode)
  const att = int(e.attErrorCode)
  lost = { at: now, ...(ble === undefined ? {} : { ble }), ...(android === undefined ? {} : { android }), ...(ios === undefined ? {} : { ios }), ...(att === undefined ? {} : { att }) }
}

const APP_STATES: ReadonlySet<string> = new Set(['active', 'background', 'inactive'])

/** 앱 앞/뒤가 바뀌었다 (AppState) — 앞에서 벗어난 때를 적는다 */
export function noteAppState(state: string | null | undefined, now: number = Date.now()): void {
  const next: LinkAppState = typeof state === 'string' && APP_STATES.has(state) ? (state as LinkAppState) : 'unknown'
  if (next !== 'active' && app !== next) leftAt = now
  app = next
}

/** 마지막으로 들은 앱 앞/뒤 */
export const appStateNow = (): LinkAppState => app

/** 지금 아는 사실 (블루투스 상태는 부를 때 읽은 값을 넘긴다) */
export function linkFacts(radio: LinkRadio): LinkFacts {
  return { radio, app, leftAt, lost }
}

/** 시험: 모은 것을 비운다 */
export function resetLinkFacts(): void {
  lost = null
  leftAt = null
  app = 'unknown'
}
