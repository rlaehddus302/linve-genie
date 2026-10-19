// 판정 리듀서 apply(state, event) → { state, effects } (R-0). 순수 함수다.
// - 넘긴 상태·이벤트를 바꾸지 않는다. 같은 설정·같은 이벤트 열이면 같은 결과(INV-4).
// - 입력 오류(형식이 틀린 이벤트)는 상태를 바꾸지 않고 InvalidEventError를 던진다(D-050). 같은 검사를 checkEvent로 내보낸다.
// - 맞지 않는 명령(없는 상품·찜·메시지, 조건이 안 맞는 조치)은 아무것도 바꾸지 않는다(D-039, AC-S03-04).
// - 처음 쓰는 스프린트가 따로 있는 기능(broadcast.*·effect.failed, settlement.groupBy=MANUAL)은 NotImplementedError로 알린다.
import { NotImplementedError } from '../not-implemented.ts'
import { parseChat } from '../parse/chat.ts'
import { resolveSettings } from '../settings.ts'
import { CorruptStateError, Draft, claimNumber, messageKey, ownGet, slotKey, type ClaimDraft, type SlotDraft } from './draft.ts'
import { receivedOf, receivedOfMembers } from './ledger.ts'
import { normalizePhone } from './phone.ts'
import { emptyPMap, pdelete, pget, pkeys, pset } from './pmap.ts'
import {
  SMS_NAME,
  activeClaim,
  clearWaitlist,
  compareClaims,
  confirm,
  decide,
  detach,
  displace,
  enter,
  finish,
  groupReceived,
  isActive,
  isLocked,
  labelPrinted,
  openPending,
  release,
  resolveKeep,
  resolveSwitch,
  settleAwaiting,
  trimWaitlist,
  unconfirm,
  voidLabel,
} from './rules.ts'
import { resolveReceivedTime, type ReceivedTime } from './time.ts'
import { DEFERRED_EVENTS, InvalidEventError, checkEvent } from './validate.ts'
import type {
  ApplyResult,
  BuyerMergeEvent,
  BuyerRecord,
  BuyerUnmergeEvent,
  ChatEvent,
  ClaimOrigin,
  ClaimRecord,
  EffectReportEvent,
  EngineEvent,
  EngineSetup,
  EngineState,
  HostAssignEvent,
  HostBlockEvent,
  HostClaimEvent,
  HostClaimOptionalReasonEvent,
  HostConvertMessageEvent,
  HostReopenEvent,
  HostResolveConflictEvent,
  ProductCommandEvent,
  ProductRecord,
  ProductRegisterEvent,
  ProductRenumberEvent,
  ProductUpdateEvent,
  SettlementAdjustEvent,
  SettlementEntry,
  SettlementPaymentEvent,
  SettlementRefundEvent,
  SettlementShippingEvent,
  SmsEvent,
} from './types.ts'

// ── 시작 ─────────────────────────────────────────────────────────────────

/**
 * 새 엔진 상태. settings는 DOMAIN_RULES 기본값 위에 덮어쓴다(resolveSettings).
 * settlement.groupBy=MANUAL이면 NotImplementedError(D-059).
 * 방송 ID가 비었거나 겹치면 TypeError — 시작 설정은 서버가 만드는 값이라 잘못되면 프로그램 오류다.
 */
export function initEngine(setup: EngineSetup): EngineState {
  const settings = resolveSettings(setup.settings)
  if (settings['settlement.groupBy'] === 'MANUAL') throw new NotImplementedError('정산 직접 묶기(settlement.groupBy=MANUAL, R-12) — 묶음을 정하는 화면과 함께 정한다(D-059)')
  const seen = new Set<string>()
  const broadcasts = setup.broadcasts.map(({ id, date, title }) => {
    if (typeof id !== 'string' || id === '' || seen.has(id)) throw new TypeError(`방송 ID는 겹치지 않는 빈 문자열이 아닌 값이어야 한다 (값: ${String(id)})`)
    seen.add(id)
    return { id, date, title }
  })
  return {
    format: 2,
    broadcasts,
    settings,
    counters: { claims: 0, effects: 0, buyers: 0, products: 0 },
    messages: emptyPMap(),
    refs: emptyPMap(),
    phones: emptyPMap(),
    buyers: emptyPMap(),
    blocked: emptyPMap(),
    slots: emptyPMap(),
    products: emptyPMap(),
    claims: emptyPMap(),
    effects: emptyPMap(),
    ledger: emptyPMap(),
  }
}

