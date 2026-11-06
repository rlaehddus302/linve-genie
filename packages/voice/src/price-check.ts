// 확정 아닌 조각 (DOMAIN_RULES R-17 8, D-V3-112·113): 번호와 가격은 짝지었지만 바로 등록·바로 고치지 않고 카드·묻기로 보낼 까닭과 안내 글.
// 순수 함수: 시계·난수를 쓰지 않고 어떤 입력에도 예외를 던지지 않는다.
import { formatWon, parseKoreanNumber, type PriceUnit } from '@livejjim/core'
import { listWonLines, punctuatedTokens, tokenize } from './extract.ts'

/** 크게 바뀜 선 (R-25 — register.ts AUTO_REGISTER_PRICE_MAX와 같은 값, 서로 불러오지 않게 따로 둔다) */
const BIG_PRICE = 3_000_000

/**
 * 확정 아닌 까닭 (화면은 이 조각을 바로 등록하지 않는다 — 없는 번호면 제안 카드, 있는 번호면 R-22 묻기)
 * - SMALL_QUICK: 천원 단위 방송의 원 없는 빠른 꼴 수가 1~2자리 (D-V3-112) — 카드 가격 칸 = 읽은 값
 * - NUMBER_IN_PRICE: 번호 숫자가 만 계수 앞에 붙은 300만 원 넘는 가격 (D-V3-113) — 카드 가격 칸 비움
 * - PRICE_AS_NUMBER: 번호가 같은 조각 가격의 만·천 계수와 같고 앞 번호 흐름에서 멀다 (D-V3-125 — "18번입니다 18만원"이 291번) — 카드 가격 칸 = 읽은 값
 */
export interface SegmentCheck {
  readonly kind: 'SMALL_QUICK' | 'NUMBER_IN_PRICE' | 'PRICE_AS_NUMBER'
  /** 카드·묻기에 보일 안내 글 */
  readonly note: string
}

/** 천원 단위 작은 빠른 꼴 안내 (D-V3-112): "17,000원으로 들렸어요. 가격을 확인해 주세요" */
export const smallQuickNote = (price: number): string => `${formatWon(price)}으로 들렸어요. 가격을 확인해 주세요`

/**
 * D-V3-112: 빠른 꼴 수 토큰(판매 말투 뗀 것)이 천원 단위에서 1~2자리 수인가.
 * 수 = 숫자(쉼표·소수점 꼴 포함, 정수부를 본다) 또는 `천`·`만` 없는 한글 수의 R-15 값. 단위 낱말이 붙은 말(`6만`·`5천`)은 아니다.
 */
export function isSmallQuickNumber(numberToken: string, unit: PriceUnit): boolean {
  if (unit !== 'THOUSAND') return false
  if (/^[0-9][0-9,]*(\.[0-9]+)?$/.test(numberToken)) {
    const whole = (numberToken.split('.')[0] as string).split(',').join('')
    const value = Number(whole)
    return Number.isSafeInteger(value) && value >= 0 && value <= 99
  }
  if (/^[일이삼사오육칠팔구십백]+$/.test(numberToken)) {
    const value = parseKoreanNumber(numberToken)
    return value !== null && value >= 0 && value <= 99
  }
  return false
}

/**
 * D-V3-113 번호가 붙은 가격: 원 가격 줄 글(토큰을 공백 없이 이은 것)의 만 계수가 숫자이고, 번호 no의 숫자로 시작하면서 더 길고,
 * 읽은 값이 3,000,000원을 넘으면 안내 글, 아니면 null. 한글 계수(`이천이백칠십오만`)는 보지 않는다.
 * 안내: "2275만 원으로 들렸어요. 227번 5만 원인지 확인해 주세요" (뒤 가격 = 만 계수에서 번호 숫자를 뗀 나머지 + 만 — 안내 글뿐)
 * D-LIVETEST-14: 번호와 자릿수가 같고 끝자리가 0이 아닌 계수(`369만` 371번)도 "369만 원으로 들렸어요. 371번 가격을 확인해 주세요"
 */
