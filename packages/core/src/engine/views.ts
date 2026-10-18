// 조회 함수 (AC-S02-01). 상태에서 상품·찜·보류·구매자·정산·효과·취소 요청을 보여 준다.
// 정렬은 항상 명시적인 키로 한다: 방송 선언 순서·번호, 찜·효과·구매자의 생성 순서(n).
import { ownGet, ownSet } from './draft.ts'
import { pget, pvalues } from './pmap.ts'
import { isActive } from './rules.ts'
import type {
  BuyerInfo,
  BuyerRecord,
  CancelRequestInfo,
  ClaimInfo,
  ClaimRecord,
  EffectInfo,
  EngineState,
  PendingInfo,
  ProductInfo,
  ProductRecord,
  ProductStatus,
  SettlementInfo,
  SlotRecord,
} from './types.ts'

const byN = <T extends { readonly n: number }>(a: T, b: T): number => a.n - b.n

function broadcastOrder(state: EngineState): (a: SlotRecord, b: SlotRecord) => number {
  const index = new Map(state.broadcasts.map((broadcast, i) => [broadcast.id, i]))
  return (a, b) => (index.get(a.b) ?? 0) - (index.get(b.b) ?? 0) || a.no - b.no
}

function claimOf(state: EngineState, id: string): ClaimRecord {
  return pget(state.claims, id) as ClaimRecord
}

/** 표시 상태 (R-2): READY·HOLD·CLOSED는 방송자가 정한 상태, 판매 중이면 확정 수 = 재고 → SOLD, 적으면 OPEN */
export function productStatus(product: ProductRecord, confirmed: number): ProductStatus {
  if (product.phase !== 'SELLING') return product.phase
  return confirmed >= product.stock ? 'SOLD' : 'OPEN'
}

function productInfo(state: EngineState, slot: SlotRecord, product: ProductRecord): ProductInfo {
  return {
    key: slot.key,
    broadcast: slot.b,
    no: slot.no,
    name: product.name,
    price: product.price,
    stock: product.stock,
    status: productStatus(product, slot.winners.length),
    winners: slot.winners.map((id) => claimOf(state, id).buyer),
    waitlist: slot.waitlist.map((id) => claimOf(state, id).buyer),
    awaitingSuccession: slot.awaiting,
    conflict: false,
    priceHistory: product.priceHistory,
    confirmVersion: slot.version,
  }
}

/** 지금 그 번호의 상품 (판매 종료한 상품도 있는 것으로 본다). 없으면 null */
export function getProduct(state: EngineState, broadcast: string, no: number): ProductInfo | null {
  const slot = pget(state.slots, `${broadcast}/${String(no)}`)
  return slot === undefined || slot.product === null ? null : productInfo(state, slot, slot.product)
}

/** 모든 상품, 방송 선언 순서·번호 순 */
export function listProducts(state: EngineState): ProductInfo[] {
  return pvalues(state.slots)
    .sort(broadcastOrder(state))
    .flatMap((slot) => (slot.product === null ? [] : [productInfo(state, slot, slot.product)]))
}

function claimInfo(claim: ClaimRecord): ClaimInfo {
  return {
    id: claim.id,
    product: claim.key,
    broadcast: claim.b,
    no: claim.no,
    buyer: claim.buyer,
    status: claim.status,
    reason: claim.reason,
    origin: claim.origin,
    seq: claim.seq,
    at: claim.at,
    price: claim.price,
    confirmVersion: claim.version,
    locked: claim.status === 'CONFIRMED' && claim.locked,
    cancelRequested: claim.request !== null && isActive(claim.status),
  }
}

/** 생성된 찜 전부, 생성 순서 (claimCount = 길이) */
export function listClaims(state: EngineState): ClaimInfo[] {
  return pvalues(state.claims).sort(byN).map(claimInfo)
}

/** 번호별 보류 찜 (보류 찜이 있는 번호만), 방송 선언 순서·번호 순. 구매자는 판정 순위 순 */
export function listPending(state: EngineState): PendingInfo[] {
  return pvalues(state.slots)
    .filter((slot) => slot.pending.length > 0)
    .sort(broadcastOrder(state))
    .map((slot) => ({
      product: slot.key,
      broadcast: slot.b,
      no: slot.no,
      buyers: slot.pending.map((id) => claimOf(state, id).buyer),
      claims: [...slot.pending],
    }))
}

function confirmedClaims(state: EngineState, buyer: BuyerRecord): ClaimRecord[] {
  return buyer.claims.flatMap((id) => {
    const claim = pget(state.claims, id)
    return claim?.status === 'CONFIRMED' ? [claim] : []
  })
}

