// 빠진 0 되살리기 (실방송 V3 306번): 크롬이 "삼백육번"을 "36번"으로, "삼백팔번"을 "38번"으로 적는 일이 있다.
// 두 자리 번호 XY를 같은 백 자리 X0Y로 읽을 증거가 뚜렷할 때만 X0Y로 바꾼다. 순수 함수: 넘긴 값만 보고 바꾸지 않는다.

/** 앞 번호와 붙어 있다고 보는 거리 (±20) */
export const DROPPED_ZERO_NEAR = 20

/** 맥락으로 볼 최근 음성 등록 수 (가장 최근 것부터 이만큼이 모두 X0Y 근처여야 한다) */
export const DROPPED_ZERO_RECENT = 2

/** 그 번호의 지금 상품 (없으면 null, 판매 종료면 'closed') */
export type DroppedZeroProduct = { readonly price: number } | 'closed' | null

export interface DroppedZeroInput {
  /** 들린 번호 */
  readonly no: number
  /** 같이 들린 가격 (원) */
  readonly price: number | null
  /** 이 방송에서 음성으로 새로 등록한 번호 — 오래된 것부터 (최근 것이 뒤) */
  readonly recent: readonly number[]
  /** 바로 앞에 들린 번호 — 같은 말의 중간 결과에 보인 번호, 가격을 기다리는 번호 */
  readonly heardBefore?: readonly number[]
  /** 번호의 지금 상품 */
  readonly product: (no: number) => DroppedZeroProduct
  /** 번호 상한 (생략 = 999) */
  readonly maxNumber?: number
}

export interface DroppedZeroFix {
  /** 바꿔 쓸 번호 (X0Y) */
  readonly no: number
  /** 증거: 중간 결과·기다리는 번호에 X0Y가 보임(HEARD) · 최근 등록이 모두 X0Y 근처(RECENT) */
  readonly why: 'HEARD' | 'RECENT'
}

const isNo = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

/**
 * 두 자리 번호 XY(X·Y 1~9)를 X0Y로 바꿀지 (바꾸지 않으면 null).
 * 1. XY 자체가 상품으로 있으면(판매 종료 포함) 바꾸지 않는다 — 실제로 있는 번호다.
 * 2. X0Y가 판매 종료이거나, 이미 있는데 가격이 다르거나 가격을 못 들었으면 바꾸지 않는다(같은 가격이면 바꾼다 — 같은 번호 무시 규칙이 받는다).
 * 3. 증거 둘 중 하나:
 *    HEARD — 바로 앞에 들린 번호(중간 결과·기다리는 번호)에 X0Y가 있다.
 *    RECENT — 최근 음성 등록 2개 이상이 있고, 가장 최근 2개가 모두 X0Y ±20 안이며, 최근 등록 어느 것도 XY ±20 안이 아니다.
 */
export function fixDroppedZero(input: DroppedZeroInput): DroppedZeroFix | null {
  try {
    const { no } = input
    if (!isNo(no) || no < 11 || no > 99) return null
    const tens = Math.floor(no / 10)
    const ones = no % 10
    if (ones === 0) return null
    const fixed = tens * 100 + ones
    const max = isNo(input.maxNumber) ? input.maxNumber : 999
    if (fixed > max) return null
    if (input.product(no) !== null) return null
    const there = input.product(fixed)
    if (there === 'closed') return null
    if (there !== null && (input.price === null || there.price !== input.price)) return null
    const heard = Array.isArray(input.heardBefore) ? input.heardBefore.filter(isNo) : []
    if (heard.includes(fixed)) return { no: fixed, why: 'HEARD' }
    const recent = Array.isArray(input.recent) ? input.recent.filter(isNo) : []
    if (recent.length < DROPPED_ZERO_RECENT) return null
    const last = recent.slice(-DROPPED_ZERO_RECENT)
    if (!last.every((item) => Math.abs(item - fixed) <= DROPPED_ZERO_NEAR)) return null
    if (recent.some((item) => Math.abs(item - no) <= DROPPED_ZERO_NEAR)) return null
    return { no: fixed, why: 'RECENT' }
  } catch {
    return null
  }
}

/**
 * 겹친 자리 걷어 내기 (D-V3-123, 실방송 2026-11-06 "57번을 오오십칠번 뭐 이렇게 알아들었는지 557번으로"): 세 자리 AAB… 꼴(첫 두 자리가 같음 —
 * "오 오십칠" → 557)을 두 자리 AB로 바꿀지 (바꾸지 않으면 null). 빠진 0 되살리기(fixDroppedZero)를 거꾸로 한 것이라 조건도 같다.
 * 1. 들린 세 자리 번호 자체가 상품으로 있으면(판매 종료 포함) 바꾸지 않는다.
 * 2. 두 자리 번호가 판매 종료이거나, 이미 있는데 가격이 다르거나 가격을 못 들었으면 바꾸지 않는다(같은 가격이면 바꾼다 — 같은 번호 무시 규칙이 받는다).
 * 3. 증거 HEARD(바로 앞에 들린 번호에 두 자리 번호) 또는 RECENT(최근 2개가 모두 두 자리 번호 ±20 안이고 어느 것도 세 자리 번호 ±20 안이 아님).
 */
export function fixDoubledDigit(input: DroppedZeroInput): DroppedZeroFix | null {
  try {
    const { no } = input
    if (!isNo(no) || no < 110 || no > 999) return null
    const hundreds = Math.floor(no / 100)
    const tens = Math.floor(no / 10) % 10
    if (hundreds !== tens) return null
    const fixed = no % 100
    if (fixed < 10) return null
    if (input.product(no) !== null) return null
    const there = input.product(fixed)
    if (there === 'closed') return null
    if (there !== null && (input.price === null || there.price !== input.price)) return null
    const heard = Array.isArray(input.heardBefore) ? input.heardBefore.filter(isNo) : []
    if (heard.includes(fixed)) return { no: fixed, why: 'HEARD' }
    const recent = Array.isArray(input.recent) ? input.recent.filter(isNo) : []
    if (recent.length < DROPPED_ZERO_RECENT) return null
    const last = recent.slice(-DROPPED_ZERO_RECENT)
    if (!last.every((item) => Math.abs(item - fixed) <= DROPPED_ZERO_NEAR)) return null
    if (recent.some((item) => Math.abs(item - no) <= DROPPED_ZERO_NEAR)) return null
    return { no: fixed, why: 'RECENT' }
  } catch {
    return null
  }
}

/**
 * '번' 없는 번호가 앞 번호 흐름에 맞는가 (실방송 V3: 312…349를 팔다 "얼마 드릴까 50 … 10만 원" → 50번, "너무예쁜데 25 자 25만 원" → 25번).
 * 최근 음성 등록 2개 이상이 있고 가장 최근 2개가 모두 그 번호에서 ±20 밖이면 맞지 않는다(false). 맥락이 모자라면 맞는다고 본다(true — 지금 규칙 그대로).
 */
export function bareNumberFits(no: number, recent: readonly number[]): boolean {
  try {
    if (!isNo(no)) return false
    const list = Array.isArray(recent) ? recent.filter(isNo) : []
    if (list.length < DROPPED_ZERO_RECENT) return true
    return list.slice(-DROPPED_ZERO_RECENT).some((item) => Math.abs(item - no) <= DROPPED_ZERO_NEAR)
  } catch {
    return true
  }
}
