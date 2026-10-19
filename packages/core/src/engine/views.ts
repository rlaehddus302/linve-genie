// 조회 함수 (AC-S02-01, AC-S03-01). 상태에서 상품·찜·보류·구매자·정산·효과·취소 요청을 보여 준다.
// - 구매자는 지금의 구매자(합친 결과) 기준이다: 상품의 1등·대기, 보류, 정산 묶음. 찜·효과·요청은 자신과 지금의 구매자를 함께 보인다.
// - 정렬은 항상 명시적인 키로 한다: 방송 선언 순서·번호, 찜·효과·구매자의 생성 순서(n), 판정 순위.
// - 개인정보: 전화번호는 뒤 4자리만 보인다(R-11, ORD-08 AC4).
import { Draft, ownSet } from './draft.ts'
import { groupEntries, settle } from './ledger.ts'
import { phoneLast4 } from './phone.ts'
import { pget, pkeys, pvalues } from './pmap.ts'
import { isActive, isLocked, sortedPending } from './rules.ts'
import type {
  BuyerInfo,
  BuyerRecord,
  CancelRequestInfo,
  ClaimInfo,
  ClaimRecord,
  EffectInfo,
  EngineState,
  PendingInfo,
  PriceChange,
  PriceChangeInfo,
  ProductInfo,
  ProductRecord,
  ProductStatus,
  SettlementInfo,
  SettlementRecordInfo,
  SlotRecord,
  SmsRefInfo,
} from './types.ts'

const byN = <T extends { readonly n: number }>(a: T, b: T): number => a.n - b.n

/** 상태를 읽기만 하는 작업 사본 (지금의 구매자·합친 구매자·정산 기록을 판정과 같은 함수로 읽는다) */
function reader(state: EngineState): Draft {
  return new Draft(state, { seq: 0, at: 0 })
}

function broadcastOrder(state: EngineState): (a: SlotRecord, b: SlotRecord) => number {
  const index = new Map(state.broadcasts.map((broadcast, i) => [broadcast.id, i]))
  return (a, b) => (index.get(a.b) as number) - (index.get(b.b) as number) || a.no - b.no
}

function claimOf(state: EngineState, id: string): ClaimRecord {
  return pget(state.claims, id) as ClaimRecord
}

const priceChanges = (history: readonly PriceChange[]): PriceChangeInfo[] => history.map(({ from, to, at }) => ({ from, to, at }))

/** 표시 상태 (R-2): READY·HOLD·CLOSED는 방송자가 정한 상태, 판매 중이면 확정 수 = 재고 → SOLD, 적으면 OPEN */
export function productStatus(product: Pick<ProductRecord, 'phase' | 'stock'>, confirmed: number): ProductStatus {
  if (product.phase !== 'SELLING') return product.phase
  return confirmed >= product.stock ? 'SOLD' : 'OPEN'
}

function productInfo(state: EngineState, r: Draft, slot: SlotRecord, product: ProductRecord): ProductInfo {
  const current = (id: string): string => r.root(claimOf(state, id).buyer)
  return {
    key: slot.key,
    id: product.id,
    broadcast: slot.b,
    no: slot.no,
    name: product.name,
    price: product.price,
    stock: product.stock,
    status: productStatus(product, slot.winners.length),
    winners: slot.winners.map(current),
    winnerClaims: [...slot.winners],
    waitlist: slot.waitlist.map(current),
    waitlistClaims: [...slot.waitlist],
    awaitingSuccession: slot.awaiting,
    conflict: slot.conflict !== null,
    conflictClaim: slot.conflict,
    conflictBuyer: slot.conflict === null ? null : current(slot.conflict),
    priceHistory: priceChanges(product.priceHistory),
    nameHistory: product.nameHistory.map(({ from, to, at }) => ({ from, to, at })),
    confirmVersion: slot.version,
  }
}

