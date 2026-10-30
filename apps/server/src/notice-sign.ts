// KP1 SA-KP1-003: 공개 양식의 처리 결과 한 줄(303 뒤 주소 질의)을 짧은 수명 서명 값으로 묶는다.
// 주소 질의만 지어 열어서는 "신청했어요"·"지웠어요" 같은 문장이 보이지 않게 한다.
// 키는 프로세스마다 새로 만든다(서버를 다시 켜면 그 전 값은 문장 없이 열린다 — 결과는 바뀌지 않는다). 값은 로그에 남기지 않는다.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Clock } from './time.ts'

/** 서명 값 수명 (10분 — 분 단위로 올려 같은 분의 응답은 같은 값) */
export const NOTICE_TTL_MS = 10 * 60 * 1000
const MINUTE = 60_000
const VALUE_RE = /^(\d{1,16})\.([A-Za-z0-9_-]{22})$/

export class NoticeSigner {
  readonly #key = randomBytes(32)
  readonly #clock: Clock

  constructor(clock: Clock) {
    this.#clock = clock
  }

  #mac(scope: string, value: string, until: number): string {
    return createHmac('sha256', this.#key).update(JSON.stringify([scope, value, until])).digest('base64url').slice(0, 22)
  }

  /** scope(토큰 해시 등)·value(결과)에 묶인 서명 값 `<끝 시각>.<서명>` */
  sign(scope: string, value: string): string {
    const until = Math.ceil((this.#clock.now() + NOTICE_TTL_MS) / MINUTE) * MINUTE
    return `${String(until)}.${this.#mac(scope, value, until)}`
  }

  /** 서명 값이 맞고 아직 살아 있는지 */
  check(scope: string, value: string, signed: string | undefined): boolean {
    if (signed === undefined) return false
    const match = VALUE_RE.exec(signed)
    if (match === null) return false
    const until = Number(match[1])
    if (!Number.isSafeInteger(until) || until < this.#clock.now()) return false
    const want = Buffer.from(this.#mac(scope, value, until))
    const got = Buffer.from(match[2] as string)
    return want.length === got.length && timingSafeEqual(want, got)
  }
}
