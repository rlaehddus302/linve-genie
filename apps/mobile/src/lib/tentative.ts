// 확인 중(임시 등록) 상품 — 서버 값을 화면 낱말로 바꾸기만 한다 (docs/retro/tentative-contract.md 3절, D-RETRO-80~83).
// 화면 일꾼이 번호·가격을 확신하지 못했거나, 다른 계정의 손 등록이 기다리는 찜이 있는 번호로 들어오면 상품이 "확인 중"으로 온다(상태는 공개 전).
// 그동안 손님 찜은 기다리고 감사 채팅·라벨은 나가지 않는다 — 판매자가 확정하면 그때의 값으로 정해진다.
// 앱은 판정하지 않는다: 확정(product.confirm)·거두기(product.withdraw)를 보낼 뿐이다. 까닭 낱말(영문)·상태값은 화면에 그대로 내지 않는다(절대 규칙 6).
import type { Product } from '@livejjim/web/src/api/types.ts'
import { productKey } from './derive.ts'
import type { ScopeData } from './scope-data.ts'

export type Tentative = NonNullable<Product['tentative']>

/** 상품 줄·카드의 꼬리표 */
export const TENTATIVE_TAG = '확인 중'
/** 모르는 까닭 낱말(일꾼이 새로 더한 것)은 이 문장으로 */
export const REASON_UNKNOWN = '확인이 필요해요'
export const REASON_OTHER_ACCOUNT = '다른 계정에서 넣은 상품이에요'

/** 까닭 낱말 → 쉬운 문장 (계약서 1절 표) */
export const REASON_WORDS: Readonly<Record<string, string>> = {
  NUMBER_SINGLE_SOURCE: '번호를 한 번만 확인했어요',
  NUMBER_MISMATCH: '말한 번호와 번호표가 달라요',
  NUMBER_OUT_OF_RANGE: '오늘 번호와 많이 달라요',
  PRICE_SINGLE_SOURCE: '가격을 한 번만 확인했어요',
  /** 번호만 들려 가격 없이 올린 것 (D-RECOG-31) */
  PRICE_MISSING: '가격을 아직 못 들었어요',
  PRICE_DISAGREE: '가격이 두 가지로 들렸어요',
  PRICE_OUT_OF_RANGE: '가격이 평소와 많이 달라요',
  NAME_UNSURE: '품종을 확인해 주세요',
  OTHER_ACCOUNT: REASON_OTHER_ACCOUNT,
  PENDING_CLAIMS: '기다리는 손님이 있어요',
}

/** 한 줄에 먼저 보일 순서 — 값이 갈린 것(고를 것이 있는 것)이 앞, 근거가 하나뿐인 것이 뒤 */
const REASON_ORDER = ['NUMBER_MISMATCH', 'PRICE_DISAGREE', 'OTHER_ACCOUNT', 'NUMBER_OUT_OF_RANGE', 'PRICE_OUT_OF_RANGE', 'PRICE_MISSING', 'NUMBER_SINGLE_SOURCE', 'PRICE_SINGLE_SOURCE', 'NAME_UNSURE'] as const
/** 한 줄에 보이는 까닭 수 */
const REASON_SHOWN = 2

/** 확인 중인 상품인가 — 표시가 있고 아직 공개 전일 때만 */
export function isTentative(product: Pick<Product, 'status' | 'tentative'> | undefined): product is Pick<Product, 'status'> & { readonly tentative: Tentative } {
  return product !== undefined && product.tentative !== undefined && product.status === 'READY'
}

/**
 * 까닭 한 줄: 아는 낱말을 쉬운 문장으로, 둘까지 " · "로. 기다리는 찜은 수로 따로 보이므로 다른 까닭이 있으면 뺀다.
 * 모르는 낱말뿐이면 "확인이 필요해요". 다른 계정에서 온 것은 낱말이 없어도 그렇게 적는다
 */
export function reasonLine(tentative: Pick<Tentative, 'by' | 'reasons'>): string {
  const has = new Set(tentative.reasons)
  const lines: string[] = REASON_ORDER.filter((word) => has.has(word)).map((word) => REASON_WORDS[word] ?? REASON_UNKNOWN)
  if (tentative.by === 'SYNC' && !has.has('OTHER_ACCOUNT')) lines.unshift(REASON_OTHER_ACCOUNT)
  if (lines.length === 0) return has.has('PENDING_CLAIMS') && tentative.reasons.length === 1 ? (REASON_WORDS.PENDING_CLAIMS ?? REASON_UNKNOWN) : REASON_UNKNOWN
  return lines.slice(0, REASON_SHOWN).join(' · ')
}

/** 고를 수 있는 다른 후보 수 (지금 값 말고) — 단추가 한 줄에 놓이게 셋까지 */
const OTHERS_MAX = 3