/** 지금 그 번호의 상품 (판매 종료한 상품도 있는 것으로 본다). 없으면 null */
export function getProduct(state: EngineState, broadcast: string, no: number): ProductInfo | null {
  const slot = pget(state.slots, `${broadcast}/${String(no)}`)
  return slot === undefined || slot.product === null ? null : productInfo(state, reader(state), slot, slot.product)
}

/** 모든 상품, 방송 선언 순서·번호 순 */
export function listProducts(state: EngineState): ProductInfo[] {
  const r = reader(state)
  return pvalues(state.slots)
    .sort(broadcastOrder(state))
    .flatMap((slot) => (slot.product === null ? [] : [productInfo(state, r, slot, slot.product)]))
}

/** 찜의 지금 상품 키: 상품에 붙은 찜은 그 상품의 지금 번호, 아니면 생긴 번호 (D-056) */
function claimKey(state: EngineState, claim: ClaimRecord): string {
  return claim.pid === null ? claim.key : (pget(state.products, claim.pid) as string)
}

function claimInfo(state: EngineState, r: Draft, claim: ClaimRecord): ClaimInfo {
  const key = claimKey(state, claim)
  const at = key.lastIndexOf('/')
  const confirmed = claim.status === 'CONFIRMED'
  return {
    id: claim.id,
    product: key,
    productId: claim.pid,
    broadcast: key.slice(0, at),
    no: Number(key.slice(at + 1)),
    buyer: claim.buyer,
    currentBuyer: r.root(claim.buyer),
    status: claim.status,
    reason: claim.reason,
    origin: claim.origin,
    seq: claim.seq,
    rankTime: claim.time,
    rankMinute: claim.minute,
    received: claim.received,
    at: claim.at,
    price: claim.price,
    confirmVersion: claim.version,
    locked: confirmed && isLocked(r, claim),
    cancelRequested: claim.request !== null && isActive(claim.status),
    reprintNeeded: confirmed && claim.reprint,
    priceHistory: priceChanges(claim.priceHistory),
  }
}

/** 생성된 찜 전부, 생성 순서 (claimCount = 길이) */
export function listClaims(state: EngineState): ClaimInfo[] {
  const r = reader(state)
  return pvalues(state.claims)
    .sort(byN)
    .map((claim) => claimInfo(state, r, claim))
}

/** 번호별 보류 찜 (보류 찜이 있는 번호만), 방송 선언 순서·번호 순. 구매자(지금의 구매자)는 판정 순위 순 */
export function listPending(state: EngineState): PendingInfo[] {
  const r = reader(state)
  return pvalues(state.slots)
    .filter((slot) => slot.pending.size > 0)
    .sort(broadcastOrder(state))
    .map((slot) => {
      const claims = sortedPending(r, slot)
      return { product: slot.key, broadcast: slot.b, no: slot.no, buyers: claims.map((id) => r.root(claimOf(state, id).buyer)), claims }
    })
}

/** 구매자 자신과 합쳐진 구매자 전부의 확정 찜, 생성 순서 */
function confirmedClaims(state: EngineState, members: readonly string[]): ClaimRecord[] {
  const out: ClaimRecord[] = []
  for (const member of members) {
    const buyer = pget(state.buyers, member) as BuyerRecord
    for (const id of pkeys(buyer.claims)) {
      const claim = pget(state.claims, id)
      if (claim?.status === 'CONFIRMED') out.push(claim)
    }
  }
  return out.sort(byN)
}

function buyerInfo(state: EngineState, r: Draft, buyer: BuyerRecord): BuyerInfo {
  const members = r.members(buyer.id)
  const items = confirmedClaims(state, members)
  const byBroadcast: Record<string, number> = {}
  for (const broadcast of state.broadcasts) {
    const amounts = items.filter((claim) => claim.b === broadcast.id).map((claim) => claim.price as number)
    if (amounts.length > 0) ownSet(byBroadcast, broadcast.id, amounts.reduce((sum, price) => sum + price, 0))
  }
  return {
    id: buyer.id,
    kind: buyer.kind,
    current: r.root(buyer.id),
    mergedInto: buyer.parent,
    merged: members.slice(1),
    display: buyer.display,
    nameHistory: buyer.names,
    phoneLast4: buyer.phone === null ? null : phoneLast4(buyer.phone),
    items: items.map((claim) => claimKey(state, claim)),
    subtotal: items.reduce((sum, claim) => sum + (claim.price as number), 0),
    byBroadcast,
    blocked: pget(state.blocked, buyer.id) === true,
  }
}