// ── 새 찜 ────────────────────────────────────────────────────────────────

interface ClaimSource {
  readonly b: string
  readonly no: number
  /** 구매자 자신 */
  readonly buyer: string
  readonly origin: ClaimOrigin
  readonly seq: number
  readonly at: number
  readonly time: number
  readonly minute: boolean
  readonly message: string | null
  readonly ref: string | null
  readonly received: string | null
}

/**
 * R-4로 판정해 새 찜을 만든다. 4번 줄(같은 사람 반복)이면 찜을 만들지 않고 null.
 * 거절(차단·판매 아님)은 번호에 아무것도 남기지 않는다 — 상품도 보류 찜도 없는 번호 기록을 새로 만들지 않는다.
 */
function makeClaim(d: Draft, source: ClaimSource): ClaimDraft | null {
  const key = slotKey(source.b, source.no)
  const current = d.readSlot(key)
  const outcome = decide(d, current, source.buyer)
  if (outcome.kind === 'none') return null
  const claim = d.newClaim({
    seq: source.seq,
    at: source.at,
    time: source.time,
    minute: source.minute,
    b: source.b,
    no: source.no,
    key,
    pid: null,
    buyer: source.buyer,
    origin: source.origin,
    message: source.message,
    ref: source.ref,
    received: source.received,
    status: 'PENDING',
    reason: null,
    price: null,
    version: null,
    locked: false,
    request: null,
    effects: [],
    reprint: false,
    priceHistory: [],
  })
  if (outcome.kind === 'reject') {
    claim.status = 'REJECTED'
    claim.reason = outcome.reason
    claim.pid = current?.product?.id ?? null
    return claim
  }
  enter(d, claim, d.slot(source.b, source.no), outcome)
  return claim
}

// ── 상품 명령 (R-2 "상품 명령 세부", D-039) ──────────────────────────────

function register(d: Draft, e: ProductRegisterEvent): void {
  if (d.readSlot(slotKey(e.b, e.no))?.product) return
  const slot = d.slot(e.b, e.no)
  const phase = e.status === 'READY' ? 'READY' : 'SELLING'
  const id = d.newProductId()
  slot.product = { id, name: e.name, price: e.price, stock: e.stock ?? 1, phase, priceHistory: [], nameHistory: [] }
  d.setProductKey(id, slot.key)
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
  // close: 확정·대기 찜이 없을 때만(충돌 찜은 확정이 찼을 때만 있다). 그 번호의 보류 찜은 REJECTED(NOT_ON_SALE)
  if (phase === 'CLOSED' || current.winners.length > 0 || current.waitlist.length > 0) return
  const slot = d.slot(e.b, e.no)
  slot.product = { ...product, phase: 'CLOSED' }
  const ids = pkeys(slot.pending).sort((a, b) => claimNumber(a) - claimNumber(b))
  slot.pending = emptyPMap()
  for (const id of ids) finish(d, d.claim(id), slot, 'REJECTED', 'NOT_ON_SALE')
}

