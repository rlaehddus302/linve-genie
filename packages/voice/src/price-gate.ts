// 같은 번호 가격 고침의 문턱 (실방송 V3 333번: 35만 원으로 등록 → "333번 … 33만 원"(35를 33으로 잘못 들음) → 33만으로 고침 → "30만 원" → 30만으로 고침).
// 음성으로 들은 다른 가격은 (가) 정정 낱말이 있거나 (나) 같은 새 가격이 서로 다른 조각에서 60초 안에 두 번 들렸을 때만 바로 고친다.
// 아니면 지금 가격을 두고 "고침 후보"로만 남긴다. 지금 가격이 다시 들리면 후보를 지운다.
// 순수 함수: 시계를 읽지 않고(now를 받는다) 넘긴 값을 바꾸지 않는다.

/** 같은 새 가격을 두 번 들어야 하는 시간 (밀리초) */
export const PRICE_GATE_MS = 60_000

/** 한 번호에서 들은 다른 가격 (조각마다 하나) */
export interface HeardPrice {
  readonly price: number
  /** 들은 조각 (같은 조각을 다시 읽은 것은 한 번) */
  readonly fragment: string
  readonly at: number
}

export interface PriceGateInput {
  /** 지금 상품 가격 */
  readonly current: number
  /** 이번에 들은 가격 */
  readonly price: number
  /** 이번 조각 */
  readonly fragment: string
  /** 정정 낱말(아니·말고·아니고·정정·다시·잘못)이 이 조각에 있는가 */
  readonly correction: boolean
  /** 이 번호에서 전에 들은 다른 가격 */
  readonly history: readonly HeardPrice[]
  readonly now: number
}

export interface PriceGateResult {
  /** 바로 고친다(true) · 고침 후보로만(false) */
  readonly apply: boolean
  /** 다음 기록 (고치면 비움) */
  readonly history: readonly HeardPrice[]
}

/** 정정 낱말 (가격 고침 문턱을 넘는 말) */
export const PRICE_GATE_WORDS: readonly string[] = Object.freeze(['아니', '아니고', '아니요', '아니에요', '말고', '정정', '다시', '잘못', '잘못했어요', '잘못 말했어요'])

/** 글에 정정 낱말이 있는가 (토큰 그대로 · `…말고`로 끝나는 토큰) */
export function hasPriceCorrection(text: unknown): boolean {
  if (typeof text !== 'string') return false
  return text.split(/\s+/).some((token) => PRICE_GATE_WORDS.includes(token) || token.endsWith('말고') || token.startsWith('잘못') || token.startsWith('정정'))
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)

/**
 * 같은 번호 가격 고침 문턱. 가격이 같으면 후보를 지우고 apply 거짓(고칠 것 없음).
 * 정정 낱말이 있으면 바로. 60초 안 다른 조각에서 같은 새 가격을 들은 적이 있으면 바로. 아니면 후보로 적고 apply 거짓.
 */
export function gateSamePrice(input: PriceGateInput): PriceGateResult {
  try {
    const now = input.now
    const history = (Array.isArray(input.history) ? input.history : []).filter((item) => isInt(item.price) && Number.isFinite(item.at) && now - item.at <= PRICE_GATE_MS && now >= item.at)
    if (!isInt(input.price) || !isInt(input.current)) return { apply: false, history }
    if (input.price === input.current) return { apply: false, history: [] }
    if (input.correction) return { apply: true, history: [] }
    if (history.some((item) => item.price === input.price && item.fragment !== input.fragment)) return { apply: true, history: [] }
    const kept = history.filter((item) => !(item.fragment === input.fragment && item.price === input.price))
    return { apply: false, history: [...kept, { price: input.price, fragment: input.fragment, at: now }].slice(-10) }
  } catch {
    return { apply: false, history: [] }
  }
}
