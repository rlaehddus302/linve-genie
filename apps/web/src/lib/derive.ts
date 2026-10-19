// 범위 조회 결과에서 화면에 보일 값 고르기 (AC-S05-14·21·30). 판정은 하지 않는다 — 코어 조회 함수 결과를 고르고 낱말로 바꾸기만 한다.
import type { Buyer, Claim, Product } from '../api/types.ts'
import type { ScopeData } from './scope-data.ts'
import { LABEL_WORD, claimStatusWord } from './words.ts'

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

/**
 * 구매자 표시 이름 (BUY-01 AC2): 엔진 표시 이름 그대로, 같은 표시 이름이 둘 이상이면 채널 ID 끝 4자리를 함께
 * (문자 구매자는 전화번호 뒤 4자리가 있으면 그것).
 */
export class BuyerNames {
  readonly #buyers: ReadonlyMap<string, Buyer>
  readonly #counts = new Map<string, number>()
  /** 전화번호 없는 문자 구매자의 차례 (구분 글자 — 문자 구매자 ID는 보이지 않는다, AC-S06-80) */
  readonly #smsOrder = new Map<string, number>()
  constructor(buyers: ReadonlyMap<string, Buyer>) {
    this.#buyers = buyers
    for (const buyer of buyers.values()) {
      if (buyer.kind === 'sms' && buyer.phoneLast4 === null) this.#smsOrder.set(buyer.id, this.#smsOrder.size + 1)
      if (buyer.mergedInto !== null) continue
      this.#counts.set(buyer.display, (this.#counts.get(buyer.display) ?? 0) + 1)
    }
  }

  /** 구매자 ID → 표시 이름 */
  name(id: string): string {
    const buyer = this.#buyers.get(id)
    if (buyer === undefined) return '알 수 없는 구매자'
    if ((this.#counts.get(buyer.display) ?? 0) < 2) return buyer.display
    if (buyer.kind === 'sms' && buyer.phoneLast4 === null) return `${buyer.display} (${String(this.#smsOrder.get(buyer.id) ?? 0)}번째 문자)`
    return `${buyer.display} (끝 ${tail(buyer)})`
  }

  /** 같은 표시 이름이 있어 구분 글자가 붙는지 */
  isDuplicate(id: string): boolean {
    const buyer = this.#buyers.get(id)
    return buyer !== undefined && (this.#counts.get(buyer.display) ?? 0) >= 2
  }
}

function tail(buyer: Buyer): string {
  if (buyer.kind === 'sms') return buyer.phoneLast4 ?? ''
  return buyer.id.slice(-4)
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

type LabelState = 'PENDING' | 'DONE'
const labelIndexCache = new WeakMap<ScopeData['effects'], ReadonlyMap<string, LabelState>>()

/** (찜, 확정버전) → 상품 라벨 효과 상태. 효과 목록이 바뀔 때만 다시 만든다 */
function labelIndex(effects: ScopeData['effects']): ReadonlyMap<string, LabelState> {
  const hit = labelIndexCache.get(effects)
  if (hit !== undefined) return hit
  const map = new Map<string, LabelState>()
  for (const effect of effects.values()) {
    if (effect.kind !== 'PRINT_PRODUCT_LABEL') continue
    const key = `${effect.claim}#${String(effect.confirmVersion)}`
    if (effect.status === 'DONE') map.set(key, 'DONE')
    else if (effect.status === 'PENDING' && !map.has(key)) map.set(key, 'PENDING')
  }
  labelIndexCache.set(effects, map)
  return map
}

/** 상품 라벨 상태 (그 방송이 자동 출력을 켰을 때만, 실제 범위만 — D-081·D-088) */
export function labelWords(data: ScopeData, product: Product): string[] {
  const broadcast = data.broadcasts.get(product.broadcast)
  // 리허설 범위는 라벨을 출력하지 않는다(D-081) — 영원히 "라벨 대기"로 보이지 않게 숨긴다
  if (data.rehearsal || broadcast === undefined || broadcast.settings['print.autoOnConfirm'] !== true) return []
  const index = labelIndex(data.effects)
  const words = new Set<string>()
  for (const claimId of product.winnerClaims) {
    const claim = data.claims.get(claimId)
    if (claim === undefined) continue
    if (claim.reprintNeeded) {
      words.add(LABEL_WORD.reprint)
      continue
    }
    const label = index.get(`${claimId}#${String(claim.confirmVersion)}`)
    if (label === 'DONE') words.add(LABEL_WORD.printed)
    else if (label === 'PENDING') words.add(LABEL_WORD.waiting)
  }
  return [...words]
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