function buyerInfo(state: EngineState, buyer: BuyerRecord): BuyerInfo {
  const items = confirmedClaims(state, buyer)
  const byBroadcast: Record<string, number> = {}
  for (const broadcast of state.broadcasts) {
    const amounts = items.filter((claim) => claim.b === broadcast.id).map((claim) => claim.price ?? 0)
    if (amounts.length > 0) ownSet(byBroadcast, broadcast.id, amounts.reduce((sum, price) => sum + price, 0))
  }
  return {
    id: buyer.id,
    display: buyer.display,
    nameHistory: buyer.names,
    items: items.map((claim) => claim.key),
    subtotal: items.reduce((sum, claim) => sum + (claim.price ?? 0), 0),
    byBroadcast,
    blocked: pget(state.blocked, buyer.id) === true,
  }
}

/** 구매자 (엔진이 모르는 구매자면 null) */
export function getBuyer(state: EngineState, id: string): BuyerInfo | null {
  const buyer = pget(state.buyers, id)
  return buyer === undefined ? null : buyerInfo(state, buyer)
}

/** 모든 구매자, 처음 기록된 순서 */
export function listBuyers(state: EngineState): BuyerInfo[] {
  return pvalues(state.buyers).sort(byN).map((buyer) => buyerInfo(state, buyer))
}

/**
 * 정산 묶음 하나 (R-12 기본, D-037). 날짜 = 방송의 날짜(찜 시각 아님, D-022).
 * 배송비: 품목 없으면 0, 무료 기준이 있고 합계 ≥ 기준이면 0, 아니면 기본 배송비. 조정·입금·환불은 S03이라 0·UNPAID.
 */
function settlement(state: EngineState, buyer: string, date: string, items: readonly ClaimRecord[]): SettlementInfo {
  const subtotal = items.reduce((sum, claim) => sum + (claim.price ?? 0), 0)
  const threshold = state.settings['shipping.freeThreshold']
  const shipping = items.length === 0 || (threshold !== null && subtotal >= threshold) ? 0 : state.settings['shipping.baseFee']
  return {
    buyer,
    date,
    items: items.map((claim) => claim.key),
    subtotal,
    shipping,
    adjustments: 0,
    total: subtotal + shipping,
    refundDue: 0,
    payment: 'UNPAID',
  }
}

function itemsByDate(state: EngineState, buyer: BuyerRecord): Map<string, ClaimRecord[]> {
  const dateOf = new Map(state.broadcasts.map((broadcast) => [broadcast.id, broadcast.date]))
  const groups = new Map<string, ClaimRecord[]>()
  for (const claim of confirmedClaims(state, buyer)) {
    const date = dateOf.get(claim.b) as string
    groups.set(date, [...(groups.get(date) ?? []), claim])
  }
  return groups
}

/** (구매자, 날짜) 정산 묶음. 품목이 없거나 모르는 구매자면 금액 전부 0, UNPAID */
export function getSettlement(state: EngineState, buyer: string, date: string): SettlementInfo {
  const record = pget(state.buyers, buyer)
  const items = record === undefined ? [] : (itemsByDate(state, record).get(date) ?? [])
  return settlement(state, buyer, date, items)
}

/** 품목이 있는 모든 정산 묶음, 구매자 기록 순서·날짜 순 */
export function listSettlements(state: EngineState): SettlementInfo[] {
  return pvalues(state.buyers)
    .sort(byN)
    .flatMap((buyer) =>
      [...itemsByDate(state, buyer)]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, items]) => settlement(state, buyer.id, date, items)),
    )
}

/** 지금까지 나온 효과 전부(실행·취소 여부 무관), 나온 순서 */
export function listEffects(state: EngineState): EffectInfo[] {
  return pvalues(state.effects)
    .sort(byN)
    .map((effect) => ({
      id: effect.id,
      kind: effect.kind,
      target: effect.target,
      claim: effect.claim,
      product: effect.key,
      buyer: effect.buyer,
      text: effect.text,
      confirmVersion: effect.version,
      status: effect.status,
    }))
}

/** 처리 대기 중인 시청자 취소 요청 (활성 찜에 걸린 것만), 요청 순서 (요청은 채팅 하나에 하나라 seq가 겹치지 않는다) */
export function listCancelRequests(state: EngineState): CancelRequestInfo[] {
  return pvalues(state.claims)
    .filter((claim) => claim.request !== null && isActive(claim.status))
    .sort((a, b) => (a.request as number) - (b.request as number))
    .map((claim) => ({ product: claim.key, buyer: claim.buyer, claim: claim.id, seq: claim.request as number }))
}

/** 그 번호에서 구매자의 활성 찜 ID (없으면 null) */
export function activeClaimId(state: EngineState, broadcast: string, no: number, buyer: string): string | null {
  const slot = pget(state.slots, `${broadcast}/${String(no)}`)
  return (slot === undefined ? undefined : ownGet(slot.active, buyer)) ?? null
}
