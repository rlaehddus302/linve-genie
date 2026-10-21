// 실제 코어(@livejjim/core)를 골든 러너의 GoldenCore 모양으로 감싼다.
// - 파서(S01)는 코어 결과를 바꾸지 않고 그대로 넘긴다(AC-S01-04). 음성 문장 추출(P2, D-209)은 packages/voice 추출기 결과를 그대로 넘긴다.
//   상품 목록 가져오기(I2, D-I2-09)는 apps/server의 해석 함수 결과를 그대로 넘긴다.
// - 엔진(S02·S03, AC-S02-91·AC-S03-91)은 이름·모양만 바꾼다. 판정·합계·정산·효과 상태는 다시 계산하지 않고 조회 함수 결과를 그대로 옮긴다.
// - 이벤트의 구매자 키(buyer·replace·from·into)는 그 키의 구매자 자신의 ID로 바꿔 넘긴다(`sms:<ref>` → 그 ref의 처음 문자찜이 정한 구매자, README "이벤트 안의 구매자 키").
// - 문자찜의 phone(판매자가 적은 글자 그대로)은 서버처럼 phoneKey·phoneLast4로 바꿔 넘기고 phone은 넘기지 않는다(README "규칙", D-061, phone-key.ts).
// - 관찰 스냅샷의 구매자는 지금의 구매자다. buyerKeys = 키 → 지금의 구매자.
// - broadcast.start·broadcast.end는 그대로 넘기고(사본도), 관찰 스냅샷의 방송은 listBroadcasts의 날짜·제목·끝남이다(S04, AC-S04-91).
// - 합치기 미리 보기(S06b, D-100)는 코어 previewMerge 결과에서 비교할 필드(막힘·확정 둘·옮길 찜·합친 뒤·중복의 상품·구매자 자신·상태)만 옮긴다.
//   러너는 from·into를 관찰 스냅샷의 buyerSelf(키 → 구매자 자신, buyerIdOf와 같은 풀이)로 풀어 넘긴다.
// - 효과 보고 이벤트의 (상품, 구매자[, 대상]) → 효과 ID 연결은 README 규칙("가장 최근에 나온, 취소되지 않은 해당 효과",
//   상품 키는 효과가 나온 때의 것, 구매자는 지금의 구매자로 비교)대로 조회 함수로 찾는다.
import {
  applyEvent,
  buyerOfRef,
  checkInvariants,
  currentBuyerOf,
  initEngine,
  listBroadcasts,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  listSmsRefs,
  parseAmount,
  parseChat,
  parseKoreanNumber,
  parseQuickInput,
  previewMerge,
  type EngineEvent,
  type EngineState,
} from '@livejjim/core'
// 음성 추출기 (P2, D-209): 추출기는 packages/voice에 있다. 코어 src는 음성 패키지에 기대지 않고, 골든 어댑터(시험 코드)만 부른다.
// 워크스페이스 의존으로 적으면 core ↔ voice가 서로 기대는 고리가 되어(voice는 코어 파서를 쓴다) 상대 경로로 추출 모듈만 가져온다.
import { extractVoice } from '../../../voice/src/extract.ts'
// 상품 목록 가져오기 해석 함수 (I2, D-I2-09): 서버(apps/server)의 순수 함수다(코어만 import). 코어 src는 서버에 기대지 않고, 골든 어댑터(시험 코드)만
// 상대 경로로 그 모듈 하나를 부른다 — 워크스페이스 의존으로 적으면 core ↔ server가 서로 기대는 고리가 된다(D-209와 같은 방식).
import { parseProductList } from '../../../../apps/server/src/product-import.ts'
import { SMS_PREFIX } from './contract.ts'
import { smsPhoneFields } from './phone-key.ts'
import type { BroadcastView, BuyerView, ClaimView, EffectView, GoldenCore, GoldenEvent, GoldenSnapshot, MergePreviewView, ProductView, SettlementView } from './types.ts'

