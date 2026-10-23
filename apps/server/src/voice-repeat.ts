// 여러 기기의 같은 음성 문자찜 쓰기를 한 번만 기록하기 (V1, SPEC ORD-08 AC9 "여러 기기에서 함께 들을 때", D-V1-13, AC-V1-14).
// - 판정이 아니다: 기록 전에 "같은 범위에서 방금 기록한 음성 쓰기와 같은 말인지"만 본다(엔진 이벤트·판정은 그대로).
// - 범위(판매자·날짜·리허설 여부)마다 최근에 기록한 음성 쓰기(주문 = 번호·옵션·수량, 구매자 말 = last4·buyer·newBuyer·메모, 서버 도착 시각)를
//   메모리에 10초 둔다. 서버를 다시 켜면 비어도 된다(D-V1-13).
// - 검사와 등록은 그 범위의 기록 줄(serial) 안에서 한다 — 두 기기가 거의 함께 보내도 뒤 요청은 앞 요청의 등록을 본다.
// - 뒤 4자리·이름은 서명 글에만 쓰고 로그에 남기지 않는다(DAT-06, D-V1-10).

/** 같은 말로 보는 도착 시각 차 (ms, 경계 포함) */
export const VOICE_REPEAT_WINDOW_MS = 10_000

export const VOICE_REPEATED_MESSAGE = '같은 말을 다른 기기에서 방금 넣었어요.'

interface Entry {
  readonly signature: string
  readonly arrivedAt: number
  readonly requestId: string
}

/** 주문·구매자 말의 서명 (없음은 null — 없음끼리 같다). 메모는 앞뒤 공백을 뺀 값(엔진이 표시 이름에 쓰는 값)으로 비교한다 */
export function voiceSignature(body: Readonly<Record<string, unknown>>): string {
  const pick = (key: string): unknown => (Object.hasOwn(body, key) ? body[key] : undefined)
  const memo = pick('memo')
  return JSON.stringify([
    pick('b') ?? null,
    pick('no') ?? null,
    pick('options') ?? null,
    pick('qty') ?? null,
    pick('last4') ?? null,
    pick('buyer') ?? null,
    pick('newBuyer') ?? null,
    typeof memo === 'string' ? (memo.trim() === '' ? null : memo.trim()) : (memo ?? null),
  ])
}

export class VoiceRepeats {
  readonly #byScope = new Map<string, Entry[]>()

  /** 지난 등록 중 같은 서명이고 도착 시각 차가 10,000ms 이하인 다른 요청 번호가 있는지 */
  repeated(scope: string, signature: string, arrivedAt: number, requestId: string): boolean {
    const entries = this.#prune(scope, arrivedAt)
    return entries.some((entry) => entry.signature === signature && entry.requestId !== requestId && Math.abs(arrivedAt - entry.arrivedAt) <= VOICE_REPEAT_WINDOW_MS)
  }

  /** 기록한 음성 쓰기를 둔다 (기록 트랜잭션 안에서) */
  remember(scope: string, signature: string, arrivedAt: number, requestId: string): void {
    for (const key of [...this.#byScope.keys()]) if (key !== scope) this.#prune(key, arrivedAt)
    const entries = this.#prune(scope, arrivedAt)
    entries.push({ signature, arrivedAt, requestId })
    this.#byScope.set(scope, entries)
  }

  /** 등록했지만 기록이 끝내 되지 않았으면(커밋 실패) 뺀다 */
  forget(scope: string, requestId: string): void {
    const entries = this.#byScope.get(scope)
    if (entries === undefined) return
    const left = entries.filter((entry) => entry.requestId !== requestId)
    if (left.length === 0) this.#byScope.delete(scope)
    else this.#byScope.set(scope, left)
  }

  /** 시험·점검용: 남아 있는 범위 수 */
  get size(): number {
    return this.#byScope.size
  }

  /** 10초보다 오래된 것은 버린다 (도착 시각은 서버 시계라 거의 늘기만 한다 — 줄어든 시계에도 차의 절댓값으로 본다) */
  #prune(scope: string, now: number): Entry[] {
    const entries = (this.#byScope.get(scope) ?? []).filter((entry) => Math.abs(now - entry.arrivedAt) <= VOICE_REPEAT_WINDOW_MS)
    if (entries.length === 0) this.#byScope.delete(scope)
    else this.#byScope.set(scope, entries)
    return entries
  }
}