export function numberInPriceNote(no: number, lineTokens: readonly string[], value: number | null): string | null {
  if (value === null || !Number.isSafeInteger(value) || value <= BIG_PRICE) return null
  if (!Number.isSafeInteger(no) || no < 1) return null
  const joined = lineTokens.join('')
  const match = /^([0-9][0-9,]*)만/.exec(joined)
  if (match === null) return null
  const coefficient = (match[1] as string).split(',').join('')
  const head = String(no)
  if (!/^[0-9]+$/.test(coefficient)) return null
  const restOfLine = value - Number(coefficient) * 10_000
  const heard = restOfLine > 0 && Number.isSafeInteger(restOfLine) ? `${coefficient}만 ${formatWon(restOfLine)}` : `${coefficient}만 원`
  if (coefficient.length <= head.length || !coefficient.startsWith(head)) {
    // D-LIVETEST-14: 번호와 자릿수가 같고 끝자리까지 말한 만 계수(`369만` 371번 ← "삼육구 만원")는 다른 번호가 붙어 적힌 흔적.
    // 끝자리 0(`350만`)·자릿수가 다른 계수(38번 `605만`)는 분명히 들은 큰 가격으로 둔다 (D-V3-64)
    return coefficient.length !== head.length || coefficient.endsWith('0') ? null : `${heard}으로 들렸어요. ${head}번 가격을 확인해 주세요`
  }
  const left = Number(coefficient.slice(head.length))
  // 나머지가 0이면(`2270만` ← 227) 뒤 가격을 지어내지 않는다 — 가격만 확인해 달라고 한다
  if (left === 0) return `${heard}으로 들렸어요. ${head}번 가격을 확인해 주세요`
  return `${heard}으로 들렸어요. ${head}번 ${String(left)}만 원인지 확인해 주세요`
}

/**
 * 다른 덩어리에서 짝지은 번호와 가격 (D-V3-114 (3)): 기다리는 번호가 다음 덩어리의 원 가격을 이어 받을 때(D-V3-67),
 * 번호 없는 가격 기억이 뒤 'N번'과 짝지어질 때(D-V3-84 (ㄴ)). 가격을 들은 글(priceText)에서 그 값의 원 가격 줄을 찾아
 * 번호가 붙은 가격(D-V3-113)이면 안내 글, 아니면 null. 어떤 입력에도 예외를 던지지 않는다.
 */
export function numberInPriceOf(no: number, priceText: unknown, price: number, options: { readonly maxNumber?: number } = {}): string | null {
  try {
    const tokens = tokenize(priceText)
    if (tokens === null || tokens.length === 0) return null
    const lines = listWonLines(tokens, { punct: punctuatedTokens(priceText), ...(options.maxNumber === undefined ? {} : { maxNumber: options.maxNumber }) })
    for (const line of lines) {
      if (line.value !== price) continue
      const note = numberInPriceNote(no, tokens.slice(line.start, line.end + 1), line.value)
      if (note !== null) return note
    }
    return null
  } catch {
    return null
  }
}

/**
 * 번호가 가격의 만·천 계수와 같은가 (D-V3-125, 실방송 2026-11-06 291번: 가격 "열여덟"을 인식기가 "18번입니다 18만원"으로 적음).
 * 이것만으로는 막지 않는다 — 앞 번호 흐름에서 멀 때만 화면이 카드로 돌린다.
 */
export function priceEchoesNumber(no: number, price: number): boolean {
  if (!Number.isSafeInteger(no) || !Number.isSafeInteger(price) || no < 1 || price <= 0) return false
  return (price % 10_000 === 0 && price / 10_000 === no) || (price % 1_000 === 0 && price / 1_000 === no)
}

/** 번호·가격 계수 같음 안내 (D-V3-125): "18만 원의 18이 번호로 들렸을 수 있어요. 번호를 확인해 주세요" */
export const priceAsNumberNote = (no: number, price: number): string => `${formatWon(price)}의 ${String(no)}이 번호로 들렸을 수 있어요. 번호를 확인해 주세요`