/** 상품 수정 (R-10, D-055): 적힌 값을 한 번에. 재고를 확정 수보다 작게 하면 이벤트 전체가 아무 일도 없다 */
function update(d: Draft, e: ProductUpdateEvent): void {
  const current = d.readSlot(slotKey(e.b, e.no))
  const product = current?.product
  if (current === undefined || product === null || product === undefined) return
  const name = e.name !== undefined && e.name !== product.name ? e.name : undefined
  const price = e.price !== undefined && e.price !== product.price ? e.price : undefined
  const stock = e.stock !== undefined && e.stock !== product.stock ? e.stock : undefined
  if (stock !== undefined && stock < current.winners.length) return
  if (name === undefined && price === undefined && stock === undefined) return
  const slot = d.slot(e.b, e.no)
  const change = { seq: d.seq, at: d.at }
  slot.product = {
    ...product,
    ...(name === undefined ? {} : { name, nameHistory: [...product.nameHistory, { from: product.name, to: name, ...change }] }),
    ...(price === undefined ? {} : { price, priceHistory: [...product.priceHistory, { from: product.price, to: price, ...change }] }),
  }
  // 지금 확정 찜: UNPAID_CLAIMS면 입금 전(묶음 받은 금액 0) 찜의 스냅샷을 새 가격으로, 출력된 라벨이 있으면 재출력 필요
  const toUnpaid = price !== undefined && e.applyTo === 'UNPAID_CLAIMS'
  for (const id of slot.winners) {
    const record = d.readClaim(id)
    if (record === undefined) throw new CorruptStateError(`확정 찜 ${id}가 없다`)
    const reprice = toUnpaid && record.price !== price && groupReceived(d, record) === 0
    if (!reprice && name === undefined) continue
    const printed = labelPrinted(d, record)
    if (!reprice && !printed) continue
    const claim = d.claim(id)
    if (reprice) {
      const from = claim.price as number
      claim.price = price
      claim.priceHistory.push({ from, to: price, ...change })
      d.knownBuyer(claim.buyer).subtotal += price - from
    }
    if (printed) claim.reprint = true
  }
  if (stock !== undefined) {
    const added = stock - product.stock
    slot.product = { ...slot.product, stock }
    // 늘린 수만큼 대기 1순위부터 확정 (충돌이 있으면 먼저 풀린다). 승계 결정 필요 자리는 방송자 결정으로 남긴다
    if (added > 0) {
      resolveKeep(d, slot)
      for (let i = 0; i < added && slot.waitlist.length > 0; i++) confirm(d, d.claim(slot.waitlist.shift() as string), slot, slot.product)
    }
  }
  settleAwaiting(slot)
}

/** 번호 변경 (R-10, D-056) */
function renumber(d: Draft, e: ProductRenumberEvent): void {
  if (e.from === e.to) return
  if (!d.readSlot(slotKey(e.b, e.from))?.product) return
  if (d.readSlot(slotKey(e.b, e.to))?.product) return
  const from = d.slot(e.b, e.from)
  const product = from.product as ProductRecord
  // a의 확정·대기·충돌 찜은 잠금·입금과 상관없이 REJECTED(RENUMBERED). 승계 없음. 번호 a의 보류 찜은 그대로
  for (const id of [...from.winners]) {
    const claim = d.claim(id)
    unconfirm(d, claim, from)
    finish(d, claim, from, 'REJECTED', 'RENUMBERED')
  }
  const waiting = from.waitlist
  from.waitlist = []
  for (const id of waiting) finish(d, d.claim(id), from, 'REJECTED', 'RENUMBERED')
  if (from.conflict !== null) {
    const id = from.conflict
    from.conflict = null
    finish(d, d.claim(id), from, 'REJECTED', 'RENUMBERED')
  }
  from.awaiting = false
  // 상품은 품종·가격·재고·상태·이력·확정버전을 가지고 b로
  const to = d.slot(e.b, e.to)
  to.product = product
  to.version = from.version
  from.product = null
  from.version = 0
  d.setProductKey(product.id, to.key)
  if (product.phase === 'SELLING') openPending(d, to, e.at)
}

// ── 채팅 (R-4 머리말 "채팅 메시지에서 찜까지", D-045) ────────────────────