/** 이벤트 안의 구매자 키 필드 (README "이벤트 안의 구매자 키") */
const BUYER_KEY_FIELDS = ['buyer', 'replace', 'from', 'into'] as const

/**
 * 구매자 키 → 그 키의 구매자 자신의 ID. 유튜브 채널 ID는 그대로, `sms:<ref>`는 그 ref의 처음 문자찜이 정한 구매자(재전송 사본은 바꾸지 않는다).
 * 구매자를 정하지 않은 문자찜(모르는 지정 구매자)의 키는 풀리지 않으므로 키 그대로 넘긴다 — 엔진에는 모르는 구매자다
 * (문자 구매자 ID는 `sms:<그 구매자를 만든 ref>`라서, 구매자를 만들지 않은 ref의 키와 겹치지 않는다).
 */
export function buyerIdOf(state: EngineState, key: string): string {
  if (!key.startsWith(SMS_PREFIX)) return key
  return buyerOfRef(state, key.slice(SMS_PREFIX.length)) ?? key
}

/** 효과 보고 이벤트가 가리키는 효과 ID (없으면 undefined — 러너가 먼저 러너 오류로 잡는다) */
export function reportTarget(state: EngineState, event: GoldenEvent): string | undefined {
  const kind = event.type === 'effect.labelPrinted' ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
  const target = event.type === 'effect.thanksSent' ? (typeof event.target === 'string' ? event.target : 'LIVE_CHAT') : null
  const product = `${String(event.b)}/${String(event.no)}`
  const buyer = currentBuyerOf(state, buyerIdOf(state, String(event.buyer)))
  return listEffects(state).findLast(
    (effect) => effect.kind === kind && effect.product === product && effect.currentBuyer === buyer && effect.target === target && effect.status !== 'CANCELLED',
  )?.id
}

/**
 * 골든 이벤트 → 엔진 이벤트. 필드 이름은 README와 같으므로 구매자 키만 구매자 자신의 ID로, 효과 보고만 효과 ID로,
 * 문자찜의 phone만 서버처럼 phoneKey·phoneLast4로 바꾼다(판정·합계는 다시 계산하지 않는다)
 */
export function toEngineEvent(state: EngineState, event: GoldenEvent): EngineEvent {
  if (event.type === 'effect.labelPrinted' || event.type === 'effect.thanksSent') {
    const effectId = reportTarget(state, event)
    if (effectId === undefined) throw new Error(`효과 보고 대상이 없다: ${event.type} ${String(event.b)}/${String(event.no)} ${String(event.buyer)}`)
    return { seq: event.seq, at: event.at, type: event.type, effectId }
  }
  const keyed = BUYER_KEY_FIELDS.filter((field) => typeof event[field] === 'string' && (event[field] as string).startsWith(SMS_PREFIX))
  if (keyed.length === 0 && event.type !== 'sms') return event as unknown as EngineEvent
  const { phone, ...rest } = event
  const mapped: Record<string, unknown> = event.type === 'sms' ? { ...rest, ...smsPhoneFields(phone as string | undefined) } : { ...event }
  for (const field of keyed) mapped[field] = buyerIdOf(state, event[field] as string)
  return mapped as unknown as EngineEvent
}

