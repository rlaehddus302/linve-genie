// 판정 리듀서 apply(state, event) → { state, effects } (R-0). 순수·전체 함수다.
// - 넘긴 상태·이벤트를 바꾸지 않는다. 같은 설정·같은 이벤트 열이면 같은 결과(INV-4).
// - 맞지 않는 명령(없는 방송·상품·찜, 조건이 안 맞는 조치, 형식이 틀린 필드)은 아무것도 바꾸지 않는다(D-039, AC-S02-03).
//   입력 우선 기록(DAT-02)이라 이런 이벤트도 엔진까지 오고, 예외를 던지면 재생 전체가 멈추기 때문이다.
// - S03 기능은 NotImplementedError 하나로 알린다(D-037, AC-S02-04). 조용히 무시하거나 다른 값으로 처리하지 않는다.
import { NotImplementedError } from '../not-implemented.ts'
import { parseChat } from '../parse/chat.ts'
import { resolveSettings } from '../settings.ts'
import { Draft, messageKey, ownGet, slotKey, type ClaimDraft, type SlotDraft } from './draft.ts'
import { emptyPMap } from './pmap.ts'
import { clearWaitlist, confirm, decide, finish, openPending, place, release, settleAwaiting, unconfirm, voidLabel } from './rules.ts'
import type {
  ApplyResult,
  ChatEvent,
  EffectReportEvent,
  EngineEvent,
  EngineSetup,
  EngineState,
  HostAssignEvent,
  HostBlockEvent,
  HostClaimEvent,
  HostClaimOptionalReasonEvent,
  HostReopenEvent,
  ProductCommandEvent,
  ProductRecord,
  ProductRegisterEvent,
} from './types.ts'

// ── S03 경계 (D-037) ─────────────────────────────────────────────────────

/** S03 이후에 구현하는 이벤트 → 보고용 기능 이름 */
const DEFERRED_EVENTS: Readonly<Record<string, string>> = {
  sms: '문자찜(sms, ORD-08) — S03',
  'product.update': '상품 수정(product.update, R-10) — S03',
  'product.renumber': '번호 변경(product.renumber, R-10) — S03',
  'host.convertMessage': '메시지를 찜으로 바꾸기(host.convertMessage, R-7.4) — S03',
  'host.resolveConflict': '충돌 해결(host.resolveConflict, R-7) — S03',
  'buyer.merge': '구매자 합치기(buyer.merge, R-11) — S03',
  'buyer.unmerge': '구매자 합치기 되돌리기(buyer.unmerge, R-11) — S03',
  'settlement.shippingOverride': '배송비 예외(settlement.shippingOverride, R-12) — S03',
  'settlement.adjust': '정산 조정(settlement.adjust, R-12) — S03',
  'settlement.payment': '입금 기록(settlement.payment, R-12) — S03',
  'settlement.refund': '환불 기록(settlement.refund, R-12) — S03',
  // R-1에 있지만 처음 쓰는 스프린트에서 형식을 정한다 (README 이벤트 표 아래 메모)
  'broadcast.start': '방송 시작(broadcast.start, R-1) — S04',
  'broadcast.end': '방송 종료(broadcast.end, R-1) — S04',
  'effect.failed': '효과 실패 보고(effect.failed, R-13) — S11',
}

// ── 시작 ─────────────────────────────────────────────────────────────────

/**
 * 새 엔진 상태. settings는 DOMAIN_RULES 기본값 위에 덮어쓴다(resolveSettings).
 * S03 설정(contention.policy=RECEIVED_TIME, settlement.groupBy=MANUAL)이면 NotImplementedError.
 * 방송 ID가 비었거나 겹치면 TypeError — 시작 설정은 서버가 만드는 값이라 잘못되면 프로그램 오류다.
 */
export function initEngine(setup: EngineSetup): EngineState {
  const settings = resolveSettings(setup.settings)
  if (settings['contention.policy'] === 'RECEIVED_TIME') throw new NotImplementedError('실제 시각순 판정(contention.policy=RECEIVED_TIME, R-6·R-7) — S03')
  if (settings['settlement.groupBy'] === 'MANUAL') throw new NotImplementedError('정산 직접 묶기(settlement.groupBy=MANUAL, R-12) — S03')
  const seen = new Set<string>()
  const broadcasts = setup.broadcasts.map(({ id, date, title }) => {
    if (typeof id !== 'string' || id === '' || seen.has(id)) throw new TypeError(`방송 ID는 겹치지 않는 빈 문자열이 아닌 값이어야 한다 (값: ${String(id)})`)
    seen.add(id)
    return { id, date, title }
  })
  return {
    format: 1,
    broadcasts,
    settings,
    counters: { claims: 0, effects: 0, buyers: 0 },
    messages: emptyPMap(),
    buyers: emptyPMap(),
    blocked: emptyPMap(),
    slots: emptyPMap(),
    claims: emptyPMap(),
    effects: emptyPMap(),
  }
}