function chat(d: Draft, e: ChatEvent): void {
  const key = messageKey(e.b, e.id)
  // ① 재수신: 본문·닉네임이 달라도 아무 일도 없다 (INV-3·INV-12)
  if (d.readMessage(key) !== undefined) return
  // ② 방송자 본인 메시지 + claim.ignoreOwner (받은 메시지로는 기록한다 — 재수신·변환 판단)
  const ignored = e.owner === true && d.settings['claim.ignoreOwner']
  d.newMessage(key, { ch: e.ch, seq: d.seq, at: d.at, publishedAt: e.publishedAt ?? d.at, ignored, claimed: [] })
  if (ignored) return
  // ③ 구매자 기록·닉네임 갱신 (R-11, 주문이 아닌 메시지도)
  const known = d.readBuyer(e.ch)
  if (known === undefined) d.newBuyer(e.ch, 'youtube', e.nick, null)
  else if (known.display !== e.nick) {
    const buyer = d.knownBuyer(e.ch)
    buyer.display = e.nick
    buyer.names.push(e.nick)
  }
  // ④ 그 방송 설정으로 R-3 → 주문 번호마다 나온 순서대로 R-4, 취소는 R-8, 언급은 아무것도 바꾸지 않는다
  const parsed = parseChat(e.text, d.settings)
  const published = e.publishedAt ?? d.at
  for (const no of parsed.claims) {
    const claim = makeClaim(d, { b: e.b, no, buyer: e.ch, origin: 'chat', seq: d.seq, at: d.at, time: published, minute: false, message: key, ref: null, received: null })
    if (claim !== null) d.message(key).claimed.push(no)
  }
  for (const no of parsed.cancels) viewerCancel(d, e.b, no, e.ch)
}

/** R-8 "시청자 채팅 취소"·"취소 요청 세부" (D-043). 잠금은 확정 찜에만 있고 입금 기록을 포함한다 */
function viewerCancel(d: Draft, b: string, no: number, buyer: string): void {
  const mode = d.settings['cancel.buyerChat']
  if (mode === 'OFF') return
  const current = activeClaim(d, slotKey(b, no), buyer)
  if (current === undefined) return
  if (mode === 'AUTO' && !isLocked(d, current)) {
    release(d, d.claim(current.id), d.slot(b, no), 'CANCELLED', null)
    return
  }
  if (current.request === null) d.claim(current.id).request = d.seq
}

// ── 문자찜 (R-11 "문자찜 구매자 정하기", D-051) ──────────────────────────

function sms(d: Draft, e: SmsEvent): void {
  // 같은 ref가 다시 오면 아무 일도 없다 (INV-3과 같은 뜻)
  if (d.readRef(e.ref) !== undefined) return
  // 표시 이름: 문자 구매자는 가장 최근의 비어 있지 않은 메모(앞뒤 공백 제거)로 `문자찜(메모)`
  const memo = e.memo?.trim() ?? ''
  const display = memo === '' ? null : `${SMS_NAME}(${memo})`
  let buyer: string
  if (e.buyer !== undefined) {
    // 1. 지정 구매자 (전화번호는 보지 않는다). 모르는 구매자면 이벤트 전체가 아무 일도 없다
    if (d.readBuyer(e.buyer) === undefined) return
    buyer = e.buyer
  } else {
    // 2. 휴대폰 번호 모양이면 그 번호의 문자 구매자 / 3. 그 밖은 새 문자 구매자
    const phone = e.phone === undefined ? null : normalizePhone(e.phone)
    const linked = phone === null ? undefined : d.readPhone(phone)
    if (linked !== undefined) buyer = linked
    else {
      buyer = `sms:${e.ref}`
      if (d.readBuyer(buyer) !== undefined) throw new CorruptStateError(`문자 구매자 ID ${buyer}가 이미 있다`)
      d.newBuyer(buyer, 'sms', display ?? SMS_NAME, phone)
      if (phone !== null) d.setPhone(phone, buyer)
    }
  }
  d.setRef(e.ref, buyer)
  // 찜을 만들지 않은 문자찜(같은 사람 반복)의 메모도 반영한다. 유튜브 구매자의 표시 이름은 바꾸지 않는다
  const owner = d.readBuyer(buyer)
  if (display !== null && owner?.kind === 'sms' && owner.display !== display) {
    const draft = d.knownBuyer(buyer)
    draft.display = display
    draft.names.push(display)
  }
  // 형식은 checkEvent가 이미 확인했다
  const received = resolveReceivedTime(e.received, d.at) as ReceivedTime
  makeClaim(d, { b: e.b, no: e.no, buyer, origin: 'sms', seq: d.seq, at: d.at, time: received.time, minute: received.minute, message: null, ref: e.ref, received: e.received })
}

