// 조회 함수 (AC-S02-01, AC-S03-01). 상태에서 상품·찜·보류·구매자·정산·효과·취소 요청을 보여 준다.
// - 구매자는 지금의 구매자(합친 결과) 기준이다: 상품의 1등·대기, 보류, 정산 묶음. 찜·효과·요청은 자신과 지금의 구매자를 함께 보인다.
// - 정렬은 항상 명시적인 키로 한다: 방송 선언 순서·번호, 찜·효과·구매자의 생성 순서(n), 판정 순위.
// - 개인정보: 엔진에는 전화번호 원문이 없다. 구매자의 전화번호 정보는 뒤 4자리뿐이고, 전화번호 키는 보이지 않는다(R-11, ORD-08 AC4, D-061).
// - 정산 설정(배송비·무료 기준)은 그 날짜의 첫 방송(선언 순서)의 스냅샷이다(D-070).
import { DEFAULT_SETTINGS, type SaleSettings } from '../settings.ts'
import { pairsOfText } from '../options.ts'
import { Draft, ownSet, unitKeyOf, variantActiveKey } from './draft.ts'
import { groupEntries, settle } from './ledger.ts'
import { pentries, pget, pkeys, pvalues } from './pmap.ts'
import { applyMerge, planMerge } from './merge.ts'
import { isActive, isLocked, sortedPending, stockOf, unitPrice } from './rules.ts'
import type {
  BroadcastDetails,
  FocusInfo,
  ReviewInfo,
  ReviewRecord,
  UnitRecord,
  VariantInfo,
  BroadcastRecord,
  BuyerInfo,
  BuyerRecord,
  CancelRequestInfo,
  ClaimInfo,
  ClaimRecord,
  EffectInfo,
  EngineState,
  MergeDuplicate,
  MergeItems,
  MergePreview,
  MessageInfo,
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

/** 방송 선언 순서·번호 순 (번호·찜 공통) */
function broadcastOrder(state: EngineState): (a: { readonly b: string; readonly no: number }, b: { readonly b: string; readonly no: number }) => number {
  const index = new Map(state.broadcasts.map((broadcast, i) => [broadcast.id, i]))
  return (a, b) => (index.get(a.b) as number) - (index.get(b.b) as number) || a.no - b.no
}

function claimOf(state: EngineState, id: string): ClaimRecord {
  return pget(state.claims, id) as ClaimRecord
}

const priceChanges = (history: readonly PriceChange[]): PriceChangeInfo[] => history.map(({ from, to, at }) => ({ from, to, at }))

// ── 방송 (D-070) ─────────────────────────────────────────────────────────

/** 지금 상품 (옵션 방송, R-20 6) — 상품 ID를 지금의 상품 키로 */
function focusInfo(state: EngineState, broadcast: BroadcastRecord): FocusInfo | null {
  if (broadcast.focus === null) return null
  const key = pget(state.products, broadcast.focus.pid)
  if (key === undefined) return null
  const slot = pget(state.slots, key)
  if (slot === undefined) return null
  return { product: key, no: slot.no, productId: broadcast.focus.pid, at: broadcast.focus.at }
}

function broadcastDetails(state: EngineState, broadcast: BroadcastRecord): BroadcastDetails {
  return {
    id: broadcast.id,
    date: broadcast.date,
    title: broadcast.title,
    ended: broadcast.endedAt !== null,
    endedAt: broadcast.endedAt,
    settings: { ...broadcast.settings },
    focus: focusInfo(state, broadcast),
  }
}

/** 선언된 방송 전부, 선언 순서 (ID·날짜·제목·끝났는지·끝난 시각·설정 스냅샷·지금 상품) */
export function listBroadcasts(state: EngineState): BroadcastDetails[] {
  return state.broadcasts.map((broadcast) => broadcastDetails(state, broadcast))
}

/** 선언된 방송 하나 (선언하지 않은 방송이면 null) */
export function getBroadcast(state: EngineState, id: string): BroadcastDetails | null {
  const broadcast = state.broadcasts.find((item) => item.id === id)
  return broadcast === undefined ? null : broadcastDetails(state, broadcast)
}

/**
 * 그 날짜 정산 묶음의 설정 = 그 날짜 방송 중 선언 순서가 처음인 방송의 스냅샷 (D-070 — 뒤 방송을 시작해도 이미 계산한 묶음 금액이 바뀌지 않게).
 * 그 날짜에 방송이 없으면 품목이 있을 수 없어(배송비 0) 기본값을 쓴다.
 */
function settlementSettings(state: EngineState, date: string): SaleSettings {
  return state.broadcasts.find((broadcast) => broadcast.date === date)?.settings ?? DEFAULT_SETTINGS
}

/** 표시 상태 (R-2): READY·HOLD·CLOSED는 방송자가 정한 상태, 판매 중이면 확정 수 = 재고 → SOLD, 적으면 OPEN */
export function productStatus(product: Pick<ProductRecord, 'phase' | 'stock'>, confirmed: number): ProductStatus {
  if (product.phase !== 'SELLING') return product.phase
  return confirmed >= product.stock ? 'SOLD' : 'OPEN'
}

/** 확정 찜 수량의 합 */
function unitsOf(state: EngineState, winners: readonly string[]): number {
  return winners.reduce((sum, id) => sum + claimOf(state, id).qty, 0)
}

/**
 * 변형 상태 (D-O1-01): 판매 중이면 확정 수량 = 재고(재고 0 변형은 처음부터)일 때 SOLD, 아니면 OPEN. 판매 중이 아니면 상품 상태
 */
export function variantStatus(product: Pick<ProductRecord, 'phase'>, stock: number, confirmed: number): ProductStatus {
  if (product.phase !== 'SELLING') return product.phase
  return confirmed >= stock ? 'SOLD' : 'OPEN'
}

function variantInfo(state: EngineState, r: Draft, slot: SlotRecord, product: ProductRecord, unit: UnitRecord): VariantInfo {
  const current = (id: string): string => r.root(claimOf(state, id).buyer)
  const stock = stockOf(product, unit.text)
  const confirmed = unitsOf(state, unit.winners)
  return {
    key: unitKeyOf(slot.key, unit.text),
    text: unit.text,
    options: pairsOfText(product.options, unit.text),
    status: variantStatus(product, stock, confirmed),
    stock,
    confirmedUnits: confirmed,
    remaining: stock - confirmed,
    price: unitPrice(product, unit.text),
    winners: unit.winners.map(current),
    winnerClaims: [...unit.winners],
    waitlist: unit.waitlist.map(current),
    waitlistClaims: [...unit.waitlist],
    awaitingSuccession: unit.awaiting,
    conflict: unit.conflict !== null,
  }
}

function productInfo(state: EngineState, r: Draft, slot: SlotRecord, product: ProductRecord): ProductInfo {
  const current = (id: string): string => r.root(claimOf(state, id).buyer)
  // 상품 변형만 (번호를 바꾼 뒤 남은 변형 보류 찜의 자리는 그 상품의 변형이 아니다)
  const variants = slot.units.filter((unit) => product.variants.some((variant) => variant.text === unit.text)).map((unit) => variantInfo(state, r, slot, product, unit))
  const confirmed = unitsOf(state, slot.winners) + variants.reduce((sum, variant) => sum + variant.confirmedUnits, 0)
  // 옵션 상품: 판매 중이면 모든 변형이 SOLD일 때 SOLD, 아니면 OPEN (R-19 "변형과 재고 단위")
  const status = product.options.length === 0 ? productStatus(product, confirmed) : product.phase !== 'SELLING' ? product.phase : variants.every((variant) => variant.status === 'SOLD') ? 'SOLD' : 'OPEN'
  return {
    key: slot.key,
    id: product.id,
    broadcast: slot.b,
    no: slot.no,
    name: product.name,
    price: product.price,
    stock: product.stock,
    status,
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
    aliases: [...product.aliases],
    options: product.options,
    hasOptions: product.options.length > 0,
    confirmedUnits: confirmed,
    variants,
    // 확인 중인 상품에만 싣는다 (R-2 "확인 중") — 닉네임·채팅 글은 없다
    ...(product.tentative === undefined
      ? {}
      : {
          tentative: {
            by: product.tentative.by,
            reasons: [...product.tentative.reasons],
            candidates: { no: [...product.tentative.candidates.no], price: [...product.tentative.candidates.price], name: [...product.tentative.candidates.name] },
            seq: product.tentative.seq,
            at: product.tentative.at,
          },
        }),
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
function productKeyOf(state: EngineState, claim: ClaimRecord): string {
  return claim.pid === null ? claim.key : (pget(state.products, claim.pid) as string)
}

/** 찜의 키: 옵션을 가진 찜은 변형 키, 아니면 상품 키 (D-O1-02) */
function claimKey(state: EngineState, claim: ClaimRecord): string {
  return unitKeyOf(productKeyOf(state, claim), claim.variant)
}

/** 찜 금액 = 단가 스냅샷 × 수량 */
const amount = (claim: ClaimRecord): number => (claim.price as number) * claim.qty

function claimInfo(state: EngineState, r: Draft, claim: ClaimRecord): ClaimInfo {
  const key = productKeyOf(state, claim)
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
    key: unitKeyOf(key, claim.variant),
    qty: claim.qty,
    variant: claim.variant,
    options: claim.options,
    amount: claim.price === null ? null : amount(claim),
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

/** 그 번호에 기다리는 보류 찜 수 (상품이 없어도 센다). 계정 동기화가 "기다리는 찜이 있는 번호"를 볼 때 쓴다 (D-RETRO-83) */
export function pendingCount(state: EngineState, broadcast: string, no: number): number {
  return pget(state.slots, `${broadcast}/${String(no)}`)?.pending.size ?? 0
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
    const amounts = items.filter((claim) => claim.b === broadcast.id).map(amount)
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
    phoneLast4: buyer.phoneLast4,
    items: items.map((claim) => claimKey(state, claim)),
    subtotal: items.reduce((sum, claim) => sum + amount(claim), 0),
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

/**
 * 지금의 구매자 묶음(자신과 합쳐진 구매자)에 이어진 전화번호 키, 기록 순서와 상관없이 글자 순 (D-REAL-03 — 영수증 문자를 보낼 번호 찾기).
 * 엔진이 모르는 구매자면 빈 목록
 */
export function buyerPhoneKeys(state: EngineState, id: string): string[] {
  if (pget(state.buyers, id) === undefined) return []
  const r = reader(state)
  const root = r.root(id)
  return pentries(state.phoneKeys)
    .filter(([, buyer]) => pget(state.buyers, buyer) !== undefined && r.root(buyer) === root)
    .map(([key]) => key)
    .sort()
}

// ── 합치기 미리 보기 (R-11 "미리 보기", BUY-03, D-100) ──────────────────

/** 확정 찜의 상품 키(생성 순서)와 합 — buyerInfo의 items·subtotal과 같은 계산 */
function itemsOf(state: EngineState, members: readonly string[]): MergeItems {
  const items = confirmedClaims(state, members)
  return { items: items.map((claim) => claimKey(state, claim)), subtotal: items.reduce((sum, claim) => sum + amount(claim), 0) }
}

/**
 * buyer.merge(from, into)를 지금 상태에 적용하면 일어날 일 (순수 조회 — 넘긴 상태를 바꾸지 않는다).
 * from·into는 buyer.merge와 같이 구매자 자신의 ID다. 판정과 같은 계획 함수(planMerge)로 막힘·남는 찜을 정하고,
 * 막히지 않으면 그 계획을 작업 사본에 실제로 적용한 상태에서 합친 뒤의 구매자를 읽는다 — applyEvent(buyer.merge)의 결과와 같다.
 */
export function previewMerge(state: EngineState, from: string, into: string): MergePreview {
  const r = reader(state)
  const plan = planMerge(r, from, into)
  const byPlace = broadcastOrder(state)
  const members = pget(state.buyers, from) === undefined ? [] : r.members(from)
  const moving = { buyers: members, ...itemsOf(state, members) }
  if (plan.blocked !== null) {
    const bothConfirmed = [...plan.bothConfirmed].sort(byPlace).map((claim) => claimKey(state, claim))
    return { from, into, blocked: plan.blocked, target: plan.target, bothConfirmed, moving, after: null, duplicates: [] }
  }
  const duplicates = plan.steps
    .flatMap(({ keep, drop }) => (drop === null ? [] : [{ keep, drop }]))
    .sort((a, b) => byPlace(a.drop, b.drop))
    .map(({ keep, drop }): MergeDuplicate => ({ claim: drop.id, product: claimKey(state, drop), buyer: drop.buyer, status: drop.status as MergeDuplicate['status'], keep: keep.id }))
  // 같은 계획을 새 작업 사본에 적용해 합친 뒤의 구매자를 읽는다 (넘긴 상태는 그대로 — 작업 사본은 바뀐 기록만 새로 만든다)
  const draft = new Draft(state, { seq: 0, at: 0 })
  applyMerge(draft, from, into, plan)
  const next = draft.commit().state
  const after = itemsOf(next, reader(next).members(plan.target))
  return { from, into, blocked: null, target: plan.target, bothConfirmed: [], moving, after, duplicates }
}

/** 문자찜 ref → 그 ref의 처음 문자찜이 정한 구매자 자신 (받지 않은 ref, 구매자를 정하지 않은 문자찜(모르는 지정 구매자)이면 null) */
export function buyerOfRef(state: EngineState, ref: string): string | null {
  return pget(state.refs, ref) ?? null
}

/** 구매자를 정한 문자찜 ref 전부 (ref 사전 순). 받았지만 구매자를 정하지 않은 ref(모르는 지정 구매자, D-067)는 넣지 않는다 */
export function listSmsRefs(state: EngineState): SmsRefInfo[] {
  const r = reader(state)
  const out: SmsRefInfo[] = []
  for (const [ref, buyer] of pentries(state.refs)) if (buyer !== null) out.push({ ref, buyer, currentBuyer: r.root(buyer) })
  return out.sort((a, b) => (a.ref < b.ref ? -1 : 1))
}

// ── 정산 (R-12) ──────────────────────────────────────────────────────────

function settlementInfo(state: EngineState, r: Draft, root: string, date: string, items: readonly ClaimRecord[]): SettlementInfo {
  const entries = groupEntries(r, root, date)
  const subtotal = items.reduce((sum, claim) => sum + amount(claim), 0)
  const totals = settle(
    settlementSettings(state, date),
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

/** 그 번호에서 그 채널 자신의 활성 찜 ID (번호 자신 + 변형마다), 생성 순서 */
function ownActiveClaims(state: EngineState, r: Draft, slot: SlotRecord, buyer: string): string[] {
  const root = r.root(buyer)
  const ids = [pget(slot.active, root), ...slot.units.map((unit) => pget(slot.variantActive, variantActiveKey(root, unit.text)))]
  return ids
    .filter((id): id is string => id !== undefined && claimOf(state, id).buyer === buyer)
    .sort((a, b) => claimOf(state, a).n - claimOf(state, b).n)
}

/**
 * 처리 대기 중인 시청자 취소 요청 (활성 찜에 걸린 것만), 요청 순서 (요청은 채팅 하나에 하나라 seq가 겹치지 않는다).
 * 변형을 정하지 않은 요청(옵션 상품, R-20 8)은 상품 키·choices(그 채널의 활성 찜)와 함께 — 판매자가 변형을 고른다
 */
export function listCancelRequests(state: EngineState): CancelRequestInfo[] {
  const r = reader(state)
  const out: CancelRequestInfo[] = pvalues(state.claims)
    .filter((claim) => claim.request !== null && isActive(claim.status))
    .map((claim) => ({ product: claimKey(state, claim), buyer: claim.buyer, currentBuyer: r.root(claim.buyer), claim: claim.id, seq: claim.request as number, chooseVariant: false, choices: [claim.id] }))
  for (const slot of pvalues(state.slots)) {
    for (const request of slot.requests) {
      out.push({
        product: slot.key,
        buyer: request.buyer,
        currentBuyer: r.root(request.buyer),
        claim: `request:${slot.key}:${request.buyer}`,
        seq: request.seq,
        chooseVariant: true,
        choices: ownActiveClaims(state, r, slot, request.buyer),
      })
    }
  }
  return out.sort((a, b) => a.seq - b.seq || (a.claim < b.claim ? -1 : 1))
}

/**
 * 그 번호에서 구매자(지금의 구매자로 푼다)의 활성 찜 ID (없으면 null).
 * variant(옵션 글)를 주면 그 변형의 활성 찜, 주지 않으면 번호 자신의 활성 찜(옵션 없는 상품·번호만 쓴 보류 찜)
 */
export function activeClaimId(state: EngineState, broadcast: string, no: number, buyer: string, variant: string | null = null): string | null {
  const slot = pget(state.slots, `${broadcast}/${String(no)}`)
  if (slot === undefined) return null
  const root = reader(state).root(buyer)
  return (variant === null ? pget(slot.active, root) : pget(slot.variantActive, variantActiveKey(root, variant))) ?? null
}

// ── 확인 필요 (R-20 7, O1) ───────────────────────────────────────────────

function reviewInfo(state: EngineState, r: Draft, review: ReviewRecord): ReviewInfo {
  const key = review.pid === null ? undefined : pget(state.products, review.pid)
  const product = review.no === null ? null : (key ?? `${review.b}/${String(review.no)}`)
  const no = product === null ? null : Number(product.slice(product.lastIndexOf('/') + 1))
  return {
    broadcast: review.b,
    item: review.item,
    buyer: review.buyer,
    currentBuyer: r.root(review.buyer),
    reason: review.reason,
    product,
    no,
    options: review.options,
    qty: review.qty,
    seq: review.seq,
    at: review.at,
    origin: review.origin,
  }
}

/** 확인 필요 항목 전부, 원래 순위(출처 입력의 도착 순서 seq) 순 — 모든 방송을 한 목록으로 (D-O1-10) */
export function listReviews(state: EngineState): ReviewInfo[] {
  const r = reader(state)
  return pvalues(state.reviews)
    .sort((a, b) => a.seq - b.seq || (a.item < b.item ? -1 : 1))
    .map((review) => reviewInfo(state, r, review))
}

// ── 차단·메시지 (D-086, dev-server가 더한 순수 조회 — 상태를 읽기만 한다) ──────────────

/** 코드 단위 사전 순 (맵의 키는 겹치지 않으므로 같은 경우가 없다) */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : 1)

/**
 * 차단 중인 구매자 ID 전부, ID 사전 순(UTF-16 코드 단위). 구매자로 기록된 적 없는 미리 차단한 채널도 들어간다 (R-9, D-086).
 * 서버 차단 이어받기(AC-S05-80)가 영속 맵 내부를 읽지 않고 이 함수만 쓴다
 */
export function listBlocked(state: EngineState): string[] {
  // 풀면 맵에서 지운다(값은 늘 true) — 키가 곧 차단 중인 ID다
  return pkeys(state.blocked).sort(byCodeUnit)
}

/**
 * 받은 채팅 메시지 전부, seq 순 (R-4, R-7 4, D-062, D-076, D-086). 본문·닉네임은 상태에 없다(서버가 이벤트 기록에서 붙인다).
 * 주문·취소·무시는 받을 때 엔진이 정한 값이고, 바꾼 번호는 그 메시지를 찜으로 바꾼 번호(바꾼 순서)다
 */
export function listMessages(state: EngineState): MessageInfo[] {
  const out: MessageInfo[] = []
  for (const [key, message] of pentries(state.messages)) {
    const [broadcast, id] = JSON.parse(key) as [string, string]
    out.push({
      broadcast,
      id,
      channel: message.ch,
      seq: message.seq,
      at: message.at,
      publishedAt: message.publishedAt,
      ignored: message.ignored,
      order: message.order,
      cancel: message.cancel,
      converted: [...message.converted],
    })
  }
  return out.sort((a, b) => a.seq - b.seq)
}
