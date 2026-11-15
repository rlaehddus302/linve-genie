// 범위 조회 결과에서 화면에 보일 값 고르기 (웹 lib/derive.ts와 같은 규칙, AC-S05-14·21·30). 판정은 하지 않는다 —
// 코어 조회 함수 결과(서버 응답)를 고르고 낱말로 바꾸기만 한다. 웹 모듈은 @livejjim/core 전체를 불러오므로 앱은 같은 규칙을 따로 들고
// 시험(test/derive-sync.test.ts)이 웹 결과와 같은지 본다.
import { displayNickname, productTitle } from '@livejjim/core/format'
import type { Buyer, Claim, Product } from '@livejjim/web/src/api/types.ts'
import { kstTime } from '@livejjim/web/src/lib/kst.ts'
import type { ScopeData } from './scope-data.ts'
import { claimStatusWord } from './words.ts'

/** 상품 키 `<방송>/<번호>` */
export const productKey = (b: string, no: number): string => `${b}/${String(no)}`

/** 상품 등록 차례 (클수록 나중에 올림) — 상품 ID 끝 숫자 */
export function productOrder(product: Pick<Product, 'id'>): number {
  const n = Number(product.id.replace(/^\D+/, ''))
  return Number.isFinite(n) ? n : 0
}

/** 그 방송의 상품, 가장 최근 등록 순 */
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

export const NAME_JOIN = ' · '
export const UNKNOWN_BUYER_NAME = '알 수 없는 구매자'

export function receivedClock(claim: Pick<Claim, 'rankTime' | 'rankMinute'>): string {
  const time = kstTime(claim.rankTime)
  return claim.rankMinute ? time.slice(0, 5) : time
}

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

function tagOf(buyer: Buyer, smsTimes: ReadonlyMap<string, string>): string {
  if (buyer.kind === 'youtube') return `끝 ${buyer.id.slice(-4)}`
  if (buyer.phoneLast4 !== null) return `뒤 4자리 ${buyer.phoneLast4}`
  const time = smsTimes.get(buyer.id)
  return time === undefined ? '문자' : `문자 ${time}`
}

