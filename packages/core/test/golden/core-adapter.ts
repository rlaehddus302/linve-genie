// 실제 코어(@livejjim/core)를 골든 러너의 GoldenCore 모양으로 감싼다.
// - 파서(S01)는 코어 결과를 바꾸지 않고 그대로 넘긴다(AC-S01-04).
// - 엔진(S02, AC-S02-91)은 이름·모양만 바꾼다. 판정·합계·정산·효과 상태는 다시 계산하지 않고 조회 함수 결과를 그대로 옮긴다.
// - 효과 보고 이벤트의 (상품, 구매자[, 대상]) → 효과 ID 연결은 README 규칙("가장 최근에 나온, 취소되지 않은 해당 효과")대로 조회 함수로 찾는다.
import {
  applyEvent,
  checkInvariants,
  initEngine,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  parseAmount,
  parseChat,
  parseKoreanNumber,
  parseQuickInput,
  type EngineEvent,
  type EngineState,
} from '@livejjim/core'
import type { BuyerView, ClaimView, EffectView, GoldenCore, GoldenEvent, GoldenSnapshot, ProductView, SettlementView } from './types.ts'

/** 효과 보고 이벤트가 가리키는 효과 ID (없으면 undefined — 러너가 먼저 러너 오류로 잡는다) */
export function reportTarget(state: EngineState, event: GoldenEvent): string | undefined {
  const kind = event.type === 'effect.labelPrinted' ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
  const target = event.type === 'effect.thanksSent' ? (typeof event.target === 'string' ? event.target : 'LIVE_CHAT') : null
  const product = `${String(event.b)}/${String(event.no)}`
  return listEffects(state).findLast(
    (effect) =>
      effect.kind === kind && effect.product === product && effect.buyer === event.buyer && effect.target === target && effect.status !== 'CANCELLED',
  )?.id
}

/** 골든 이벤트 → 엔진 이벤트. 필드 이름은 README와 같으므로 효과 보고만 효과 ID로 바꾼다 */
export function toEngineEvent(state: EngineState, event: GoldenEvent): EngineEvent {
  if (event.type !== 'effect.labelPrinted' && event.type !== 'effect.thanksSent') return event as unknown as EngineEvent
  const effectId = reportTarget(state, event)
  if (effectId === undefined) throw new Error(`효과 보고 대상이 없다: ${event.type} ${String(event.b)}/${String(event.no)} ${String(event.buyer)}`)
  return { seq: event.seq, at: event.at, type: event.type, effectId }
}

/** 엔진 상태 → 골든 관찰 스냅샷 (이름·모양만 바꾼다) */
export function toSnapshot(state: EngineState): GoldenSnapshot {
  const buyers = listBuyers(state)
  const products: Record<string, ProductView> = {}
  for (const product of listProducts(state)) {
    products[product.key] = {
      status: product.status,
      winners: product.winners,
      waitlist: product.waitlist,
      conflict: product.conflict,
      price: product.price,
      priceHistory: product.priceHistory,
    }
  }
  const buyerViews: Record<string, BuyerView> = {}
  for (const buyer of buyers) {
    buyerViews[buyer.id] = { display: buyer.display, nameHistory: buyer.nameHistory, items: buyer.items, subtotal: buyer.subtotal, byBroadcast: buyer.byBroadcast }
  }
  const settlements: Record<string, SettlementView> = {}
  for (const s of listSettlements(state)) {
    settlements[`${s.buyer}@${s.date}`] = { subtotal: s.subtotal, shipping: s.shipping, adjustments: s.adjustments, total: s.total, refundDue: s.refundDue, payment: s.payment }
  }
  const effects = listEffects(state).map(
    (effect): EffectView => ({
      kind: effect.kind,
      status: effect.status,
      ...(effect.target === null ? {} : { target: effect.target }),
      product: effect.product,
      buyer: effect.buyer,
      ...(effect.text === null ? {} : { text: effect.text }),
      confirmVersion: effect.confirmVersion,
    }),
  )
  const claims = listClaims(state).map(
    (claim): ClaimView => ({ product: claim.product, buyer: claim.buyer, status: claim.status, ...(claim.reason === null ? {} : { reason: claim.reason }) }),
  )
  const pending: Record<string, readonly string[]> = {}
  for (const entry of listPending(state)) pending[entry.product] = entry.buyers
  return {
    // S02: 구매자 키 = 유튜브 채널 ID = 구매자 ID (합치기·문자찜 연결은 S03)
    buyerKeys: Object.fromEntries(buyers.map((buyer) => [buyer.id, buyer.id])),
    products,
    buyers: buyerViews,
    settlements,
    effects,
    claims,
    pending,
    cancelRequests: listCancelRequests(state).map((request) => ({ product: request.product, buyer: request.buyer })),
  }
}

export const realCore: GoldenCore = {
  parser: {
    chat: (text, settings) => parseChat(text, settings),
    amount: (text, settings) => parseAmount(text, settings),
    koreanNumber: (text) => parseKoreanNumber(text),
    quickInput: (text, settings) => parseQuickInput(text, settings),
  },
  engine: {
    start: (setup) => initEngine(setup),
    apply: (state, event) => applyEvent(state as EngineState, toEngineEvent(state as EngineState, event)),
    observe: (state) => toSnapshot(state as EngineState),
    invariants: (state) => checkInvariants(state as EngineState),
  },
}