// ── 방송자 조치 (R-7, R-8, R-9, D-040~D-043, D-053, D-054) ───────────────

/** host.cancel → CANCELLED, host.reject → REJECTED(BY_HOST). 지금의 구매자의 활성 찜이 없으면 아무 일도 없다 */
function hostRelease(d: Draft, e: HostClaimEvent): void {
  const current = activeClaim(d, slotKey(e.b, e.no), e.buyer)
  if (current === undefined) return
  const [status, reason] = e.type === 'host.reject' ? (['REJECTED', 'BY_HOST'] as const) : (['CANCELLED', null] as const)
  release(d, d.claim(current.id), d.slot(e.b, e.no), status, reason)
}

/** host.promote: 자리가 비어 있고 대상이 대기 찜일 때만 확정 (대기 몇 순위든) */
function promote(d: Draft, e: HostClaimEvent): void {
  const key = slotKey(e.b, e.no)
  const now = d.readSlot(key)
  const current = activeClaim(d, key, e.buyer)
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
  const current = activeClaim(d, slotKey(e.b, e.no), e.buyer)
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

/** host.assign: 직접 배정·1등 교체 (R-9, D-042). 구매자는 지금의 구매자로 본다 */
function assign(d: Draft, e: HostAssignEvent): void {
  const key = slotKey(e.b, e.no)
  const current = d.readSlot(key)
  const product = current?.product
  if (current === undefined || product === null || product === undefined || product.phase !== 'SELLING') return
  if (d.readBuyer(e.buyer) === undefined) return
  const { replace, replaceTo } = e
  // 교체 대상과 방법은 함께 적어야 한다 (한쪽만 있으면 맞지 않는 명령)
  if ((replace === undefined) !== (replaceTo === undefined)) return
  const own = activeClaim(d, key, e.buyer)
  if (own !== undefined && own.status !== 'WAITLISTED') return
  let target: ClaimDraft | undefined
  if (replace !== undefined) {
    const winner = activeClaim(d, key, replace)
    if (winner?.status !== 'CONFIRMED') return
    target = d.claim(winner.id)
  } else if (current.winners.length >= product.stock) return
  const slot = d.slot(e.b, e.no)
  // 그 구매자의 대기 찜이 있으면 먼저 대기에서 빠져 확정된다(새 찜 없음, INV-2). 없으면 새 확정 찜(순위 = 이 조치, R-6)
  let claim: ClaimDraft
  if (own === undefined) {
    claim = d.newClaim({
      seq: d.seq,
      at: d.at,
      time: d.at,
      minute: false,
      b: e.b,
      no: e.no,
      key,
      pid: null,
      buyer: e.buyer,
      origin: 'assign',
      message: null,
      ref: null,
      received: null,
      status: 'PENDING',
      reason: null,
      price: null,
      version: null,
      locked: false,
      request: null,
      effects: [],
      reprint: false,
      priceHistory: [],
    })
  } else {
    slot.waitlist.splice(slot.waitlist.indexOf(own.id), 1)
    claim = d.claim(own.id)
  }
  if (target !== undefined) {
    unconfirm(d, target, slot)
    if (replaceTo === 'CANCEL') finish(d, target, slot, 'CANCELLED', null)
  }
  confirm(d, claim, slot, product)
  // 교체된 1등은 대기 1순위 (차단 중이면 REJECTED(BLOCKED), D-049). 넘치면 맨 끝 대기자부터 품절
  if (target !== undefined && replaceTo === 'WAITLIST') displace(d, target, slot)
  trimWaitlist(d, slot)
  settleAwaiting(slot)
}

/** host.resolveConflict (R-7 7): KEEP = c를 대기 자리에, SWITCH = c 확정·가장 뒤 1등 → 대기 1순위. 충돌이 없으면 아무 일도 없다 */
function resolveConflict(d: Draft, e: HostResolveConflictEvent): void {
  if ((d.readSlot(slotKey(e.b, e.no))?.conflict ?? null) === null) return
  const slot = d.slot(e.b, e.no)
  if (e.decision === 'KEEP') resolveKeep(d, slot)
  else resolveSwitch(d, slot)
  settleAwaiting(slot)
}

/**
 * host.convertMessage (R-7 4, D-054): 그 방송에서 받은 메시지를 찜으로. 구매자 = 메시지 채널, 순위 재료·at = 원래 메시지.
 * 모르는 메시지·무시한 방송자 메시지·이미 그 번호의 찜을 만든 메시지(그 찜이 지금 어떤 상태든)는 아무 일도 없다.
 */
function convert(d: Draft, e: HostConvertMessageEvent): void {
  const key = messageKey(e.b, e.msg)
  const message = d.readMessage(key)
  if (message === undefined || message.ignored || message.claimed.includes(e.no)) return
  const claim = makeClaim(d, {
    b: e.b,
    no: e.no,
    buyer: message.ch,
    origin: 'convert',
    seq: message.seq,
    at: message.at,
    time: message.publishedAt,
    minute: false,
    message: key,
    ref: null,
    received: null,
  })
  if (claim !== null) d.message(key).claimed.push(e.no)
}

/** host.blockBuyer: 그 구매자 자신의 대기·보류·충돌 찜은 모두 REJECTED(BLOCKED), 확정 찜은 그대로 (D-040). unblock: 새 찜만 다시 받는다 */
function block(d: Draft, e: HostBlockEvent): void {
  const blocked = d.isBlocked(e.buyer)
  if (e.type === 'host.unblockBuyer') {
    if (blocked) d.setBlocked(e.buyer, false)
    return
  }
  if (blocked) return
  d.setBlocked(e.buyer, true)
  for (const id of d.claimIdsOf(e.buyer)) {
    const record = d.readClaim(id)
    if (record === undefined || (record.status !== 'WAITLISTED' && record.status !== 'PENDING' && record.status !== 'CONFLICT')) continue
    const slot = d.slot(record.b, record.no)
    detach(record, slot)
    finish(d, d.claim(id), slot, 'REJECTED', 'BLOCKED')
    settleAwaiting(slot)
  }
}

// ── 구매자 합치기 (R-11, D-057) ──────────────────────────────────────────

/** 합친 결과 한 상품에 활성 찜이 둘이면 앞선 쪽: 확정 > 충돌 > 대기(앞 순번) > 보류(판정 순위) */
const STATUS_ORDER: Readonly<Record<string, number>> = { CONFIRMED: 0, CONFLICT: 1, WAITLISTED: 2, PENDING: 3 }

function aheadOf(d: Draft, slot: SlotDraft, a: ClaimRecord | ClaimDraft, b: ClaimRecord | ClaimDraft): boolean {
  // 둘 다 활성 찜이다
  const byStatus = (ownGet(STATUS_ORDER, a.status) as number) - (ownGet(STATUS_ORDER, b.status) as number)
  if (byStatus !== 0) return byStatus < 0
  if (a.status === 'WAITLISTED') return slot.waitlist.indexOf(a.id) < slot.waitlist.indexOf(b.id)
  return compareClaims(d, a, b) < 0
}

/** 지금의 구매자 아래(자신 포함)의 활성 찜 */
function activeClaimsOf(d: Draft, members: readonly string[]): (ClaimRecord | ClaimDraft)[] {
  const out: (ClaimRecord | ClaimDraft)[] = []
  for (const member of members) {
    for (const id of d.claimIdsOf(member)) {
      const claim = d.readClaim(id)
      if (claim !== undefined && isActive(claim.status)) out.push(claim)
    }
  }
  return out
}

function merge(d: Draft, e: BuyerMergeEvent): void {
  const from = d.readBuyer(e.from)
  if (from === undefined || d.readBuyer(e.into) === undefined || e.from === e.into || from.parent !== null) return
  const target = d.root(e.into)
  // 고리 금지: into의 지금의 구매자가 from이면 into는 from 아래에 있다
  if (target === e.from) return
  const moving = activeClaimsOf(d, d.members(e.from))
  // 확정 찜이 둘이 되는 상품이 하나라도 있으면 합치기 전체가 아무 일도 없다
  for (const claim of moving) {
    if (claim.status !== 'CONFIRMED') continue
    const other = pget((d.readSlot(claim.key) as SlotDraft).active, target)
    if (other !== undefined && d.readClaim(other)?.status === 'CONFIRMED') return
  }
  d.knownBuyer(e.from).parent = e.into
  d.knownBuyer(e.into).children.push(e.from)
  // from 나무의 활성 표시(from 키)를 지금의 구매자로 옮기고, 겹치면 앞선 쪽만 남기고 나머지는 DUPLICATE (효과 없음)
  for (const claim of moving) {
    const slot = d.slot(claim.b, claim.no)
    const otherId = pget(slot.active, target)
    slot.active = pdelete(slot.active, e.from)
    if (otherId === undefined) {
      slot.active = pset(slot.active, target, claim.id)
      continue
    }
    const other = d.readClaim(otherId)
    if (other === undefined) throw new CorruptStateError(`활성 찜 ${otherId}가 없다`)
    const [keep, drop] = aheadOf(d, slot, claim, other) ? [claim, other] : [other, claim]
    slot.active = pset(slot.active, target, keep.id)
    detach(drop, slot)
    const dropped = d.claim(drop.id)
    dropped.status = 'DUPLICATE'
    dropped.reason = null
    dropped.request = null
    settleAwaiting(slot)
  }
}

function unmerge(d: Draft, e: BuyerUnmergeEvent): void {
  const from = d.readBuyer(e.from)
  if (from === undefined || from.parent === null) return
  const oldRoot = d.root(e.from)
  const part = d.members(e.from)
  const whole = d.members(oldRoot)
  // 떼어 낸 결과 어느 묶음의 받은 금액이 음수가 되면 떼어 내지 않는다 (INV-6)
  // 읽기만 한다 (떼어 내지 않으면 상태를 그대로 돌려줘야 한다)
  const dates = new Set(whole.flatMap((member) => (d.readBuyer(member) as BuyerRecord).dates))
  for (const date of dates) {
    const split = receivedOfMembers(d, part, date)
    if (split < 0 || receivedOfMembers(d, whole, date) - split < 0) return
  }
  const parent = d.knownBuyer(from.parent)
  parent.children = parent.children.filter((child) => child !== e.from)
  d.knownBuyer(e.from).parent = null
  // 떨어진 쪽 활성 찜의 표시를 from으로 (DUPLICATE는 돌아오지 않는다)
  for (const claim of activeClaimsOf(d, part)) {
    const slot = d.slot(claim.b, claim.no)
    if (pget(slot.active, oldRoot) !== claim.id) throw new CorruptStateError(`${slot.key}: 찜 ${claim.id}의 활성 표시가 없다`)
    slot.active = pset(pdelete(slot.active, oldRoot), e.from, claim.id)
  }
}

// ── 정산 기록 (R-12, D-058) ──────────────────────────────────────────────

/** 적힌 (구매자 자신, 날짜)에 붙인다. 엔진이 모르는 구매자의 기록은 아무 일도 없다 */
function addEntry(d: Draft, buyer: string, date: string, entry: SettlementEntry): void {
  d.ledgerOf(buyer, date).entries.push(entry)
  const owner = d.knownBuyer(buyer)
  if (!owner.dates.includes(date)) owner.dates.push(date)
}

function shippingOverride(d: Draft, e: SettlementShippingEvent): void {
  if (d.readBuyer(e.buyer) === undefined) return
  addEntry(d, e.buyer, e.date, { kind: 'shipping', mode: e.mode, amount: e.amount ?? null, seq: d.seq, at: d.at })
}

function adjust(d: Draft, e: SettlementAdjustEvent): void {
  if (d.readBuyer(e.buyer) === undefined) return
  addEntry(d, e.buyer, e.date, { kind: 'adjust', amount: e.amount, reason: e.reason, seq: d.seq, at: d.at })
}

function payment(d: Draft, e: SettlementPaymentEvent): void {
  if (d.readBuyer(e.buyer) === undefined) return
  addEntry(d, e.buyer, e.date, { kind: 'payment', amount: e.amount, memo: e.memo ?? null, seq: d.seq, at: d.at })
}

/** 받은 금액(묶음)보다 큰 환불은 아무 일도 없다 */
function refund(d: Draft, e: SettlementRefundEvent): void {
  if (d.readBuyer(e.buyer) === undefined) return
  if (receivedOf(d, d.root(e.buyer), e.date) < e.amount) return
  addEntry(d, e.buyer, e.date, { kind: 'refund', amount: e.amount, reason: e.reason, seq: d.seq, at: d.at })
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
  if (kind === 'PRINT_PRODUCT_LABEL') voidLabel(d, claim, effect)
}

// ── 이벤트 표 ────────────────────────────────────────────────────────────

const HANDLERS: Readonly<Record<string, (d: Draft, event: never) => void>> = {
  'product.register': register,
  'product.open': productCommand,
  'product.hold': productCommand,
  'product.close': productCommand,
  'product.update': update,
  'product.renumber': renumber,
  chat,
  sms,
  'host.cancel': hostRelease,
  'host.reject': hostRelease,
  'host.promote': promote,
  'host.confirm': claimAction,
  'host.approveCancel': claimAction,
  'host.dismissCancel': claimAction,
  'host.assign': assign,
  'host.reopen': reopen,
  'host.resolveConflict': resolveConflict,
  'host.convertMessage': convert,
  'host.blockBuyer': block,
  'host.unblockBuyer': block,
  'buyer.merge': merge,
  'buyer.unmerge': unmerge,
  'effect.labelPrinted': report,
  'effect.thanksSent': report,
  'settlement.shippingOverride': shippingOverride,
  'settlement.adjust': adjust,
  'settlement.payment': payment,
  'settlement.refund': refund,
}

/**
 * apply(state, event) → { state, effects } (R-0).
 * effects = 이 이벤트로 새로 나온 효과. 효과의 취소·완료는 상태에 남고 조회 함수(listEffects)로 본다.
 * 입력 오류면 InvalidEventError(상태 그대로), 처음 쓰는 스프린트가 따로 있는 종류면 NotImplementedError.
 */
export function applyEvent(state: EngineState, event: EngineEvent): ApplyResult {
  const problems = checkEvent(state, event)
  const type = typeof event === 'object' && event !== null && typeof event.type === 'string' ? event.type : null
  if (problems.length > 0) throw new InvalidEventError(type, problems)
  const deferred = ownGet(DEFERRED_EVENTS, type as string)
  if (deferred !== undefined) throw new NotImplementedError(deferred)
  const handler = ownGet(HANDLERS, type as string) as (d: Draft, event: EngineEvent) => void
  const draft = new Draft(state, event)
  handler(draft, event)
  return draft.commit()
}