/** 엔진 상태 → 골든 관찰 스냅샷 (이름·모양만 바꾼다) */
export function toSnapshot(state: EngineState): GoldenSnapshot {
  // 방송: 조회 함수의 날짜·제목·끝났는지 그대로 (S04, D-070)
  const broadcasts: Record<string, BroadcastView> = {}
  for (const broadcast of listBroadcasts(state)) broadcasts[broadcast.id] = { date: broadcast.date, title: broadcast.title, ended: broadcast.ended }
  const buyers = listBuyers(state)
  const products: Record<string, ProductView> = {}
  for (const product of listProducts(state)) {
    products[product.key] = {
      status: product.status,
      winners: product.winners,
      waitlist: product.waitlist,
      conflict: product.conflict,
      price: product.price,
      priceHistory: product.priceHistory.map(({ from, to }) => ({ from, to })),
    }
  }
  const buyerViews: Record<string, BuyerView> = {}
  for (const buyer of buyers) {
    buyerViews[buyer.id] = {
      display: buyer.display,
      nameHistory: buyer.nameHistory,
      items: buyer.items,
      subtotal: buyer.subtotal,
      byBroadcast: buyer.byBroadcast,
      phoneLast4: buyer.phoneLast4,
    }
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
      buyer: effect.currentBuyer,
      ...(effect.text === null ? {} : { text: effect.text }),
      confirmVersion: effect.confirmVersion,
    }),
  )
  const claims = listClaims(state).map(
    (claim): ClaimView => ({ product: claim.product, buyer: claim.currentBuyer, status: claim.status, ...(claim.reason === null ? {} : { reason: claim.reason }) }),
  )
  const pending: Record<string, readonly string[]> = {}
  for (const entry of listPending(state)) pending[entry.product] = entry.buyers
  // 구매자 키 → 지금의 구매자: 유튜브 채널 ID와 구매자를 정한 문자찜의 `sms:<ref>`
  const buyerKeys: Record<string, string> = {}
  for (const buyer of buyers) if (buyer.kind === 'youtube') buyerKeys[buyer.id] = buyer.current
  for (const ref of listSmsRefs(state)) buyerKeys[`${SMS_PREFIX}${ref.ref}`] = ref.currentBuyer
  // 같은 키 → 그 키의 구매자 자신 (이벤트의 구매자 키와 같은 풀이 buyerIdOf, S06b mergePreviews)
  const buyerSelf: Record<string, string> = {}
  for (const key of Object.keys(buyerKeys)) buyerSelf[key] = buyerIdOf(state, key)
  return {
    buyerKeys,
    buyerSelf,
    broadcasts,
    products,
    buyers: buyerViews,
    settlements,
    effects,
    claims,
    pending,
    cancelRequests: listCancelRequests(state).map((request) => ({ product: request.product, buyer: request.currentBuyer })),
  }
}

/** 코어 previewMerge 결과 → 골든 비교 모양 (이름·모양만 바꾼다 — 찜 ID·남는 찜·옮길 구매자 목록·target은 비교하지 않아 뺀다) */
export function toMergePreviewView(state: EngineState, from: string, into: string): MergePreviewView {
  const preview = previewMerge(state, from, into)
  return {
    blocked: preview.blocked,
    bothConfirmed: preview.bothConfirmed,
    moving: { items: preview.moving.items, subtotal: preview.moving.subtotal },
    after: preview.after === null ? null : { items: preview.after.items, subtotal: preview.after.subtotal },
    duplicates: preview.duplicates.map(({ product, buyer, status }) => ({ product, buyer, status })),
  }
}

export const realCore: GoldenCore = {
  parser: {
    chat: (text, settings) => parseChat(text, settings),
    amount: (text, settings) => parseAmount(text, settings),
    koreanNumber: (text) => parseKoreanNumber(text),
    quickInput: (text, settings) => parseQuickInput(text, settings),
    // 결과를 바꾸지 않고 그대로 넘긴다. price.unit은 넘기지 않는다 — 추출은 원 단위(R-17 4, D-202)
    voiceExtract: (text, settings, dictionary) => extractVoice(text, { maxNumber: settings['claim.maxNumber'], dictionary }),
    // 결과를 바꾸지 않고 그대로 넘긴다. 빠진 설정은 해석 함수가 DOMAIN_RULES 기본값(THOUSAND·999)을 쓴다
    productImport: (text, settings, existing) => parseProductList(text, { unit: settings['price.unit'], maxNumber: settings['claim.maxNumber'], existing }),
  },
  engine: {
    start: (setup) => initEngine(setup),
    apply: (state, event) => applyEvent(state as EngineState, toEngineEvent(state as EngineState, event)),
    observe: (state) => toSnapshot(state as EngineState),
    invariants: (state) => checkInvariants(state as EngineState),
    previewMerge: (state, from, into) => toMergePreviewView(state as EngineState, from, into),
  },
}