/** 구매자 (엔진이 모르는 구매자면 null). 품목·합계는 자신과 합쳐진 구매자 전부, 표시 이름은 자신의 것 */
export function getBuyer(state: EngineState, id: string): BuyerInfo | null {
  const buyer = pget(state.buyers, id)
  return buyer === undefined ? null : buyerInfo(state, reader(state), buyer)
}

/** 모든 구매자, 처음 기록된 순서 */
export function listBuyers(state: EngineState): BuyerInfo[] {
  const r = reader(state)
  return pvalues(state.buyers)
    .sort(byN)
    .map((buyer) => buyerInfo(state, r, buyer))
}

/** 지금의 구매자 (엔진이 모르는 구매자면 null) */
export function currentBuyerOf(state: EngineState, id: string): string | null {
  return pget(state.buyers, id) === undefined ? null : reader(state).root(id)
}

/** 문자찜 ref → 그 문자찜이 정한 구매자 자신 (받지 않은 ref, 아무 일도 없었던 문자찜이면 null) */
export function buyerOfRef(state: EngineState, ref: string): string | null {
  return pget(state.refs, ref) ?? null
}

/** 받은 문자찜 ref 전부 (ref 사전 순) */
export function listSmsRefs(state: EngineState): SmsRefInfo[] {
  const r = reader(state)
  return pkeys(state.refs)
    .sort((a, b) => (a < b ? -1 : 1))
    .map((ref) => {
      const buyer = pget(state.refs, ref) as string
      return { ref, buyer, currentBuyer: r.root(buyer) }
    })
}

// ── 정산 (R-12) ──────────────────────────────────────────────────────────

function settlementInfo(state: EngineState, r: Draft, root: string, date: string, items: readonly ClaimRecord[]): SettlementInfo {
  const entries = groupEntries(r, root, date)
  const subtotal = items.reduce((sum, claim) => sum + (claim.price as number), 0)
  const totals = settle(
    state.settings,
    subtotal,
    items.length,
    entries.map((item) => item.entry),
  )
  const records: SettlementRecordInfo[] = entries.map(({ buyer, entry }) => ({
    kind: entry.kind,
    buyer,
    amount: entry.amount,
    mode: entry.kind === 'shipping' ? entry.mode : null,
    reason: entry.kind === 'adjust' || entry.kind === 'refund' ? entry.reason : null,
    memo: entry.kind === 'payment' ? entry.memo : null,
    seq: entry.seq,
    at: entry.at,
  }))
  return { buyer: root, date, items: items.map((claim) => claimKey(state, claim)), ...totals, records }
}

/** 지금의 구매자 아래 확정 찜을 방송 날짜로 묶는다 (D-022: 찜 시각이 아니라 방송의 날짜) */
function itemsByDate(state: EngineState, r: Draft, root: string): Map<string, ClaimRecord[]> {
  const dateOf = broadcastDates(state)
  const groups = new Map<string, ClaimRecord[]>()
  for (const claim of confirmedClaims(state, r.members(root))) {
    const date = dateOf.get(claim.b) as string
    const group = groups.get(date)
    if (group === undefined) groups.set(date, [claim])
    else group.push(claim)
  }
  return groups
}

function broadcastDates(state: EngineState): Map<string, string> {
  return new Map(state.broadcasts.map((broadcast) => [broadcast.id, broadcast.date]))
}