// ── 이벤트 형식 검사 ─────────────────────────────────────────────────────

type Check = (value: unknown) => boolean

const isId: Check = (v) => typeof v === 'string' && v !== ''
const isText: Check = (v) => typeof v === 'string'
const isNo: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 1
const isMoney: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 0
const isBool: Check = (v) => typeof v === 'boolean'
const isTime: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const oneOf =
  (...choices: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && choices.includes(v)

interface Handler {
  readonly required: Readonly<Record<string, Check>>
  readonly optional?: Readonly<Record<string, Check>>
  readonly handle: (d: Draft, event: never) => void
}

const BY_PRODUCT = { b: isId, no: isNo }
const BY_CLAIM = { b: isId, no: isNo, buyer: isId }

function wellFormed(state: EngineState, event: Readonly<Record<string, unknown>>, handler: Handler): boolean {
  if (!Number.isSafeInteger(event.seq) || !isTime(event.at)) return false
  for (const [field, check] of Object.entries(handler.required)) if (!check(event[field])) return false
  for (const [field, check] of Object.entries(handler.optional ?? {})) if (event[field] !== undefined && !check(event[field])) return false
  // 선언하지 않은 방송의 이벤트는 아무것도 바꾸지 않는다 (AC-S02-03)
  return !('b' in handler.required) || state.broadcasts.some((broadcast) => broadcast.id === event.b)
}

// ── 상품 명령 (R-2 "상품 명령 세부", D-039) ──────────────────────────────

function register(d: Draft, e: ProductRegisterEvent): void {
  if (d.readSlot(slotKey(e.b, e.no))?.product) return
  const slot = d.slot(e.b, e.no)
  const phase = e.status === 'READY' ? 'READY' : 'SELLING'
  slot.product = { name: e.name, price: e.price, stock: e.stock ?? 1, phase, priceHistory: [] }
  if (phase === 'SELLING') openPending(d, slot, e.at)
}

function productCommand(d: Draft, e: ProductCommandEvent): void {
  const current = d.readSlot(slotKey(e.b, e.no))
  if (current === undefined || current.product === null) return
  const product = current.product
  const { phase } = product
  if (e.type === 'product.open') {
    if (phase === 'SELLING') return
    const slot = d.slot(e.b, e.no)
    slot.product = { ...product, phase: 'SELLING' }
    openPending(d, slot, e.at)
    return
  }
  if (e.type === 'product.hold') {
    if (phase !== 'SELLING') return
    d.slot(e.b, e.no).product = { ...product, phase: 'HOLD' }
    return
  }
  // close: 확정·대기 찜이 없을 때만. 그 번호의 보류 찜은 REJECTED(NOT_ON_SALE)
  if (phase === 'CLOSED' || current.winners.length > 0 || current.waitlist.length > 0) return
  const slot = d.slot(e.b, e.no)
  slot.product = { ...product, phase: 'CLOSED' }
  for (const id of slot.pending) finish(d.claim(id), slot, 'REJECTED', 'NOT_ON_SALE')
  slot.pending = []
}

// ── 채팅 (R-4 머리말 "채팅 메시지에서 찜까지", D-045) ────────────────────

function chat(d: Draft, e: ChatEvent): void {
  const key = messageKey(e.b, e.id)
  // ① 재수신: 본문·닉네임이 달라도 아무 일도 없다 (INV-3·INV-12)
  if (d.hasMessage(key)) return
  d.addMessage(key)
  // ② 방송자 본인 메시지 + claim.ignoreOwner
  if (e.owner === true && d.settings['claim.ignoreOwner']) return
  // ③ 구매자 기록·닉네임 갱신 (R-11, 주문이 아닌 메시지도)
  const buyer = d.buyer(e.ch)
  if (buyer === undefined) d.newBuyer(e.ch, e.nick)
  else if (buyer.display !== e.nick) {
    buyer.display = e.nick
    buyer.names.push(e.nick)
  }
  // ④ 그 방송 설정으로 R-3 → 주문 번호마다 나온 순서대로 R-4, 취소는 R-8, 언급은 아무것도 바꾸지 않는다
  const parsed = parseChat(e.text, d.settings)
  for (const no of parsed.claims) claimFromChat(d, e.b, no, e.ch)
  for (const no of parsed.cancels) viewerCancel(d, e.b, no, e.ch)
}

function claimFromChat(d: Draft, b: string, no: number, buyer: string): void {
  const outcome = decide(d, d.readSlot(slotKey(b, no)), buyer)
  if (outcome.kind === 'none') return
  const fields = { seq: d.seq, at: d.at, b, no, key: slotKey(b, no), buyer, origin: 'chat' as const }
  const claim = d.newClaim({ ...fields, status: 'PENDING', reason: null, price: null, version: null, locked: false, request: null, effects: [] })
  // 거절(차단·판매 아님·품절)은 번호에 아무것도 남기지 않는다. 상품도 보류 찜도 없는 번호를 새로 만들지 않는다
  if (outcome.kind === 'reject') {
    claim.status = 'REJECTED'
    claim.reason = outcome.reason
    return
  }
  place(d, claim, d.slot(b, no), outcome)
}

/** R-8 "시청자 채팅 취소"·"취소 요청 세부" (D-043) */
function viewerCancel(d: Draft, b: string, no: number, buyer: string): void {
  const mode = d.settings['cancel.buyerChat']
  if (mode === 'OFF') return
  const current = activeClaim(d, b, no, buyer)
  if (current === undefined) return
  // AUTO: 잠금은 확정 찜에만 있다 → 잠긴 확정 찜만 요청, 나머지(잠금 전 확정·대기·보류)는 바로 방송자 취소와 같게
  if (mode === 'AUTO' && !(current.status === 'CONFIRMED' && current.locked)) {
    release(d, d.claim(current.id), d.slot(b, no), 'CANCELLED', null)
    return
  }
  if (current.request === null) d.claim(current.id).request = d.seq
}

function activeClaim(d: Draft, b: string, no: number, buyer: string): ReturnType<Draft['readClaim']> {
  const slot = d.readSlot(slotKey(b, no))
  const id = slot === undefined ? undefined : ownGet(slot.active, buyer)
  return id === undefined ? undefined : d.readClaim(id)
}

// ── 방송자 조치 (R-8, R-9, D-040~D-043) ──────────────────────────────────

/** host.cancel → CANCELLED, host.reject → REJECTED(BY_HOST). 활성 찜이 없으면 아무 일도 없다 */
function hostRelease(d: Draft, e: HostClaimEvent): void {
  const current = activeClaim(d, e.b, e.no, e.buyer)
  if (current === undefined) return
  const [status, reason] = e.type === 'host.reject' ? (['REJECTED', 'BY_HOST'] as const) : (['CANCELLED', null] as const)
  release(d, d.claim(current.id), d.slot(e.b, e.no), status, reason)
}

/** host.promote: 자리가 비어 있고 대상이 대기 찜일 때만 확정 (대기 몇 순위든) */
function promote(d: Draft, e: HostClaimEvent): void {
  const now = d.readSlot(slotKey(e.b, e.no))
  const current = activeClaim(d, e.b, e.no, e.buyer)
  if (now === undefined || current?.status !== 'WAITLISTED') return
  // 대기 찜이 있는 번호에는 상품이 있다 (대기는 판매 중인 상품에서 생기고, 대기가 남은 상품은 닫히지 않는다)
  const product = now.product as ProductRecord
  if (now.winners.length >= product.stock) return
  const slot = d.slot(e.b, e.no)
  slot.waitlist.splice(slot.waitlist.indexOf(current.id), 1)
  confirm(d, d.claim(current.id), slot, product)
  settleAwaiting(slot)
}

/** host.confirm: 확정 찜에 잠금만 건다 (R-7.3). host.approveCancel·host.dismissCancel: 처리 대기 요청이 있을 때만 */
function claimAction(d: Draft, e: HostClaimOptionalReasonEvent): void {
  const current = activeClaim(d, e.b, e.no, e.buyer)
  if (current === undefined) return
  if (e.type === 'host.confirm') {
    if (current.status === 'CONFIRMED' && !current.locked) d.claim(current.id).locked = true
    return
  }
  if (current.request === null) return
  if (e.type === 'host.dismissCancel') d.claim(current.id).request = null
  else release(d, d.claim(current.id), d.slot(e.b, e.no), 'CANCELLED', null)
}

/** host.reopen: "승계 결정 필요" 표시가 있을 때만 REOPEN 규칙 (D-041) */
function reopen(d: Draft, e: HostReopenEvent): void {
  if (d.readSlot(slotKey(e.b, e.no))?.awaiting !== true) return
  clearWaitlist(d, d.slot(e.b, e.no))
}

/** host.assign: 직접 배정·1등 교체 (R-9, D-042) */
function assign(d: Draft, e: HostAssignEvent): void {
  const current = d.readSlot(slotKey(e.b, e.no))
  const product = current?.product
  if (current === undefined || product === null || product === undefined || product.phase !== 'SELLING') return
  if (d.readBuyer(e.buyer) === undefined) return
  const replace = e.replace
  const replaceTo = e.replaceTo
  if ((replace === undefined) !== (replaceTo === undefined)) return
  const own = activeClaim(d, e.b, e.no, e.buyer)
  if (own !== undefined && own.status !== 'WAITLISTED') return
  let target: ClaimDraft | undefined
  if (replace !== undefined) {
    const winner = activeClaim(d, e.b, e.no, replace)
    if (winner?.status !== 'CONFIRMED') return
    target = d.claim(winner.id)
  } else if (current.winners.length >= product.stock) return
  const slot = d.slot(e.b, e.no)
  // 그 구매자의 대기 찜이 있으면 먼저 대기에서 빠져 확정된다(새 찜 없음, INV-2). 없으면 새 확정 찜
  let claim: ClaimDraft
  if (own === undefined) {
    const fields = { seq: d.seq, at: d.at, b: e.b, no: e.no, key: slot.key, buyer: e.buyer, origin: 'assign' as const }
    claim = d.newClaim({ ...fields, status: 'PENDING', reason: null, price: null, version: null, locked: false, request: null, effects: [] })
  } else {
    slot.waitlist.splice(slot.waitlist.indexOf(own.id), 1)
    claim = d.claim(own.id)
  }
  if (target !== undefined) replaceWinner(d, target, slot, replaceTo === 'CANCEL')
  confirm(d, claim, slot, product)
  // 교체된 1등이 대기로 들어가 한도를 넘으면 맨 끝 대기자부터 품절 (차단 중인 1등은 대기에 들어가지 않아 넘치지 않는다, D-049)
  const max = d.settings['waitlist.max']
  while (slot.waitlist.length > 0 && slot.waitlist.length > max) finish(d.claim(slot.waitlist.pop() as string), slot, 'REJECTED', 'SOLD_OUT')
  settleAwaiting(slot)
}

/**
 * 교체: 그 1등의 확정을 풀고(R-13) 취소하거나 대기 1순위로 넣는다. release()와 달리 승계는 없다 — 빈 자리는 배정받는 구매자가 채운다.
 * 차단 중인 구매자의 찜은 대기에 들어가지 않는다(D-049): 대기 대신 REJECTED(BLOCKED), 대기가 늘지 않으니 넘침 정리도 없다
 */
function replaceWinner(d: Draft, target: ClaimDraft, slot: SlotDraft, cancel: boolean): void {
  unconfirm(d, target, slot)
  if (cancel) {
    finish(target, slot, 'CANCELLED', null)
    return
  }
  if (d.isBlocked(target.buyer)) {
    finish(target, slot, 'REJECTED', 'BLOCKED')
    return
  }
  target.status = 'WAITLISTED'
  target.reason = null
  slot.waitlist.unshift(target.id)
}

/** host.blockBuyer: 대기·보류 찜은 모두 REJECTED(BLOCKED), 확정 찜은 그대로 (D-040). host.unblockBuyer: 새 찜만 다시 받는다 */
function block(d: Draft, e: HostBlockEvent): void {
  const blocked = d.isBlocked(e.buyer)
  if (e.type === 'host.unblockBuyer') {
    if (blocked) d.setBlocked(e.buyer, false)
    return
  }
  if (blocked) return
  d.setBlocked(e.buyer, true)
  for (const id of d.readBuyer(e.buyer)?.claims ?? []) {
    const record = d.readClaim(id)
    if (record === undefined || (record.status !== 'WAITLISTED' && record.status !== 'PENDING')) continue
    const slot = d.slot(record.b, record.no)
    const list = record.status === 'WAITLISTED' ? slot.waitlist : slot.pending
    list.splice(list.indexOf(id), 1)
    finish(d.claim(id), slot, 'REJECTED', 'BLOCKED')
    settleAwaiting(slot)
  }
}

// ── 효과 보고 (R-13 "효과 보고", D-044) ──────────────────────────────────

function report(d: Draft, e: EffectReportEvent): void {
  const effect = d.readEffect(e.effectId)
  const kind = e.type === 'effect.labelPrinted' ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
  // 모르는 효과 ID, 종류가 다른 보고, 이미 완료된 효과(INV-11)는 아무 일도 없다
  if (effect === undefined || effect.kind !== kind || effect.status === 'DONE') return
  const claim = d.claim(effect.claim)
  d.effect(effect).status = 'DONE'
  if (effect.status === 'PENDING') {
    // 지금 확정(확정버전)의 효과면 잠금 (R-7.3). 잠금은 확정 하나에 대한 것이다
    if (claim.status === 'CONFIRMED' && claim.version === effect.version) claim.locked = true
    return
  }
  // 취소된 효과의 늦은 보고: 실행 완료로 기록, 잠금 없음, 라벨이면 VOID_LABEL (잘못된 이름의 라벨이 남지 않게)
  if (kind === 'PRINT_PRODUCT_LABEL') voidLabel(d, claim, effect.version)
}

// ── 이벤트 표 ────────────────────────────────────────────────────────────

const HANDLERS: Readonly<Record<string, Handler>> = {
  'product.register': {
    required: { b: isId, no: isNo, name: isText, price: isMoney },
    optional: { stock: isNo, status: oneOf('OPEN', 'READY') },
    handle: register,
  },
  'product.open': { required: BY_PRODUCT, handle: productCommand },
  'product.hold': { required: BY_PRODUCT, handle: productCommand },
  'product.close': { required: BY_PRODUCT, handle: productCommand },
  chat: {
    required: { b: isId, id: isId, ch: isId, nick: isText, text: isText },
    optional: { owner: isBool, publishedAt: isTime },
    handle: chat,
  },
  'host.cancel': { required: BY_CLAIM, handle: hostRelease },
  'host.reject': { required: BY_CLAIM, handle: hostRelease },
  'host.promote': { required: BY_CLAIM, handle: promote },
  'host.confirm': { required: BY_CLAIM, handle: claimAction },
  'host.approveCancel': { required: BY_CLAIM, handle: claimAction },
  'host.dismissCancel': { required: BY_CLAIM, handle: claimAction },
  'host.assign': { required: BY_CLAIM, optional: { replace: isId, replaceTo: oneOf('WAITLIST', 'CANCEL') }, handle: assign },
  'host.reopen': { required: BY_PRODUCT, handle: reopen },
  'host.blockBuyer': { required: { buyer: isId }, handle: block },
  'host.unblockBuyer': { required: { buyer: isId }, handle: block },
  'effect.labelPrinted': { required: { effectId: isId }, handle: report },
  'effect.thanksSent': { required: { effectId: isId }, handle: report },
}

/**
 * apply(state, event) → { state, effects } (R-0).
 * effects = 이 이벤트로 새로 나온 효과. 효과의 취소·완료는 상태에 남고 조회 함수(listEffects)로 본다.
 * 모르는 이벤트 종류·형식이 틀린 이벤트는 아무것도 바꾸지 않는다. S03 이벤트는 NotImplementedError.
 */
export function applyEvent(state: EngineState, event: EngineEvent): ApplyResult {
  if (typeof event !== 'object' || event === null) return { state, effects: [] }
  const type: unknown = event.type
  if (typeof type !== 'string') return { state, effects: [] }
  const deferred = ownGet(DEFERRED_EVENTS, type)
  if (deferred !== undefined) throw new NotImplementedError(deferred)
  const handler = ownGet(HANDLERS, type)
  const record = event as unknown as Readonly<Record<string, unknown>>
  if (handler === undefined || !wellFormed(state, record, handler)) return { state, effects: [] }
  const draft = new Draft(state, event)
  ;(handler.handle as (d: Draft, e: EngineEvent) => void)(draft, event)
  return draft.commit()
}