function sameLook(label: string): string {
  return label
    .normalize('NFKC')
    .replace(/[\p{Cf}ᅟᅠㅤﾠ]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** 구매자 이름 표기 하나 (BUY-01 AC2, D-098) — 웹 buyerLabels와 같은 규칙 */
export function buyerLabels(buyers: ReadonlyMap<string, Buyer>, claims: ReadonlyMap<string, Claim>, hideSuffix = false): Map<string, string> {
  const display = (buyer: Buyer) => displayNickname(buyer.display, hideSuffix && buyer.kind === 'youtube')
  const counts = new Map<string, number>()
  for (const buyer of buyers.values()) if (buyer.mergedInto === null) counts.set(display(buyer), (counts.get(display(buyer)) ?? 0) + 1)
  const tagged = (buyer: Buyer) => (counts.get(display(buyer)) ?? 0) >= 2
  const wanted = new Set<string>()
  for (const buyer of buyers.values()) if (buyer.kind === 'sms' && buyer.phoneLast4 === null && tagged(buyer)) wanted.add(buyer.id)
  const smsTimes = smsCreatedTimes(buyers, claims, wanted)
  const labels = new Map<string, string>()
  const taken = new Set<string>()
  const nextNo = new Map<string, number>()
  for (const buyer of buyers.values()) {
    const showTag = tagged(buyer) && !(hideSuffix && buyer.kind === 'youtube' && display(buyer) !== buyer.display)
    const base = showTag ? `${display(buyer)}${NAME_JOIN}${tagOf(buyer, smsTimes)}` : display(buyer)
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

export class BuyerNames {
  readonly #labels: ReadonlyMap<string, string>
  readonly hideSuffix: boolean
  constructor(buyers: ReadonlyMap<string, Buyer>, claims: ReadonlyMap<string, Claim>, hideSuffix = false) {
    this.hideSuffix = hideSuffix
    this.#labels = buyerLabels(buyers, claims, hideSuffix)
  }
  name(id: string): string {
    return this.#labels.get(id) ?? UNKNOWN_BUYER_NAME
  }
}

export function variantOf(product: Product, claim: Pick<Claim, 'key' | 'variant'>): Product['variants'][number] | undefined {
  if (claim.variant === null) return undefined
  return product.variants.find((variant) => variant.key === claim.key)
}

/** 대기 순번 (1부터, 대기 찜이 아니면 null) */
export function waitPosition(data: ScopeData, claim: Claim): number | null {
  if (claim.status !== 'WAITLISTED') return null
  const product = data.products.get(claim.product)
  if (product === undefined) return null
  const list = claim.variant === null ? product.waitlistClaims : (variantOf(product, claim)?.waitlistClaims ?? [])
  const index = list.indexOf(claim.id)
  return index < 0 ? null : index + 1
}

/** 찜의 지금 상태 낱말 (1등 · 대기 n번 · 보류 · 충돌 · …) */
export function claimWord(data: ScopeData, claim: Claim): string {
  return claimStatusWord(claim.status, claim.reason, waitPosition(data, claim))
}

export interface ProductSlots {
  readonly winners: readonly string[]
  readonly winnerClaims: readonly string[]
  readonly waitlist: readonly string[]
  readonly waitlistClaims: readonly string[]
  readonly awaitingSuccession: boolean
  readonly conflict: boolean
}

/** 상품 단위로 모은 1등·대기·승계·충돌 (옵션 상품은 변형을 합친다, D-O1-01) */
export function productSlots(product: Product): ProductSlots {
  if (!product.hasOptions || product.variants.length === 0) return product
  return {
    winners: [...product.winners, ...product.variants.flatMap((variant) => variant.winners)],
    winnerClaims: [...product.winnerClaims, ...product.variants.flatMap((variant) => variant.winnerClaims)],
    waitlist: [...product.waitlist, ...product.variants.flatMap((variant) => variant.waitlist)],
    waitlistClaims: [...product.waitlistClaims, ...product.variants.flatMap((variant) => variant.waitlistClaims)],
    awaitingSuccession: product.awaitingSuccession || product.variants.some((variant) => variant.awaitingSuccession),
    conflict: product.conflict || product.variants.some((variant) => variant.conflict),
  }
}

export interface AlertCounts {
  readonly conflict: number
  readonly cancelRequest: number
  readonly succession: number
  readonly pending: number
  readonly attention: number
}

function unitCount(product: Product, pick: (unit: { readonly awaitingSuccession: boolean; readonly conflict: boolean }) => boolean): number {
  if (!product.hasOptions || product.variants.length === 0) return pick(product) ? 1 : 0
  return product.variants.filter(pick).length
}

/** 알림 수 (충돌·취소 요청·승계 결정 필요·보류 찜·확인 필요). 보류 찜은 상품이 아직 없는 번호의 것만 (웹 alertCounts, 시간은 보지 않는다) */
export function alertCounts(data: ScopeData): AlertCounts {
  let conflict = 0
  let succession = 0
  for (const product of data.products.values()) {
    conflict += unitCount(product, (unit) => unit.conflict)
    succession += unitCount(product, (unit) => unit.awaitingSuccession)
  }
  let pending = 0
  for (const slot of data.pending.values()) if (!data.products.has(slot.product)) pending += slot.claims.length
  return { conflict, cancelRequest: data.cancelRequests.size, succession, pending, attention: data.attention.length }
}

/** 상품 이름 (빈 품종은 "품종 미입력") */
/** 상품의 품종 글: 비었으면 "품종 미입력", 개수가 2 이상이면 뒤에 "3개" (D-PIECES-01) */
export const nameOf = (product: Pick<Product, 'name' | 'pieces'>): string => productTitle(product.name.trim() === '' ? '품종 미입력' : product.name, product.pieces)

/** 그 상품의 찜(1등·대기·보류·충돌…) — 상태 순서: 1등 → 충돌 → 대기 순번 → 보류 → 그 밖, 같은 묶음 안은 seq 순 */
export function claimsOfProduct(data: ScopeData, product: Product): Claim[] {
  const rank = (claim: Claim): number => {
    if (claim.status === 'CONFIRMED') return 0
    if (claim.status === 'CONFLICT') return 1
    if (claim.status === 'WAITLISTED') return 2
    if (claim.status === 'PENDING') return 3
    return 4
  }
  const out: Claim[] = []
  for (const claim of data.claims.values()) if (claim.product === product.key) out.push(claim)
  return out.sort((a, b) => rank(a) - rank(b) || (waitPosition(data, a) ?? 0) - (waitPosition(data, b) ?? 0) || a.seq - b.seq)
}

// ── 방송 중 정하기 (웹 lib/derive.ts와 같은 규칙 — 충돌·승계는 상품 → 변형 순서, D-O1-01·02, D-APPX-03) ──

/** 찜 조치 이벤트에 붙일 변형 (옵션을 가진 찜만 — R-19 "찜을 가리키는 방송자 조치") */
export function claimOptionsField(claim: Pick<Claim, 'options'>): { readonly options?: Readonly<Record<string, string>> } {
  if (claim.options === null || claim.options.length === 0) return {}
  return { options: Object.fromEntries(claim.options.map(([name, label]) => [name, label])) }
}

/** 변형을 가리키는 방송자 조치의 options 칸 (변형이 없으면 빈 객체) */
export function variantOptionsField(variant: Product['variants'][number] | undefined): { readonly options?: Readonly<Record<string, string>> } {
  if (variant === undefined || variant.options.length === 0) return {}
  return { options: Object.fromEntries(variant.options.map(([name, label]) => [name, label])) }
}

/** 정할 단위: 상품 하나 또는 그 변형 하나 */
export interface DecisionUnit {
  readonly product: Product
  readonly variant: Product['variants'][number] | undefined
  readonly winnerClaims: readonly string[]
  readonly waitlistClaims: readonly string[]
  readonly waitlist: readonly string[]
}

const unitOf = (product: Product, variant: Product['variants'][number] | undefined): DecisionUnit =>
  variant === undefined
    ? { product, variant, winnerClaims: product.winnerClaims, waitlistClaims: product.waitlistClaims, waitlist: product.waitlist }
    : { product, variant, winnerClaims: variant.winnerClaims, waitlistClaims: variant.waitlistClaims, waitlist: variant.waitlist }

/** 승계 결정 필요한 단위 (상품 → 변형 순서) */
export function successionUnits(product: Product): DecisionUnit[] {
  const out: DecisionUnit[] = []
  if (product.awaitingSuccession) out.push(unitOf(product, undefined))
  if (!product.hasOptions) return out
  for (const variant of product.variants) if (variant.awaitingSuccession) out.push(unitOf(product, variant))
  return out
}

/** 충돌이 있는 단위 (상품 → 변형 순서) */
export function conflictUnits(product: Product): DecisionUnit[] {
  const out: DecisionUnit[] = []
  if (product.conflict) out.push(unitOf(product, undefined))
  if (!product.hasOptions) return out
  for (const variant of product.variants) if (variant.conflict) out.push(unitOf(product, variant))
  return out
}