/** (지금의 구매자, 날짜) 정산 묶음. 넘긴 구매자는 지금의 구매자로 푼다. 품목도 기록도 없으면 금액 전부 0, UNPAID */
export function getSettlement(state: EngineState, buyer: string, date: string): SettlementInfo {
  const r = reader(state)
  const root = pget(state.buyers, buyer) === undefined ? buyer : r.root(buyer)
  const items = pget(state.buyers, root) === undefined ? [] : (itemsByDate(state, r, root).get(date) ?? [])
  return settlementInfo(state, r, root, date, items)
}

/**
 * 품목이나 정산 기록이 있는 모든 정산 묶음, 지금의 구매자 기록 순서·날짜 순.
 * 찜과 정산 기록을 한 번씩 돌며 (지금의 구매자, 날짜)로 모은다 — 매 이벤트 뒤 불변식 검사에서도 부르므로 상태 크기에 비례해야 한다.
 */
export function listSettlements(state: EngineState): SettlementInfo[] {
  const r = reader(state)
  const roots = new Map<string, string>()
  const rootOf = (buyer: string): string => {
    let root = roots.get(buyer)
    if (root === undefined) {
      root = r.root(buyer)
      roots.set(buyer, root)
    }
    return root
  }
  const dateOf = broadcastDates(state)
  const groups = new Map<string, { readonly root: string; readonly date: string; readonly items: ClaimRecord[] }>()
  const groupOf = (root: string, date: string): ClaimRecord[] => {
    const key = JSON.stringify([root, date])
    let group = groups.get(key)
    if (group === undefined) {
      group = { root, date, items: [] }
      groups.set(key, group)
    }
    return group.items
  }
  for (const claim of pvalues(state.claims)) {
    if (claim.status === 'CONFIRMED') groupOf(rootOf(claim.buyer), dateOf.get(claim.b) as string).push(claim)
  }
  for (const record of pvalues(state.ledger)) groupOf(rootOf(record.buyer), record.date)
  // 묶음은 (지금의 구매자, 날짜)마다 하나라 같은 구매자 안에서 날짜가 겹치지 않는다
  const order = (id: string): number => (pget(state.buyers, id) as BuyerRecord).n
  return [...groups.values()]
    .sort((a, b) => order(a.root) - order(b.root) || (a.date < b.date ? -1 : 1))
    .map(({ root, date, items }) => settlementInfo(state, r, root, date, items.sort(byN)))
}

// ── 효과·요청 ────────────────────────────────────────────────────────────

/** 지금까지 나온 효과 전부(실행·취소 여부 무관), 나온 순서 */
export function listEffects(state: EngineState): EffectInfo[] {
  const r = reader(state)
  return pvalues(state.effects)
    .sort(byN)
    .map((effect) => ({
      id: effect.id,
      kind: effect.kind,
      target: effect.target,
      claim: effect.claim,
      product: effect.key,
      buyer: effect.buyer,
      currentBuyer: r.root(effect.buyer),
      text: effect.text,
      confirmVersion: effect.version,
      status: effect.status,
    }))
}

/** 처리 대기 중인 시청자 취소 요청 (활성 찜에 걸린 것만), 요청 순서 (요청은 채팅 하나에 하나라 seq가 겹치지 않는다) */
export function listCancelRequests(state: EngineState): CancelRequestInfo[] {
  const r = reader(state)
  return pvalues(state.claims)
    .filter((claim) => claim.request !== null && isActive(claim.status))
    .sort((a, b) => (a.request as number) - (b.request as number))
    .map((claim) => ({ product: claimKey(state, claim), buyer: claim.buyer, currentBuyer: r.root(claim.buyer), claim: claim.id, seq: claim.request as number }))
}

/** 그 번호에서 구매자(지금의 구매자로 푼다)의 활성 찜 ID (없으면 null) */
export function activeClaimId(state: EngineState, broadcast: string, no: number, buyer: string): string | null {
  const slot = pget(state.slots, `${broadcast}/${String(no)}`)
  return (slot === undefined ? undefined : pget(slot.active, reader(state).root(buyer))) ?? null
}

