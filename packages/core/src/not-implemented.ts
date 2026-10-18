/**
 * 코어가 "아직 구현하지 않은 기능"을 알리는 유일한 방법 (D-020, README "결과 상태").
 *
 * - 구현 전 함수는 이 오류를 던진다. 골든 러너는 이 오류만 "미구현"으로 세고,
 *   그 밖의 예외는 모두 "러너 오류"로 센다.
 * - 판별은 `isNotImplemented`로 한다. 메시지·이름 문자열로 판별하지 않는다.
 */
export class NotImplementedError extends Error {
  /** 구현하지 않은 기능 이름 (보고용) */
  readonly feature: string

  constructor(feature: string) {
    super(`아직 구현하지 않은 기능: ${feature}`)
    this.name = 'NotImplementedError'
    this.feature = feature
  }
}

export function isNotImplemented(error: unknown): error is NotImplementedError {
  return error instanceof NotImplementedError
}