function others(candidates: readonly number[], current: number, least: number): number[] {
  const out: number[] = []
  for (const value of candidates) {
    if (!Number.isSafeInteger(value) || value < least || value === current || out.includes(value)) continue
    out.push(value)
    if (out.length === OTHERS_MAX) break
  }
  return out
}

/** 지금 번호가 아닌 번호 후보 (서버가 준 순서대로) */
export function otherNumbers(product: Pick<Product, 'no' | 'tentative'>): number[] {
  return others(product.tentative?.candidates.no ?? [], product.no, 1)
}

/** 지금 가격이 아닌 금액 후보 (정수 원, 서버가 준 순서대로). 가격이 비었으면 후보 전부 */
export function otherPrices(product: Pick<Product, 'price' | 'tentative'>): number[] {
  return others(product.tentative?.candidates.price ?? [], product.price ?? -1, 0)
}

/** 아직 가격이 없는 상품인가 (화면 일꾼이 "N번"만 듣고 올림 — D-RECOG-22). 가격을 적어야 확정할 수 있다 */
export function needsPrice(product: Pick<Product, 'price'>): boolean {
  return product.price === null
}

/** 그 번호로 기다리는 찜 수 (서버가 준 보류 찜 자리 그대로 — 앱은 세기만 한다) */
export function waitingAt(data: Pick<ScopeData, 'pending'>, b: string, no: number): number {
  return data.pending.get(productKey(b, no))?.claims.length ?? 0
}

export const waitingWords = (count: number): string => `기다리는 찜 ${String(count)}건`

/** 그 방송의 확인 중 상품 — 먼저 올라온 것부터 (가장 오래 기다린 손님이 있는 쪽) */
export function tentativeProducts(data: Pick<ScopeData, 'products'>, b: string): Product[] {
  const out: Product[] = []
  for (const product of data.products.values()) if (product.broadcast === b && isTentative(product)) out.push(product)
  return out.sort((x, y) => (x.tentative?.seq ?? 0) - (y.tentative?.seq ?? 0) || x.no - y.no)
}

/** 상품 줄(주황)의 낱말: 굵게 "확인 중" · 기다리는 찜 수 · 어떻게 하면 되는지 */
export function tentativeAttention(product: Pick<Product, 'status' | 'tentative'>, waiting: number): { readonly who: string; readonly what: string } | null {
  if (!isTentative(product)) return null
  return { who: TENTATIVE_TAG, what: waiting > 0 ? `· ${waitingWords(waiting)} · 눌러서 확정하기` : '· 눌러서 확정하기' }
}

/**
 * 한 번 탭 확정: 판매자가 카드에서 본 값 그대로 보낸다 — 번호를 옮기면 to, 가격·품종은 본 값을 늘 적는다
 * (그사이 일꾼이 값을 바꿨어도 판매자가 보고 누른 값으로 확정된다). 품종이 비어 있으면 적지 않는다(지금 값 그대로). pick.name = 카드에서 고른 품종 후보
 */
export function confirmEvent(product: Pick<Product, 'broadcast' | 'no' | 'name' | 'price'>, pick: { readonly no?: number; readonly price?: number; readonly name?: string } = {}): Readonly<Record<string, unknown>> {
  // 카드에서 품종 후보 단추를 눌렀으면 그 이름으로 (D-VARIETY-01)
  const name = (pick.name ?? product.name).trim()
  // 가격이 빈 상품은 고른 가격이 있을 때만 적는다 — 없으면 서버가 "가격을 먼저 적어 주세요"로 받지 않는다 (D-RECOG-22)
  const price = pick.price ?? product.price
  return {
    type: 'product.confirm',
    b: product.broadcast,
    no: product.no,
    ...(pick.no !== undefined && pick.no !== product.no ? { to: pick.no } : {}),
    ...(price === null ? {} : { price }),
    ...(name === '' ? {} : { name }),
  }
}

/** 거두기: 상품 기록만 없앤다 — 그 번호로 기다리는 찜은 그대로 남는다 (판매 종료와 다르다) */
export function withdrawEvent(product: Pick<Product, 'broadcast' | 'no'>): Readonly<Record<string, unknown>> {
  return { type: 'product.withdraw', b: product.broadcast, no: product.no }
}

/** 지금 품종이 아닌 품종 후보 (일꾼이 들은 이름, 서버가 준 순서대로) — 카드·수정창의 품종 단추 맨 앞 (D-VARIETY-01) */
export function otherNames(product: Pick<Product, 'name' | 'tentative'>): string[] {
  const current = product.name.trim()
  const out: string[] = []
  for (const name of product.tentative?.candidates.name ?? []) {
    const value = name.trim()
    if (value === '' || value === current || out.includes(value)) continue
    out.push(value)
  }
  return out
}
