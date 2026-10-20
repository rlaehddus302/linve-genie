// 범위 조회 결과에서 화면에 보일 값 고르기 (AC-S05-14·21·30). 판정은 하지 않는다 — 코어 조회 함수 결과를 고르고 낱말로 바꾸기만 한다.
import type { Buyer, Claim, Product } from '../api/types.ts'
import { kstTime } from './kst.ts'
import type { ScopeData } from './scope-data.ts'
import { claimStatusWord } from './words.ts'

/** 상품 키 `<방송>/<번호>` */
export const productKey = (b: string, no: number): string => `${b}/${String(no)}`

/** 상품 ID(`p1`부터 생성 순)의 순번 — 등록 순서 */
function productOrder(product: Product): number {
  const n = Number(product.id.replace(/^\D+/, ''))
  return Number.isFinite(n) ? n : 0
}

/** 그 방송의 상품, 가장 최근 등록 순 (AC-S05-14) */
export function boardProducts(data: ScopeData, b: string): Product[] {
  const out: Product[] = []
  for (const product of data.products.values()) if (product.broadcast === b) out.push(product)
  return out.sort((x, y) => productOrder(y) - productOrder(x))
}

/** 그 방송에서 가장 최근에 등록한 상품 */
export function latestProduct(data: ScopeData, b: string): Product | undefined {
  let best: Product | undefined
  for (const product of data.products.values()) {
    if (product.broadcast !== b) continue
    if (best === undefined || productOrder(product) > productOrder(best)) best = product
  }
  return best
}

/** 이름 앞뒤를 잇는 글자 (D-098) — 괄호를 더하지 않는다 */
export const NAME_JOIN = ' · '

/** 알 수 없는 구매자 */
export const UNKNOWN_BUYER_NAME = '알 수 없는 구매자'

/**
 * 그 문자 구매자 자신을 만든 문자찜의 받은 시각 "20:01:05" (분까지 적었으면 "20:01", KST).
 * 새 문자 구매자는 그 문자찜이 늘 찜 하나를 만든다 — 그 구매자 자신의 찜 중 가장 앞 seq의 문자찜이다.
 */
function smsCreatedTimes(buyers: ReadonlyMap<string, Buyer>, claims: ReadonlyMap<string, Claim>, wanted: ReadonlySet<string>): Map<string, string> {
  const first = new Map<string, Claim>()
  if (wanted.size === 0) return new Map()
  for (const claim of claims.values()) {
    if (claim.origin !== 'sms' || !wanted.has(claim.buyer)) continue
    const seen = first.get(claim.buyer)
    if (seen === undefined || claim.seq < seen.seq) first.set(claim.buyer, claim)
  }
  const out = new Map<string, string>()
  for (const id of wanted) {
    const claim = first.get(id)
    if (claim !== undefined && buyers.has(id)) out.set(id, receivedClock(claim))
  }
  return out
}

/** 찜의 받은 시각(시각만): 분까지 적었으면 "20:01", 아니면 "20:01:05" (KST) */
export function receivedClock(claim: Pick<Claim, 'rankTime' | 'rankMinute'>): string {
  const time = kstTime(claim.rankTime)
  return claim.rankMinute ? time.slice(0, 5) : time
}

/** 구분 글자 하나 (D-098): 유튜브 "끝 1234", 뒤 4자리가 있는 문자 구매자 "뒤 4자리 5678", 전화번호 없는 문자 구매자 "문자 20:01:05" */
function tagOf(buyer: Buyer, smsTimes: ReadonlyMap<string, string>): string {
  if (buyer.kind === 'youtube') return `끝 ${buyer.id.slice(-4)}`
  if (buyer.phoneLast4 !== null) return `뒤 4자리 ${buyer.phoneLast4}`
  const time = smsTimes.get(buyer.id)
  return time === undefined ? '문자' : `문자 ${time}`
}

/**
 * 구매자 이름 표기 하나 (BUY-01 AC2, AC-S06b-20, D-098) — 모든 화면이 이 이름을 쓴다.
 * - 그 범위의 지금의 구매자 중 같은 표시 이름이 하나뿐이면 표시 이름 그대로.
 * - 둘 이상이면 `표시 이름 · 구분 글자`(유튜브 "끝 1234", 문자 "뒤 4자리 5678", 전화번호 없는 문자 "문자 20:01:05").
 *   합쳐진 구매자도 같은 규칙이고 "같은 이름 수"는 지금의 구매자 기준.
 * - 그래도 같은 표기가 둘 이상이면 생긴 순서(범위 조회의 구매자 순서 = 처음 기록된 순서)로 둘째부터 " · 2", " · 3".
 *   구분 글자가 붙었든 아니든, 합쳐진 구매자든 아니든 그날 모든 구매자의 마지막 표기끼리 본다 — 두 구매자가 한 이름으로 보이면
 *   엉뚱한 쪽과 합치거나 입금을 적거나 떼어 낸다(D-098 이유, SA-S06b-002). 예: 지금의 "홍길동"과 김철수에 합쳐진 "홍길동",
 *   구분 글자를 흉내 낸 닉네임 "홍길동 · 끝 1234"와 진짜 "홍길동 · 끝 1234".
 *   겹침은 화면에 보이는 모양으로 본다(sameLook) — 공백 여러 칸·보이지 않는 글자·호환 글자로만 다른 표기도 겹친 것이다.
 * 문자 구매자 ID·전화번호 원문은 넣지 않는다(AC-S06-80·81).
 */
