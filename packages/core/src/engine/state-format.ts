// 엔진 상태 형식 (R-1 "상태 형식", D-072, RA-S03b-004).
// 상태에는 형식 번호(format)가 있다. applyEvent·checkEvent는 지금 코어의 형식과 다른 상태를 받으면 StateFormatError를 던지고
// 아무것도 하지 않는다. 저장한 상태를 읽는 쪽(서버)은 형식이 다르면 그 상태를 쓰지 않고 이벤트 로그를 처음부터 재생한다.
// O1(형식 5)부터는 바로 앞 형식 4(다육 방송만 있던 상태)를 형식 5로 바꾸는 upgradeState(upgrade.ts)도 둔다 — 재생 없이 이어 쓸 수 있다.

/** 지금 코어의 상태 형식 번호 (S03b = 3 → S04 = 4 → O1 = 5). 서버가 스냅샷 형식 비교에 쓴다 */
export const STATE_FORMAT = 5

/**
 * 상태 형식이 지금 코어와 다르다 (입력 오류 InvalidEventError·미구현 NotImplementedError와 구별되는 오류). 판별은 isStateFormatError로 한다.
 * 메시지에는 받은 형식과 지원 형식만 담는다(상태 내용은 담지 않는다).
 */
export class StateFormatError extends Error {
  /** 받은 상태의 형식 번호 (형식 번호가 없거나 수가 아니거나 상태가 객체가 아니면 null) */
  readonly received: number | null
  /** 지금 코어가 지원하는 형식 번호 */
  readonly supported: number

  constructor(received: number | null, what: string) {
    super(`상태 형식이 다르다 (받은 형식: ${what}, 지원 형식: ${String(STATE_FORMAT)}) — 저장한 상태를 쓰지 말고 이벤트 로그를 처음부터 재생한다`)
    this.name = 'StateFormatError'
    this.received = received
    this.supported = STATE_FORMAT
  }
}

export function isStateFormatError(error: unknown): error is StateFormatError {
  return error instanceof StateFormatError
}

/** 상태의 형식 번호가 지금 코어와 같지 않으면 StateFormatError */
export function assertStateFormat(state: unknown): void {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) throw new StateFormatError(null, '상태가 객체가 아님')
  const format: unknown = Object.hasOwn(state, 'format') ? (state as { readonly format: unknown }).format : undefined
  if (format === STATE_FORMAT) return
  if (typeof format === 'number') throw new StateFormatError(format, String(format))
  throw new StateFormatError(null, '형식 번호 없음')
}