export function buyerLabels(buyers: ReadonlyMap<string, Buyer>, claims: ReadonlyMap<string, Claim>): Map<string, string> {
  const counts = new Map<string, number>()
  for (const buyer of buyers.values()) if (buyer.mergedInto === null) counts.set(buyer.display, (counts.get(buyer.display) ?? 0) + 1)
  const tagged = (buyer: Buyer) => (counts.get(buyer.display) ?? 0) >= 2
  const wanted = new Set<string>()
  for (const buyer of buyers.values()) if (buyer.kind === 'sms' && buyer.phoneLast4 === null && tagged(buyer)) wanted.add(buyer.id)
  const smsTimes = smsCreatedTimes(buyers, claims, wanted)
  const labels = new Map<string, string>()
  /** 이미 정한 표기의 보이는 모양 */
  const taken = new Set<string>()
  /** 표기(보이는 모양)마다 다음에 붙여 볼 번호 */
  const nextNo = new Map<string, number>()
  for (const buyer of buyers.values()) {
    const base = tagged(buyer) ? `${buyer.display}${NAME_JOIN}${tagOf(buyer, smsTimes)}` : buyer.display
    const baseLook = sameLook(base)
    let label = base
    if (taken.has(baseLook)) {
      let n = nextNo.get(baseLook) ?? 2
      while (taken.has(sameLook(`${base}${NAME_JOIN}${String(n)}`))) n++
      nextNo.set(baseLook, n + 1)
      label = `${base}${NAME_JOIN}${String(n)}`
    }
    taken.add(sameLook(label))
    labels.set(buyer.id, label)
  }
  return labels
}

/**
 * 화면에서 같은 글자로 보이는지 견줄 모양: 호환 글자(NFKC)를 맞추고, 보이지 않는 글자(서식 글자 \p{Cf}, 빈칸으로 보이는
 * 한글 채움 문자 U+115F·U+1160·U+3164·U+FFA0)를 빼고, 공백 여러 칸을 한 칸으로(HTML은 한 칸으로 그린다).
 */
function sameLook(label: string): string {
  return label
    .normalize('NFKC')
    .replace(/[\p{Cf}ᅟᅠㅤﾠ]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** 구매자 이름 표기 (buyerLabels)를 ID로 찾는다 */
export class BuyerNames {
  readonly #labels: ReadonlyMap<string, string>
  readonly #counts = new Map<string, number>()
  readonly #buyers: ReadonlyMap<string, Buyer>
  constructor(buyers: ReadonlyMap<string, Buyer>, claims: ReadonlyMap<string, Claim>) {
    this.#buyers = buyers
    this.#labels = buyerLabels(buyers, claims)
    for (const buyer of buyers.values()) if (buyer.mergedInto === null) this.#counts.set(buyer.display, (this.#counts.get(buyer.display) ?? 0) + 1)
  }

  /** 구매자 ID → 이름 */
  name(id: string): string {
    return this.#labels.get(id) ?? UNKNOWN_BUYER_NAME
  }

  /** 그날 지금의 구매자 중 같은 표시 이름의 수 (목록의 "같은 닉네임 n명") */
  sameNameCount(id: string): number {
    const buyer = this.#buyers.get(id)
    return buyer === undefined ? 0 : (this.#counts.get(buyer.display) ?? 0)
  }
}

/** 대기 순번 (1부터, 대기 찜이 아니면 null) */
export function waitPosition(data: ScopeData, claim: Claim): number | null {
  if (claim.status !== 'WAITLISTED') return null
  const product = data.products.get(claim.product)
  if (product === undefined) return null
  const index = product.waitlistClaims.indexOf(claim.id)
  return index < 0 ? null : index + 1
}

/** 찜의 지금 상태 낱말 (1등 · 대기 n번 · 보류 · 충돌 · …) */
export function claimWord(data: ScopeData, claim: Claim): string {
  return claimStatusWord(claim.status, claim.reason, waitPosition(data, claim))
}

const requestIndexCache = new WeakMap<ScopeData['cancelRequests'], ReadonlyMap<string, number>>()

/** 상품의 취소 요청 수 */
export function cancelRequestCount(data: ScopeData, product: Product): number {
  let index = requestIndexCache.get(data.cancelRequests)
  if (index === undefined) {
    const map = new Map<string, number>()
    for (const request of data.cancelRequests.values()) map.set(request.product, (map.get(request.product) ?? 0) + 1)
    requestIndexCache.set(data.cancelRequests, map)
    index = map
  }
  return index.get(product.key) ?? 0
}

/** 알림 띠 (AC-S05-30): 충돌 · 취소 요청 · 승계 결정 필요 · 보류 찜 · 확인 필요 */
export interface AlertCounts {
  readonly conflict: number
  readonly cancelRequest: number
  readonly succession: number
  readonly pending: number
  readonly attention: number
}

export function alertCounts(data: ScopeData): AlertCounts {
  let conflict = 0
  let succession = 0
  for (const product of data.products.values()) {
    if (product.conflict) conflict++
    if (product.awaitingSuccession) succession++
  }
  let pending = 0
  for (const slot of data.pending.values()) if (!data.products.has(slot.product)) pending += slot.claims.length
  return { conflict, cancelRequest: data.cancelRequests.size, succession, pending, attention: data.attention.length }
}

/** 상품이 아직 없는 번호의 보류 찜 묶음 */
export function orphanPending(data: ScopeData): { product: string; broadcast: string; no: number; claims: Claim[] }[] {
  const out: { product: string; broadcast: string; no: number; claims: Claim[] }[] = []
  for (const slot of data.pending.values()) {
    if (data.products.has(slot.product)) continue
    const claims = slot.claims.map((id) => data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
    out.push({ product: slot.product, broadcast: slot.broadcast, no: slot.no, claims })
  }
  return out.sort((a, b) => a.no - b.no)
}

/** 금액 표시 — 코어 formatWon 모양 */
export { formatWon } from '@livejjim/core'
