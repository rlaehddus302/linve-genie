// 판정 리듀서 apply(state, event) → { state, effects } (R-0). 순수 함수다.
// - 넘긴 상태·이벤트를 바꾸지 않는다. 같은 설정·같은 이벤트 열이면 같은 결과(INV-4).
// - 입력 오류(형식이 틀린 이벤트)는 상태를 바꾸지 않고 InvalidEventError를 던진다(D-050). 같은 검사에 판매자가 적는 칸의 휴대폰 번호를 더한
//   기록 전 검사를 checkEvent로 내보낸다 — 재생은 번호 검사를 하지 않는다(D-079 ⑤).
// - 맞지 않는 명령(없는 상품·찜·메시지, 조건이 안 맞는 조치)은 아무것도 바꾸지 않는다(D-039, AC-S03-04).
// - 처음 쓰는 스프린트가 따로 있는 기능(effect.failed, settlement.groupBy=MANUAL)은 NotImplementedError로 알린다.
// - 상태 형식이 지금 코어와 다르면 StateFormatError를 던진다(D-072).
// - 판정 설정은 그 메시지·찜·상품이 속한 방송의 스냅샷이다(D-070). 방송은 initEngine의 시작 목록이나 broadcast.start로 선언한다.
// - 옵션 방송(claim.parseMode=OPTIONS, R-19·R-20 — O1): 판정 단위는 변형(판정 자리 Unit), 찜에는 수량이 있고, 댓글은 parseOptionComment로 읽는다.
//   애매한 댓글·모자란 수량·공개 때 옵션이 없는 보류 찜은 찜이 아니라 확인 필요 항목이 된다(재고·합계·효과에 들어가지 않는다, INV-O2).
import { NotImplementedError } from '../not-implemented.ts'
import { OPTION_TEXT_SEPARATOR, pickIndexes, variantTexts, type OptionItem, type OptionPick } from '../options.ts'
import { isBarePass, parseChat } from '../parse/chat.ts'
import { parseOptionComment, type OptionCatalogEntry, type OptionFocus } from '../parse/options.ts'
import { checkSettings, resolveSettings } from '../settings.ts'
import { CorruptStateError, Draft, Unit, claimNumber, emptyUnit, messageKey, ownGet, slotKey, unitKeyOf, variantActiveKey, type ClaimDraft, type SlotDraft } from './draft.ts'
import { leftoverVariant } from './leftover.ts'
import { receivedOf, receivedOfMembers } from './ledger.ts'
import { activeClaimsOf, applyMerge, planMerge } from './merge.ts'
import { emptyPMap, pdelete, pget, pkeys, pset, pvalues } from './pmap.ts'
import {
  SMS_NAME,
  activeClaim,
  activeIdIn,
  clearWaitlist,
  compareClaims,
  confirm,
  decide,
  detach,
  displace,
  enter,
  fillFromWaitlist,
  finish,
  groupReceived,
  isActive,
  isLocked,
  isOptionBroadcast,
  labelPrinted,
  openPending,
  queue,
  release,
  releaseConflict,
  resolveKeep,
  resolveSwitch,
  retextThanks,
  settleAwaiting,
  stockOf,
  confirmedUnits,
  succession,
  trimWaitlist,
  unconfirm,
  unitPrice,
  voidLabel,
  type OpenHooks,
} from './rules.ts'
import { STATE_FORMAT, assertStateFormat } from './state-format.ts'
import { resolveReceivedTime, type ReceivedTime } from './time.ts'
import { DEFERRED_EVENTS, InvalidEventError, checkShape } from './validate.ts'
import type {
  ApplyResult,
  BroadcastEndEvent,
  BroadcastThanksEvent,
  BroadcastPendingExpireEvent,
  BroadcastStartEvent,
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
  HostDismissReviewEvent,
  HostReopenEvent,
  HostResolveConflictEvent,
  HostResolveReviewEvent,
  PriceChange,
  ProductCommandEvent,
  ProductConfirmEvent,
  ProductFocusEvent,
  ProductRecord,
  ProductRegisterEvent,
  ProductRenumberEvent,
  ProductUpdateEvent,
  ProductWithdrawEvent,
  ReviewReason,
  ReviewRecord,
  SettlementAdjustEvent,
  SettlementEntry,
  SettlementPaymentEvent,
  SettlementRefundEvent,
  SettlementShippingEvent,
  SmsEvent,
  TentativeInput,
  TentativeRecord,
  VariantStock,
} from './types.ts'

type AnyClaim = ClaimRecord | ClaimDraft
type OptionPairs = readonly (readonly [string, string])[]

// ── 시작 ─────────────────────────────────────────────────────────────────

const MANUAL_GROUPING = '정산 직접 묶기(settlement.groupBy=MANUAL, R-12) — 묶음을 정하는 화면과 함께 정한다(D-059)'

/**
 * 새 엔진 상태. settings는 시작 때 선언한 방송들의 스냅샷이다(DOMAIN_RULES 기본값 위에 덮어쓴다, resolveSettings).
 * 서버는 빈 목록 `initEngine({ broadcasts: [], settings: {} })`에서 시작해 broadcast.start로 방송을 선언한다(D-069·D-070).
 * - settings가 설정값 범위 밖이면(checkSettings 문제) TypeError — 시작 설정은 서버·러너가 만드는 값이라 잘못되면 프로그램 오류다(D-071).
 * - settlement.groupBy=MANUAL이면 NotImplementedError(D-059).
 * - 방송 ID가 비었거나 겹치면 TypeError.
 */
export function initEngine(setup: EngineSetup): EngineState {
  const override = setup.settings ?? {}
  const problems = checkSettings(override)
  if (problems.length > 0) {
    throw new TypeError(`시작 설정이 설정값 범위 밖이다: ${problems.map((p) => (p.key === null ? p.message : `${p.key} — ${p.message}`)).join(' · ')}`)
  }
  const settings = resolveSettings(override)
  if (settings['settlement.groupBy'] === 'MANUAL') throw new NotImplementedError(MANUAL_GROUPING)
  const seen = new Set<string>()
  const broadcasts = setup.broadcasts.map(({ id, date, title }) => {
    if (typeof id !== 'string' || id === '' || seen.has(id)) throw new TypeError(`방송 ID는 겹치지 않는 빈 문자열이 아닌 값이어야 한다 (값: ${String(id)})`)
    seen.add(id)
    return { id, date, title, settings, endedAt: null, focus: null }
  })
  return {
    format: STATE_FORMAT,
    broadcasts,
    counters: { claims: 0, effects: 0, buyers: 0, products: 0 },
    messages: emptyPMap(),
    refs: emptyPMap(),
    phoneKeys: emptyPMap(),
    buyers: emptyPMap(),
    blocked: emptyPMap(),
    slots: emptyPMap(),
    products: emptyPMap(),
    claims: emptyPMap(),
    effects: emptyPMap(),
    ledger: emptyPMap(),
    reviews: emptyPMap(),
  }
}

// ── 옵션 도우미 ──────────────────────────────────────────────────────────

/** 고른 옵션(검사를 통과한 맵) → 옵션 글과 쌍 목록. 옵션 없는 상품이면 null */
function variantOf(product: ProductRecord | null | undefined, pick: OptionPick | undefined): { readonly text: string; readonly pairs: OptionPairs } | null {
  if (product === null || product === undefined || product.options.length === 0 || pick === undefined) return null
  const indexes = pickIndexes(product.options, pick)
  if (indexes === null) throw new CorruptStateError(`상품 ${product.id}: 고른 옵션이 항목과 맞지 않는다 (입력 검사를 거치지 않았다)`)
  const pairs = product.options.map((item, i) => [item.name, (item.choices[indexes[i] as number] as { readonly label: string }).label] as const)
  return { text: pairs.map(([, label]) => label).join(OPTION_TEXT_SEPARATOR), pairs }
}

/**
 * 찜을 가리키는 방송자 조치의 고른 옵션 → 변형 (R-19 "찜을 가리키는 방송자 조치").
 * 그 번호 상품의 변형이면 그 변형, 아니면 그 번호에 남은 변형 보류 찜(R-10 1)의 옵션 쌍과 같은 변형. 둘 다 아니면 null.
 */
function pickedVariant(d: Draft, slot: ReturnType<Draft['readSlot']>, pick: OptionPick): { readonly text: string } | null {
  const product = slot?.product
  if (product !== null && product !== undefined && product.options.length > 0 && pickIndexes(product.options, pick) !== null) return variantOf(product, pick)
  return leftoverVariant(slot, (id) => d.readClaim(id), pick)
}

/** 판정 자리 (찜이 있는 번호·변형) */
function unitOfClaim(d: Draft, claim: AnyClaim): Unit {
  return d.unit(claim.b, claim.no, claim.variant)
}

/** 확인 필요 항목의 키 */
function reviewKey(b: string, item: string): string {
  return JSON.stringify([b, item])
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
  /** 옵션 글·고른 옵션 (옵션을 가진 찜만) */
  readonly variant: string | null
  readonly options: OptionPairs | null
  readonly qty: number
  readonly qtyWritten: boolean
  /** 확인 필요로 보낼 때의 출처 (메시지 ID 또는 `sms:<ref>`) — 없으면 확인 필요를 만들지 않는다 */
  readonly item: string | null
  /** 닉네임으로 보이는 문자찜 (D-CLAIMADD-03) */
  readonly named?: boolean
}

function newClaimFields(source: ClaimSource): Omit<ClaimDraft, 'id' | 'n'> {
  return {
    seq: source.seq,
    at: source.at,
    time: source.time,
    minute: source.minute,
    b: source.b,
    no: source.no,
    key: slotKey(source.b, source.no),
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
    qty: source.qty,
    qtyWritten: source.qtyWritten,
    variant: source.variant,
    options: source.options === null ? null : source.options.map(([name, label]) => [name, label] as const),
    ...(source.named === true ? { named: true as const } : {}),
  }
}

/**
 * 확인 필요 항목을 만든다 (R-20 7). 같은 출처는 하나만 — 이미 있으면 아무것도 하지 않는다.
 * 읽은 것: 번호(그때의 상품 ID와 함께)·읽은 옵션·쓴 수량 (D-O1-08). 순위 재료는 출처 입력의 것.
 */
function addReview(
  d: Draft,
  source: Pick<ClaimSource, 'b' | 'buyer' | 'seq' | 'at' | 'time' | 'minute' | 'message' | 'ref' | 'received'> & { readonly origin: 'chat' | 'sms'; readonly item: string },
  reason: ReviewReason,
  read: { readonly no: number | null; readonly options: OptionPairs | null; readonly qty: number | null },
): void {
  const key = reviewKey(source.b, source.item)
  if (d.readReview(key) !== undefined) return
  const pid = read.no === null ? null : (d.readSlot(slotKey(source.b, read.no))?.product?.id ?? null)
  const record: ReviewRecord = {
    b: source.b,
    item: source.item,
    buyer: source.buyer,
    reason,
    no: read.no,
    pid,
    options: read.options === null || read.options.length === 0 ? null : read.options.map(([name, label]) => [name, label] as const),
    qty: read.qty,
    seq: source.seq,
    at: source.at,
    time: source.time,
    minute: source.minute,
    origin: source.origin,
    message: source.message,
    ref: source.ref,
    received: source.received,
  }
  d.setReview(key, record)
}

/** 찜의 출처 (확인 필요 항목의 item): 채팅·변환은 메시지 ID, 문자찜은 `sms:<ref>` */
function itemOfClaim(claim: AnyClaim): { readonly origin: 'chat' | 'sms'; readonly item: string } | null {
  if (claim.origin === 'sms' && claim.ref !== null) return { origin: 'sms', item: `sms:${claim.ref}` }
  if ((claim.origin === 'chat' || claim.origin === 'convert') && claim.message !== null) return { origin: 'chat', item: (JSON.parse(claim.message) as [string, string])[1] }
  return null
}

/** 공개 순간 판정하지 않은 보류 찜의 확인 필요 (R-19 "공개 전 찜", R-19 "수량") */
function openHooks(d: Draft, no: number): OpenHooks {
  const fromClaim = (claim: ClaimDraft, reason: ReviewReason, read: { readonly no: number | null; readonly options: OptionPairs | null; readonly qty: number | null }): void => {
    const item = itemOfClaim(claim)
    if (item === null) return
    addReview(d, { ...claim, ...item }, reason, read)
  }
  return {
    // 번호만 쓴 보류 찜: 읽은 것 = 번호(문자찜이면 적은 수량도)
    optionMissing: (claim) => fromClaim(claim, 'OPTION_MISSING', { no, options: null, qty: claim.qtyWritten ? claim.qty : null }),
    stockShort: (claim) => fromClaim(claim, 'STOCK_SHORT', { no, options: claim.options, qty: claim.qty }),
  }
}

/**
 * R-4로 판정해 새 찜을 만든다. 4번 줄(같은 사람 반복)이면 찜을 만들지 않고 null.
 * 수량이 남은 수량보다 많으면(수량 2 이상) 찜을 만들지 않고 확인 필요(STOCK_SHORT)로 보낸다 — null.
 * 거절(차단·판매 아님)은 번호에 아무것도 남기지 않는다 — 상품도 보류 찜도 없는 번호 기록을 새로 만들지 않는다.
 */
function makeClaim(d: Draft, source: ClaimSource): ClaimDraft | null {
  const key = slotKey(source.b, source.no)
  const current = d.readSlot(key)
  const outcome = decide(d, current, source.variant, source.buyer, source.qty)
  if (outcome.kind === 'none') return null
  if (outcome.kind === 'review') {
    if (source.item !== null && (source.origin === 'chat' || source.origin === 'sms')) {
      addReview(d, { ...source, origin: source.origin, item: source.item }, outcome.reason, { no: source.no, options: source.options, qty: source.qty })
    }
    return null
  }
  const claim = d.newClaim(newClaimFields(source))
  if (outcome.kind === 'reject') {
    claim.status = 'REJECTED'
    claim.reason = outcome.reason
    claim.pid = current?.product?.id ?? null
    return claim
  }
  enter(d, claim, d.unit(source.b, source.no, source.variant), outcome)
  return claim
}

// ── 방송 시작·종료 (R-1 "방송 시작·종료", D-070) ──────────────────────────

/**
 * broadcast.start: 새 방송을 선언 순서 끝에 더한다. 스냅샷 = DOMAIN_RULES 기본값 위에 settings를 덮어쓴 값(엔진 시작 설정과 상관없다).
 * 이미 선언한 방송(시작 때 또는 앞선 broadcast.start)이면 날짜·제목·설정이 달라도 아무 일도 없다 — 같은 입력의 재전송이다(INV-3).
 * 설정 범위는 구조 검사(checkShape)가, MANUAL은 applyEvent가 이미 걸렀다.
 */
function startBroadcast(d: Draft, e: BroadcastStartEvent): void {
  if (d.readBroadcast(e.b) !== undefined) return
  d.addBroadcast({ id: e.b, date: e.date, title: e.title, settings: resolveSettings(e.settings ?? {}), endedAt: null, focus: null })
}

/** broadcast.end: 끝난 시각(at)만 남긴다. 판정·정산·효과는 바뀌지 않는다. 이미 끝난 방송이면 아무 일도 없다 */
function endBroadcast(d: Draft, e: BroadcastEndEvent): void {
  const broadcast = d.broadcastOf(e.b)
  if (broadcast.endedAt !== null) return
  d.replaceBroadcast({ ...broadcast, endedAt: d.at })
}

/** broadcast.thanks (D-YT-SRV-24): 방송 설정 스냅샷의 thanks.liveChat만 바꾼다. 같은 값이면 아무 일도 없다 */
function switchThanks(d: Draft, e: BroadcastThanksEvent): void {
  const broadcast = d.broadcastOf(e.b)
  if (broadcast.settings['thanks.liveChat'] === e.liveChat) return
  d.replaceBroadcast({ ...broadcast, settings: { ...broadcast.settings, 'thanks.liveChat': e.liveChat } })
}

/** broadcast.pendingExpire (D-PEND-01): 방송 설정 스냅샷의 claim.preOpenExpire만 바꾼다. 같은 값이면 아무 일도 없다 */
function switchPendingExpire(d: Draft, e: BroadcastPendingExpireEvent): void {
  const broadcast = d.broadcastOf(e.b)
  if (broadcast.settings['claim.preOpenExpire'] === e.expire) return
  d.replaceBroadcast({ ...broadcast, settings: { ...broadcast.settings, 'claim.preOpenExpire': e.expire } })
}

// ── 지금 상품 (R-20 6, D-O-09·D-O1-06) ──────────────────────────────────

/** 지금 상품을 그 상품으로 (옵션 방송만). 이미 지금 상품이면 정한 시각 그대로 — 15초 유예가 다시 생기지 않는다 */
function setFocus(d: Draft, b: string, pid: string): void {
  if (!isOptionBroadcast(d, b)) return
  const broadcast = d.broadcastOf(b)
  if (broadcast.focus?.pid === pid) return
  d.replaceBroadcast({ ...broadcast, focus: { pid, at: d.at } })
}

/** 지금 상품을 없앤다 (pid가 주어지면 그 상품이 지금 상품일 때만) */
function clearFocus(d: Draft, b: string, pid?: string): void {
  const broadcast = d.broadcastOf(b)
  if (broadcast.focus === null || (pid !== undefined && broadcast.focus.pid !== pid)) return
  d.replaceBroadcast({ ...broadcast, focus: null })
}

/** product.focus: READY·판매 중 상품이면 지금 상품, 없는 번호·HOLD·CLOSED면 지금 상품을 없앤다 (D-O1-06) */
function focus(d: Draft, e: ProductFocusEvent): void {
  const product = d.readSlot(slotKey(e.b, e.no))?.product ?? null
  if (product === null || product.phase === 'HOLD' || product.phase === 'CLOSED') clearFocus(d, e.b)
  else setFocus(d, e.b, product.id)
}

// ── 상품 명령 (R-2 "상품 명령 세부", D-039) ──────────────────────────────

/** 옵션 항목과 변형 재고로 변형 목록 (항목 순서·선택지 순서). 옵션이 없으면 빈 목록 */
function variantStocks(options: readonly OptionItem[], stocks: Readonly<Record<string, number>> | undefined, base: (text: string) => number): VariantStock[] {
  return variantTexts(options).map((text) => ({ text, stock: stocks !== undefined && Object.hasOwn(stocks, text) ? (stocks[text] as number) : base(text) }))
}

/** 확인 중 칸 → 상태 기록 (R-2 "확인 중"). 시각은 임시 등록 이벤트의 것 */
function tentativeOf(d: Draft, input: TentativeInput): TentativeRecord {
  const candidates = input.candidates
  return {
    by: input.by,
    reasons: [...input.reasons],
    candidates: { no: [...(candidates?.no ?? [])], price: [...(candidates?.price ?? [])], name: [...(candidates?.name ?? [])] },
    seq: d.seq,
    at: d.at,
  }
}

/**
 * 가격을 바꾼 뒤의 가격 이력 (R-10). 빈 가격을 처음 채운 것은 바꾼 것이 아니라 이력에 넣지 않는다 —
 * 이력의 from은 늘 금액이다 (R-2 "가격 없는 확인 중", D-RECOG-22)
 */
function pricedHistory(product: ProductRecord, price: number, change: { readonly seq: number; readonly at: number }): readonly PriceChange[] {
  return product.price === null ? product.priceHistory : [...product.priceHistory, { from: product.price, to: price, ...change }]
}

/** 확인 중 표시를 뗀 상품 기록 (확인 중이 아니면 같은 칸·같은 순서의 사본) */
function settled(product: ProductRecord): Omit<ProductRecord, 'tentative'> {
  const { tentative: _tentative, ...rest } = product
  return rest
}

/**
 * 개수를 고친 상품 기록 (D-PIECES-01): 2 이상이면 칸을 두고, 1이면 칸을 뺀다(기본 1인 상품의 기록은 이 칸이 없던 때와 글자까지 같다).
 * pieces가 undefined면(고치지 않음) 그대로
 */
function withPieces<T extends { readonly pieces?: number }>(product: T, pieces: number | undefined): T {
  if (pieces === undefined) return product
  const { pieces: _pieces, ...rest } = product
  return (pieces > 1 ? { ...rest, pieces } : rest) as T
}

/** 고치는 이벤트가 적은 개수가 지금과 다르면 그 값 (같거나 적지 않았으면 undefined) */
function changedPieces(product: { readonly pieces?: number }, pieces: number | undefined): number | undefined {
  return pieces !== undefined && pieces !== (product.pieces ?? 1) ? pieces : undefined
}

function register(d: Draft, e: ProductRegisterEvent): void {
  if (d.readSlot(slotKey(e.b, e.no))?.product) return
  const slot = d.slot(e.b, e.no)
  // 확인 중으로 올린 등록은 공개 전이다 — 찜은 보류로 받고 확정(product.confirm)·공개(product.open) 때 판정한다 (R-2 "확인 중", D-RETRO-80)
  const phase = e.status === 'READY' || e.tentative !== undefined ? 'READY' : 'SELLING'
  const id = d.newProductId()
  const stock = e.stock ?? 1
  const options = e.options ?? []
  const variants = variantStocks(options, e.stocks, () => stock)
  // 확인 중 칸은 적은 등록의 상품에만 넣는다 — 적지 않은 등록의 상품 기록은 지금과 글자까지 같다 (옛 로그 재생, D-072)
  slot.product = {
    id,
    name: e.name,
    // 가격 없는 확인 중 등록은 가격이 빈(null) 상품이다 — 0원이 아니다 (R-2 "가격 없는 확인 중", D-RECOG-22)
    price: e.price ?? null,
    stock,
    phase,
    priceHistory: [],
    nameHistory: [],
    aliases: [...(e.aliases ?? [])],
    options,
    variants,
    ...(e.tentative === undefined ? {} : { tentative: tentativeOf(d, e.tentative) }),
    // 개수는 2 이상일 때만 칸을 둔다 (D-PIECES-01)
    ...(e.pieces === undefined || e.pieces <= 1 ? {} : { pieces: e.pieces }),
  }
  slot.units = withPendingUnits(d, slot, variants.map(({ text }) => ({ ...emptyUnit(text), winners: [], waitlist: [] })))
  d.setProductKey(id, slot.key)
  if (phase === 'SELLING') {
    setFocus(d, e.b, id)
    openPending(d, slot, e.at, openHooks(d, e.no))
  }
}

/** 그 번호의 보류 찜이 가진 옵션 글 (변형 보류 찜만) */
function pendingTexts(d: Draft, slot: SlotDraft): Set<string> {
  const out = new Set<string>()
  for (const id of pkeys(slot.pending)) {
    const claim = d.readClaim(id)
    if (claim === undefined) throw new CorruptStateError(`보류 찜 ${id}가 없다`)
    if (claim.variant !== null) out.add(claim.variant)
  }
  return out
}

/**
 * 새 변형 자리 목록 + 그 상품에 없는 변형을 가진 보류 찜의 자리 (지금 자리 그대로, 지금 순서).
 * 번호를 바꾸거나 새 상품을 등록해도 번호 a에 남은 변형 보류 찜(R-10 1)은 자리가 있어야 차단·합치기·취소로 끝낼 수 있다.
 * 그런 자리는 보류 찜만 가리킨다(확정·대기·충돌 없음). 조회의 변형 목록에는 나오지 않는다(상품 변형만).
 */
function withPendingUnits(d: Draft, slot: SlotDraft, units: SlotDraft['units']): SlotDraft['units'] {
  const kept = new Set(units.map((unit) => unit.text))
  const orphans = slot.units.filter((unit) => !kept.has(unit.text))
  if (orphans.length === 0) return units
  const texts = pendingTexts(d, slot)
  return [...units, ...orphans.filter((unit) => texts.has(unit.text))]
}

/** 상품 변형이 아닌 자리는 그 변형의 보류 찜이 모두 끝나면 지운다 (이벤트 끝에, 고친 번호만) */
function pruneUnits(d: Draft): void {
  for (const slot of d.touchedSlots()) {
    const variants = slot.product?.variants ?? []
    const isVariant = (text: string): boolean => variants.some((variant) => variant.text === text)
    if (slot.units.every((unit) => isVariant(unit.text))) continue
    const texts = pendingTexts(d, slot)
    slot.units = slot.units.filter((unit) => isVariant(unit.text) || texts.has(unit.text))
  }
}

/** 판정 자리 전부 (옵션 상품이면 변형마다, 그리고 번호 자신) */
function unitsOf(slot: SlotDraft): Unit[] {
  return [new Unit(slot, null), ...slot.units.map((unit) => new Unit(slot, unit.text))]
}

function productCommand(d: Draft, e: ProductCommandEvent): void {
  const current = d.readSlot(slotKey(e.b, e.no))
  if (current === undefined || current.product === null) return
  const product = current.product
  const { phase } = product
  if (e.type === 'product.open') {
    if (phase === 'SELLING') return
    // 가격이 빈 상품은 판매 중이 되지 않는다 — 가격을 먼저 채운다(product.update·product.confirm의 price) (R-2 "가격 없는 확인 중", D-RECOG-22)
    if (product.price === null) return
    const slot = d.slot(e.b, e.no)
    // 확인 중 상품을 공개하면 지금 값으로 확정한 것이다 — 표시를 떼고, 보류 찜 유효 시간은 임시 등록 시각에서 잰다 (R-2 "확인 중", R-5)
    slot.product = { ...settled(product), phase: 'SELLING' }
    setFocus(d, e.b, product.id)
    openPending(d, slot, openedAtOf(product, e.at), openHooks(d, e.no))
    return
  }
  if (e.type === 'product.hold') {
    if (phase !== 'SELLING') return
    d.slot(e.b, e.no).product = { ...product, phase: 'HOLD' }
    clearFocus(d, e.b, product.id)
    return
  }
  // close: 어느 자리(변형)에도 확정·대기 찜이 없을 때만(충돌 찜은 확정이 찼을 때만 있다). 그 번호의 보류 찜은 REJECTED(NOT_ON_SALE)
  const busy = current.winners.length > 0 || current.waitlist.length > 0 || current.units.some((unit) => unit.winners.length > 0 || unit.waitlist.length > 0)
  if (phase === 'CLOSED' || busy) return
  const slot = d.slot(e.b, e.no)
  // 판매 종료하면 확인 중 표시도 사라진다 — 방송자가 정한 것이라 더 물을 것이 없다 (R-2 "확인 중")
  slot.product = { ...settled(product), phase: 'CLOSED' }
  clearFocus(d, e.b, product.id)
  const ids = pkeys(slot.pending).sort((a, b) => claimNumber(a) - claimNumber(b))
  slot.pending = emptyPMap()
  for (const id of ids) {
    const claim = d.claim(id)
    finish(d, claim, new Unit(slot, claim.variant), 'REJECTED', 'NOT_ON_SALE')
  }
}

/** 두 옵션 항목 목록이 같은가 (이름·선택지·별칭·가격 차이) */
function sameOptions(a: readonly OptionItem[], b: readonly OptionItem[]): boolean {
  return JSON.stringify(a.map(normalizeItem)) === JSON.stringify(b.map(normalizeItem))
}

function normalizeItem(item: OptionItem): unknown {
  return [item.name, item.choices.map((choice) => [choice.label, choice.aliases ?? [], choice.price ?? 0])]
}

/**
 * 찜이 있을 때 받는 옵션 바꾸기 (R-19 "옵션 바꾸기", D-O-14, AC-O1-07): 항목은 같은 이름·같은 순서, 기존 선택지는 같은 이름·같은 별칭·같은 순서로
 * 그대로 있고 새 선택지(별칭 포함)는 끝에만 더한다. 기존 선택지에서 바꿀 수 있는 것은 가격 차이뿐이다("선택지 더하기와 선택지 가격 차이 바꾸기만").
 */
function onlyAdditions(before: readonly OptionItem[], after: readonly OptionItem[]): boolean {
  if (before.length !== after.length) return false
  return before.every((item, i) => {
    const next = after[i] as OptionItem
    return (
      next.name === item.name &&
      next.choices.length >= item.choices.length &&
      item.choices.every((choice, j) => {
        const changed = next.choices[j] as OptionItem['choices'][number]
        return changed.label === choice.label && JSON.stringify(changed.aliases ?? []) === JSON.stringify(choice.aliases ?? [])
      })
    )
  })
}

/** 그 상품에 찜이 하나라도 있는가 (어떤 상태든 — 끝난 찜도, 그 번호의 보류 찜도) */
function hasClaims(d: Draft, slot: { readonly pending: { readonly size: number } }, product: ProductRecord): boolean {
  return slot.pending.size > 0 || pvalues(d.base.claims).some((claim) => claim.pid === product.id)
}

/**
 * 상품 수정 (R-10, D-055, 옵션 방송은 R-19 "옵션 바꾸기"·"가격"): 적힌 값을 한 번에.
 * 하나라도 받을 수 없으면(재고·변형 재고를 확정 수량보다 작게, 찜이 있는데 막힌 옵션 바꾸기) 이벤트 전체가 아무 일도 없다.
 * - 옵션 상품의 stock은 stocks에 적지 않은 변형마다의 재고다(등록과 같다 — 적지 않으면 변형 재고 그대로).
 * - 가격 변경 = 상품 가격이나 가격 차이를 바꿔 변형 단가가 바뀌는 것. UNPAID_CLAIMS면 입금 전 확정 찜의 단가를 그 변형의 새 단가로.
 */
function update(d: Draft, e: ProductUpdateEvent): void {
  const current = d.readSlot(slotKey(e.b, e.no))
  const product = current?.product
  if (current === undefined || product === null || product === undefined) return
  const name = e.name !== undefined && e.name !== product.name ? e.name : undefined
  const price = e.price !== undefined && e.price !== product.price ? e.price : undefined
  const options = e.options !== undefined && !sameOptions(e.options, product.options) ? e.options : undefined
  const aliases = e.aliases !== undefined && JSON.stringify(e.aliases) !== JSON.stringify(product.aliases) ? [...e.aliases] : undefined
  const slot = current
  const draftSlot = (): SlotDraft => d.slot(e.b, e.no)
  // 찜이 있으면 옵션은 선택지 더하기·가격 차이만 (상품 별칭은 옵션이 아니라 받는다 — dev-notes, spec-keeper 확인 부탁)
  if (options !== undefined && !onlyAdditions(product.options, options) && hasClaims(d, current, product)) return
  const nextOptions = options ?? product.options
  const optioned = nextOptions.length > 0
  // 변형 재고: stocks에 적은 값, 아니면 stock(적었으면), 아니면 지금 변형 재고(새 변형이면 기본 재고)
  const variants = optioned
    ? variantStocks(nextOptions, e.stocks, (text) => e.stock ?? product.variants.find((variant) => variant.text === text)?.stock ?? product.stock)
    : []
  const stock = !optioned && e.stock !== undefined && e.stock !== product.stock ? e.stock : undefined
  // 확정 수량보다 작은 재고는 받지 않는다 (이벤트 전체가 아무 일도 없다)
  if (stock !== undefined && stock < confirmedUnits(d, slot.winners)) return
  for (const unit of slot.units) {
    const next = variants.find((variant) => variant.text === unit.text)
    if ((next?.stock ?? 0) < confirmedUnits(d, unit.winners)) return
  }
  const stocksChanged = optioned && JSON.stringify(variants) !== JSON.stringify(product.variants)
  const defaultStock = optioned && e.stock !== undefined && e.stock !== product.stock ? e.stock : undefined
  const pieces = changedPieces(product, e.pieces)
  if (name === undefined && price === undefined && stock === undefined && options === undefined && aliases === undefined && !stocksChanged && defaultStock === undefined && pieces === undefined) return
  const target = draftSlot()
  const change = { seq: d.seq, at: d.at }
  target.product = {
    ...withPieces(product, pieces),
    ...(name === undefined ? {} : { name, nameHistory: [...product.nameHistory, { from: product.name, to: name, ...change }] }),
    ...(price === undefined ? {} : { price, priceHistory: pricedHistory(product, price, change) }),
    ...(stock === undefined && defaultStock === undefined ? {} : { stock: (stock ?? defaultStock) as number }),
    ...(aliases === undefined ? {} : { aliases }),
    ...(options === undefined ? {} : { options: nextOptions }),
    variants,
  }
  // 변형 판정 자리: 남는 변형은 그대로, 새 변형은 빈 자리 (빼는 바꾸기는 찜이 없을 때만 받았다)
  target.units = withPendingUnits(d, target, variants.map(({ text }) => target.units.find((unit) => unit.text === text) ?? { ...emptyUnit(text), winners: [], waitlist: [] }))
  const next = target.product
  const followEdits = d.settingsOf(e.b)['thanks.followEdits'] === true
  // 지금 확정 찜: UNPAID_CLAIMS면 입금 전(묶음 받은 금액 0) 찜의 단가를 새 단가로, 출력된 라벨이 있으면 재출력 필요
  for (const unit of unitsOf(target)) {
    for (const id of unit.winners) {
      const record = d.readClaim(id)
      if (record === undefined) throw new CorruptStateError(`확정 찜 ${id}가 없다`)
      // 가격 변경 = 이 이벤트로 그 찜 변형의 단가가 바뀌었다 (상품 가격 또는 가격 차이 — R-10, R-19 "가격")
      const newPrice = unitPrice(next, record.variant)
      const changed = newPrice !== unitPrice(product, record.variant)
      const reprice = changed && e.applyTo === 'UNPAID_CLAIMS' && record.price !== newPrice && groupReceived(d, record) === 0
      // 개수만 고친 것은 감사 문구를 바꾸지 않고, 뽑은 라벨(품종 옆 개수)만 다시 인쇄 필요로 둔다 (D-PIECES-01)
      if (!reprice && name === undefined && pieces === undefined) continue
      // 아직 게시되지 않은 감사 문구는 고친 품종·그 찜의 지금 단가를 따라간다 (R-13, D-RETRO-02). NEW_ONLY면 찜 단가가 그대로라 금액도 그대로.
      // 그 방송의 설정 스냅샷 thanks.followEdits가 참일 때만 — 이 칸이 없던 옛 방송은 다시 재생해도 문구가 그대로다
      const from = record.price as number
      if (followEdits && record.price !== null && (reprice || name !== undefined)) retextThanks(d, record, { name: product.name, price: from }, { name: next.name, price: reprice ? newPrice : from })
      const printed = labelPrinted(d, record)
      if (!reprice && !printed) continue
      const claim = d.claim(id)
      if (reprice) {
        claim.price = newPrice
        claim.priceHistory.push({ from, to: newPrice, ...change })
        d.knownBuyer(claim.buyer).subtotal += (newPrice - from) * claim.qty
      }
      if (printed) claim.reprint = true
    }
  }
  // 재고 늘림: 늘린 수만큼(대기가 그보다 적으면 대기 전부) 대기 1순위부터 대기 순번 순서로 확정(확정버전도 이 순서, D-066).
  // 충돌이 있으면 먼저 풀리고 넘침 정리는 확정한 뒤에 한다(D-068). 승계 결정 필요 자리는 방송자 결정으로 남긴다
  for (const unit of unitsOf(target)) {
    const before = unit.text === null ? (optioned ? 0 : product.stock) : (product.variants.find((variant) => variant.text === unit.text)?.stock ?? 0)
    const added = stockOf(next, unit.text) - before
    if (added > 0) {
      releaseConflict(d, unit)
      fillFromWaitlist(d, unit, next, added)
      trimWaitlist(d, unit)
    }
    settleAwaiting(d, unit)
  }
}

/** 번호 변경 (R-10, D-056) */
function renumber(d: Draft, e: ProductRenumberEvent): void {
  if (e.from === e.to) return
  if (!d.readSlot(slotKey(e.b, e.from))?.product) return
  const target = d.readSlot(slotKey(e.b, e.to))?.product
  if (target && !(e.reuseClosed === true && target.phase === 'CLOSED')) return
  const from = d.slot(e.b, e.from)
  const product = from.product as ProductRecord
  // a의 확정·대기·충돌 찜은 잠금·입금과 상관없이 REJECTED(RENUMBERED). 승계 없음. 번호 a의 보류 찜은 그대로 (변형 자리마다)
  for (const unit of unitsOf(from)) {
    for (const id of [...unit.winners]) {
      const claim = d.claim(id)
      unconfirm(d, claim, unit)
      finish(d, claim, unit, 'REJECTED', 'RENUMBERED')
    }
    const waiting = unit.waitlist
    unit.waitlist = []
    for (const id of waiting) finish(d, d.claim(id), unit, 'REJECTED', 'RENUMBERED')
    if (unit.conflict !== null) {
      const id = unit.conflict
      unit.conflict = null
      finish(d, d.claim(id), unit, 'REJECTED', 'RENUMBERED')
    }
    unit.awaiting = false
  }
  const to = moveProduct(d, from, e.to)
  if (product.phase === 'SELLING') openPending(d, to, e.at, openHooks(d, e.to))
}

/**
 * 상품을 다른 번호로 옮긴다 (R-10 번호 변경 2, 확인 중 상품의 확정 — 부르는 쪽이 옮길 수 있는지와 옛 번호의 확정·대기·충돌 찜 정리를 끝냈다).
 * 상품은 품종·가격·재고·옵션·상태·이력·확정버전을 가지고 새 번호로 (지금 상품도 상품 ID로 따라간다 — 정한 시각 그대로).
 * 옛 번호의 보류 찜은 그 번호에 그대로 남는다.
 */
function moveProduct(d: Draft, from: SlotDraft, toNo: number): SlotDraft {
  const product = from.product as ProductRecord
  const to = d.slot(from.b, toNo)
  to.product = product
  to.version = from.version
  to.units = withPendingUnits(d, to, product.variants.map(({ text }) => ({ ...emptyUnit(text), winners: [], waitlist: [] })))
  from.product = null
  from.version = 0
  // 번호 a에 남은 변형 보류 찜의 자리는 남긴다(빈 자리) — 차단·합치기·취소·무효·시청자 취소가 그 찜을 찾고 끝낼 수 있게 (R-10 1, R-5)
  from.units = withPendingUnits(d, from, [])
  from.requests = []
  d.setProductKey(product.id, to.key)
  return to
}

// ── 확인 중 상품 (R-2 "확인 중", D-RETRO-80) ─────────────────────────────

/** 공개 시각 (R-5의 T): 확인 중이던 상품은 임시 등록 시각 — 확정이 늦어도 임시 등록 때 온 찜이 유효 시간 밖으로 밀리지 않는다 */
function openedAtOf(product: ProductRecord, at: number): number {
  return product.tentative === undefined ? at : Math.min(at, product.tentative.at)
}

/**
 * product.confirm: 확인 중 상품의 최종 번호·품종·금액을 정하고 공개한다. 그 번호(최종 번호)의 보류 찜을 판정 순위대로, 확정하는 지금의 값으로 판정한다(R-5).
 * - 확인 중이 아닌 상품·없는 번호면 아무 일도 없다 (이미 확정한 상품에 늦게 온 확정이 값을 덮지 않는다).
 * - 최종 번호에 상품 기록이 이미 있으면(CLOSED 포함) 이벤트 전체가 아무 일도 없다 (R-10 번호 변경과 같다).
 * - 바뀐 품종·금액은 이력을 남긴다. 처음 번호에 와 있던 보류 찜은 그 번호의 보류 찜으로 남는다(R-10 1).
 */
function confirmTentative(d: Draft, e: ProductConfirmEvent): void {
  const product = d.readSlot(slotKey(e.b, e.no))?.product
  if (product === null || product === undefined || product.tentative === undefined) return
  // 가격이 빈 확인 중 상품은 최종 가격을 적은 확정만 받는다 — 가격 없이 판매 중이 되지 않는다 (R-2 "가격 없는 확인 중", D-RECOG-22)
  if (product.price === null && e.price === undefined) return
  const toNo = e.to ?? e.no
  if (toNo !== e.no && d.readSlot(slotKey(e.b, toNo))?.product) return
  const change = { seq: d.seq, at: d.at }
  const name = e.name !== undefined && e.name !== product.name ? e.name : undefined
  const price = e.price !== undefined && e.price !== product.price ? e.price : undefined
  const from = d.slot(e.b, e.no)
  const slot = toNo === e.no ? from : moveProduct(d, from, toNo)
  slot.product = {
    ...withPieces(settled(product), changedPieces(product, e.pieces)),
    ...(name === undefined ? {} : { name, nameHistory: [...product.nameHistory, { from: product.name, to: name, ...change }] }),
    ...(price === undefined ? {} : { price, priceHistory: pricedHistory(product, price, change) }),
    phase: 'SELLING',
  }
  setFocus(d, e.b, product.id)
  openPending(d, slot, openedAtOf(product, e.at), openHooks(d, toNo))
}

/**
 * product.withdraw: 확인 중 상품을 거둔다 — 그 번호의 상품 기록이 없어진다(다시 등록할 수 있다). 그 번호의 보류 찜은 그대로 보류다.
 * 확인 중이 아닌 상품·없는 번호면 아무 일도 없다. 상품 ID → 번호 지도는 남긴다(그 상품에 붙어 끝난 찜이 마지막 번호를 가리키게).
 */
function withdraw(d: Draft, e: ProductWithdrawEvent): void {
  const product = d.readSlot(slotKey(e.b, e.no))?.product
  if (product === null || product === undefined || product.tentative === undefined) return
  const slot = d.slot(e.b, e.no)
  slot.product = null
  slot.version = 0
  // 변형 보류 찜의 자리는 남긴다 (번호 변경 뒤의 옛 번호와 같다 — R-10 1)
  slot.units = withPendingUnits(d, slot, [])
  clearFocus(d, e.b, product.id)
}

// ── 채팅 (R-4 머리말 "채팅 메시지에서 찜까지", D-045, 옵션 방송은 R-20) ───

/** 옵션 방송 인식의 상품 목록: 그 방송의 판매 종료가 아닌 상품(공개 전 포함), 번호 순 */
function catalogOf(d: Draft, b: string): OptionCatalogEntry[] {
  const out: OptionCatalogEntry[] = []
  for (const slot of pvalues(d.base.slots)) {
    const product = slot.product
    if (slot.b !== b || product === null || product.phase === 'CLOSED') continue
    out.push({ no: slot.no, name: product.name, aliases: product.aliases, options: product.options })
  }
  return out.sort((a, b2) => a.no - b2.no)
}

/** 지금 상품과 지난 초 (채팅 at − 정한 이벤트 at). 일시 중지·판매 종료 상품이면 없음 */
function focusOf(d: Draft, b: string): OptionFocus | null {
  const record = d.broadcastOf(b).focus
  if (record === null) return null
  const key = d.readProductKey(record.pid)
  const slot = key === undefined ? undefined : d.readSlot(key)
  if (slot?.product === null || slot === undefined || slot.product.phase === 'HOLD' || slot.product.phase === 'CLOSED') return null
  return { no: slot.no, ageSec: (d.at - record.at) / 1000 }
}

function chat(d: Draft, e: ChatEvent): void {
  const key = messageKey(e.b, e.id)
  // ① 재수신: 본문·닉네임이 달라도 아무 일도 없다 (INV-3·INV-12)
  if (d.readMessage(key) !== undefined) return
  // ② 방송자 본인 메시지 + claim.ignoreOwner (받은 메시지로는 기록한다 — 재수신·변환 판단). 설정은 그 방송의 스냅샷 (D-070)
  const settings = d.settingsOf(e.b)
  const ignored = e.owner === true && settings['claim.ignoreOwner']
  const published = e.publishedAt ?? d.at
  const message = { ch: e.ch, seq: d.seq, at: d.at, publishedAt: published, ignored, order: false, cancel: false, converted: [], review: false }
  if (ignored) {
    d.newMessage(key, message)
    return
  }
  // ③ 구매자 기록·닉네임 갱신 (R-11, 주문이 아닌 메시지도)
  const known = d.readBuyer(e.ch)
  if (known === undefined) d.newBuyer(e.ch, 'youtube', e.nick, null)
  else if (known.display !== e.nick) {
    const buyer = d.knownBuyer(e.ch)
    buyer.display = e.nick
    buyer.names.push(e.nick)
  }
  const base = { b: e.b, buyer: e.ch, origin: 'chat' as const, seq: d.seq, at: d.at, time: published, minute: false, message: key, ref: null, received: null, item: e.id }
  if (settings['claim.parseMode'] === 'OPTIONS') {
    // 옵션 방송 (R-20): 번호 문법 먼저 → 상품 → 옵션 → 수량. 받을 때의 해석으로 주문·취소·확인 필요를 정하고 나중에 다시 읽지 않는다
    const parsed = parseOptionComment(e.text, catalogOf(d, e.b), focusOf(d, e.b), settings)
    d.newMessage(key, { ...message, order: parsed.orders.length > 0, cancel: parsed.cancels.length > 0, review: parsed.review !== null })
    for (const order of parsed.orders) {
      const product = d.readSlot(slotKey(e.b, order.no))?.product
      const variant = variantOf(product, order.options)
      makeClaim(d, { ...base, no: order.no, variant: variant?.text ?? null, options: variant?.pairs ?? null, qty: order.qty, qtyWritten: order.qty !== 1 })
    }
    for (const no of parsed.cancels) viewerCancel(d, e.b, no, e.ch)
    if (parsed.review !== null) {
      const { reason, no, options, qty } = parsed.review
      const product = no === undefined ? null : (d.readSlot(slotKey(e.b, no))?.product ?? null)
      const pairs = options === undefined || product === null ? null : product.options.filter((item) => Object.hasOwn(options, item.name)).map((item) => [item.name, options[item.name] as string] as const)
      addReview(d, { ...base, origin: 'chat' }, reason, { no: no ?? null, options: pairs, qty: qty ?? null })
    }
    return
  }
  // 그 방송 설정으로 R-3. 주문·취소 번호를 하나라도 읽었으면 "주문·취소였던 메시지" — 받을 때의 해석으로 정하고 나중에 다시 읽지 않는다 (D-062, D-076)
  const parsed = parseChat(e.text, settings)
  // 번호 없는 "패스"(D-RETRO-103·113)도 취소였던 메시지다 — 어느 번호로도 변환하지 않는다 (D-076)
  const pass = parsed.claims.length === 0 && parsed.cancels.length === 0 && isBarePass(e.text)
  d.newMessage(key, { ...message, order: parsed.claims.length > 0, cancel: parsed.cancels.length > 0 || pass })
  // ④ 주문 번호마다 나온 순서대로 R-4, 취소는 R-8, 언급은 아무것도 바꾸지 않는다
  for (const no of parsed.claims) makeClaim(d, { ...base, no, variant: null, options: null, qty: 1, qtyWritten: false })
  for (const no of parsed.cancels) viewerCancel(d, e.b, no, e.ch)
  if (pass) barePass(d, e.b, e.ch)
}

/**
 * 번호 없는 "패스" (R-8 "패스", D-RETRO-103·113). 그 채널 자신의 그 방송 살아 있는 찜(보류·1등·대기·충돌)이
 * - 하나뿐이면: 어느 찜인지 확실하다 — 그 번호의 시청자 채팅 취소(R-8, viewerCancel)와 같다. AUTO면 취소(대기 순번도 같은 길로 당겨진다), REQUEST면 취소 요청.
 * - 둘 이상이면: 취소하지 않는다. 아직 요청이 없는 그 찜마다 이 seq의 취소 요청을 건다(AUTO여도) — 판매자 화면이 한 묶음("○○님이 패스라고 썼어요")으로 보여 고르게 한다.
 *   한 메시지가 둘 이상의 찜에 같은 seq의 요청을 거는 것은 이 경우뿐이다(번호 취소는 번호 하나, 변형을 정하지 않은 요청은 번호 자리에 걸린다).
 * - 없으면 아무 일도 없다. cancel.buyerChat이 OFF면 번호 취소처럼 아무 일도 없다.
 * 합친 다른 구매자의 찜은 보지 않는다 — 번호 취소와 같이 그 채널 자신의 찜만 (R-8 "대상 찾기").
 */
function barePass(d: Draft, b: string, channel: string): void {
  if (d.settingsOf(b)['cancel.buyerChat'] === 'OFF') return
  const live: AnyClaim[] = []
  for (const id of d.claimIdsOf(channel)) {
    const claim = d.readClaim(id)
    if (claim !== undefined && claim.b === b && claim.buyer === channel && isActive(claim.status)) live.push(claim)
  }
  const only = live.length === 1 ? live[0] : undefined
  if (only !== undefined) {
    viewerCancel(d, b, only.no, channel)
    return
  }
  for (const claim of live) if (claim.request === null) d.claim(claim.id).request = d.seq
}

/** 그 번호에서 지금의 구매자의 활성 찜 전부 (번호 자신 + 변형마다), 생성 순서 */
function activeClaimsIn(d: Draft, b: string, no: number, buyer: string): AnyClaim[] {
  const key = slotKey(b, no)
  const slot = d.readSlot(key)
  if (slot === undefined) return []
  const out: AnyClaim[] = []
  for (const text of [null, ...slot.units.map((unit) => unit.text)]) {
    const claim = activeClaim(d, key, text, buyer)
    if (claim !== undefined) out.push(claim)
  }
  return out.sort((a, b2) => a.n - b2.n)
}

/**
 * R-8 "시청자 채팅 취소"·"대상 찾기"·"취소 요청 세부" (D-043, D-063). 잠금은 확정 찜에만 있고 입금 기록을 포함한다.
 * 그 번호에서 지금의 구매자의 활성 찜이 그 채널 자신의 찜(구매자 자신이 그 채널)일 때만 — 합친 다른 구매자의 찜이면 무시한다.
 * 옵션 상품(R-20 8, D-O-13): 그 채널 자신의 그 상품 활성 찜(모든 변형)이 하나면 R-8 그대로, 둘 이상이면 AUTO여도 변형을 정하지 않은 요청.
 */
function viewerCancel(d: Draft, b: string, no: number, channel: string): void {
  const mode = d.settingsOf(b)['cancel.buyerChat']
  if (mode === 'OFF') return
  const own = activeClaimsIn(d, b, no, channel).filter((claim) => claim.buyer === channel)
  if (own.length === 0) return
  if (own.length > 1) {
    if (d.readSlot(slotKey(b, no))?.requests.some((request) => request.buyer === channel) === true) return
    d.slot(b, no).requests.push({ buyer: channel, seq: d.seq })
    return
  }
  const current = own[0] as AnyClaim
  if (mode === 'AUTO' && !isLocked(d, current)) {
    release(d, d.claim(current.id), unitOfClaim(d, current), 'CANCELLED', null)
    return
  }
  if (current.request === null) d.claim(current.id).request = d.seq
}

/** 변형을 정하지 않은 요청은 그 채널의 그 상품 활성 찜이 모두 끝나면 사라진다 (D-043과 같은 뜻) */
function pruneRequests(d: Draft): void {
  for (const slot of d.touchedSlots()) {
    if (slot.requests.length === 0) continue
    slot.requests = slot.requests.filter((request) => activeClaimsIn(d, slot.b, slot.no, request.buyer).some((claim) => claim.buyer === request.buyer))
  }
}

// ── 문자찜 (R-11 "문자찜 구매자 정하기", D-051) ──────────────────────────

function sms(d: Draft, e: SmsEvent): void {
  // ref는 처음 받을 때 기록한다. 같은 ref가 다시 오면 내용이 달라도, 처음 것이 무엇을 했든 아무 일도 없다 (INV-3·INV-12, D-067)
  if (d.readRef(e.ref) !== undefined) return
  // 표시 이름: 문자 구매자는 가장 최근의 비어 있지 않은 메모(앞뒤 공백 제거)로 `문자찜(메모)`
  const memo = e.memo?.trim() ?? ''
  const display = memo === '' ? null : `${SMS_NAME}(${memo})`
  let buyer: string
  if (e.buyer !== undefined) {
    // 1. 지정 구매자 (전화번호 키는 보지도 기록하지도 않는다). 모르는 구매자면 찜·구매자·메모 반영 없이 ref만 기록한다
    if (d.readBuyer(e.buyer) === undefined) {
      d.setRef(e.ref, null)
      return
    }
    buyer = e.buyer
  } else {
    // 2. 전화번호 키가 있으면 그 키의 문자 구매자 / 3. 그 밖은 새 문자 구매자 (뒤 4자리 = 만든 문자찜의 것, 나중에 바꾸지 않는다)
    const linked = e.phoneKey === undefined ? undefined : d.readPhoneKey(e.phoneKey)
    if (linked !== undefined) buyer = linked
    else {
      buyer = `sms:${e.ref}`
      if (d.readBuyer(buyer) !== undefined) throw new CorruptStateError(`문자 구매자 ID ${buyer}가 이미 있다`)
      d.newBuyer(buyer, 'sms', display ?? SMS_NAME, e.phoneLast4 ?? null)
      if (e.phoneKey !== undefined) d.setPhoneKey(e.phoneKey, buyer)
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
  // 형식은 구조 검사(checkShape)가 이미 확인했다
  const received = resolveReceivedTime(e.received, d.at) as ReceivedTime
  const variant = variantOf(d.readSlot(slotKey(e.b, e.no))?.product, e.options)
  makeClaim(d, {
    b: e.b,
    no: e.no,
    buyer,
    origin: 'sms',
    seq: d.seq,
    at: d.at,
    time: received.time,
    minute: received.minute,
    message: null,
    ref: e.ref,
    received: e.received,
    variant: variant?.text ?? null,
    options: variant?.pairs ?? null,
    qty: e.qty ?? 1,
    qtyWritten: e.qty !== undefined,
    item: `sms:${e.ref}`,
    // 닉네임으로 보이기 (D-CLAIMADD-03): 판정·순위와 상관없이 이름만 — 문자 구매자면 감사 문구·라벨 쪽이 그대로 `문자찜`으로 읽는다
    ...(e.named === true ? { named: true } : {}),
  })
}

// ── 방송자 조치 (R-7, R-8, R-9, D-040~D-043, D-053, D-054, 옵션 방송은 R-19 "수량") ──

/**
 * 찜을 가리키는 방송자 조치의 대상 (R-19 "수량" 방송자 조치): options가 있으면 그 변형의 활성 찜.
 * 없으면 번호 자신의 활성 찜, 옵션 상품이면 그 구매자의 그 상품 활성 찜이 하나뿐일 때만 그 찜(둘 이상이면 없음).
 */
function targetOf(d: Draft, e: { readonly b: string; readonly no: number; readonly buyer: string; readonly options?: OptionPick }): AnyClaim | undefined {
  const key = slotKey(e.b, e.no)
  const slot = d.readSlot(key)
  if (e.options !== undefined) {
    const variant = pickedVariant(d, slot, e.options)
    return variant === null ? undefined : activeClaim(d, key, variant.text, e.buyer)
  }
  if (slot === undefined || slot.units.length === 0) return activeClaim(d, key, null, e.buyer)
  const all = activeClaimsIn(d, e.b, e.no, e.buyer)
  return all.length === 1 ? all[0] : undefined
}

/** host.cancel → CANCELLED, host.reject → REJECTED(BY_HOST). 지금의 구매자의 활성 찜이 없으면 아무 일도 없다 */
function hostRelease(d: Draft, e: HostClaimEvent): void {
  const current = targetOf(d, e)
  if (current === undefined) return
  const [status, reason] = e.type === 'host.reject' ? (['REJECTED', 'BY_HOST'] as const) : (['CANCELLED', null] as const)
  release(d, d.claim(current.id), unitOfClaim(d, current), status, reason)
}

/** host.promote: 자리가 비어 있고(남은 수량 1 이상) 대상이 대기 찜일 때만 확정 (대기 몇 순위든) */
function promote(d: Draft, e: HostClaimEvent): void {
  const current = targetOf(d, e)
  if (current?.status !== 'WAITLISTED') return
  // 대기 찜이 있는 번호에는 상품이 있다 (대기는 판매 중인 상품에서 생기고, 대기가 남은 상품은 닫히지 않는다)
  const slot = d.readSlot(slotKey(current.b, current.no)) as NonNullable<ReturnType<Draft['readSlot']>>
  const product = slot.product as ProductRecord
  const record = current.variant === null ? slot : (slot.units.find((unit) => unit.text === current.variant) as NonNullable<(typeof slot.units)[number]>)
  if (stockOf(product, current.variant) - confirmedUnits(d, record.winners) < current.qty) return
  const unit = unitOfClaim(d, current)
  unit.waitlist.splice(unit.waitlist.indexOf(current.id), 1)
  confirm(d, d.claim(current.id), unit, product)
  settleAwaiting(d, unit)
}

/** 변형을 정하지 않은 그 채널의 요청 */
function hasProductRequest(d: Draft, claim: AnyClaim): boolean {
  return d.readSlot(slotKey(claim.b, claim.no))?.requests.some((request) => request.buyer === claim.buyer) === true
}

function dropProductRequest(d: Draft, claim: AnyClaim): void {
  if (!hasProductRequest(d, claim)) return
  const slot = d.slot(claim.b, claim.no)
  slot.requests = slot.requests.filter((request) => request.buyer !== claim.buyer)
}

/** host.confirm: 확정 찜에 잠금만 건다 (R-7.3). host.approveCancel·host.dismissCancel: 처리 대기 요청이 있을 때만 */
function claimAction(d: Draft, e: HostClaimOptionalReasonEvent): void {
  const current = targetOf(d, e)
  if (current === undefined) return
  if (e.type === 'host.confirm') {
    if (current.status === 'CONFIRMED' && !current.locked) d.claim(current.id).locked = true
    return
  }
  if (current.request === null && !hasProductRequest(d, current)) return
  dropProductRequest(d, current)
  if (e.type === 'host.dismissCancel') d.claim(current.id).request = null
  else release(d, d.claim(current.id), unitOfClaim(d, current), 'CANCELLED', null)
}

/** host.reopen: "승계 결정 필요" 표시가 있을 때만 REOPEN 규칙 (D-041). 옵션 상품이면 options로 변형을 고른다(없으면 아무 일도 없다) */
function reopen(d: Draft, e: HostReopenEvent): void {
  const key = slotKey(e.b, e.no)
  const slot = d.readSlot(key)
  if (slot === undefined) return
  const variant = e.options === undefined ? null : pickedVariant(d, slot, e.options)
  if (variant === null && slot.units.length > 0) return
  const text = variant?.text ?? null
  const record = text === null ? slot : slot.units.find((unit) => unit.text === text)
  if (record?.awaiting !== true) return
  clearWaitlist(d, d.unit(e.b, e.no, text))
}

/**
 * host.assign: 직접 배정·1등 교체 (R-9, D-042, 옵션 방송은 R-19 "수량"·D-O1-05). 구매자는 지금의 구매자로 본다.
 * 충돌 중인 자리면 교체가 있든 없든 아무 일도 없다 — 방송자는 충돌부터 정한다 (D-064). replace·replaceTo 한쪽만은 입력 오류다(checkShape, D-065).
 * 빈 자리 = 배정 수량 ≤ 남은 수량. 교체는 밀려나는 1등의 수량을 더해 본다. 수량 2 이상 1등의 WAITLIST 교체는 아무 일도 없다(대기하지 않는다).
 * 교체 뒤에도 남은 수량이 있으면(밀려난 수량 > 배정 수량) 승계 규칙을 그대로 적용한다 — 확정이 풀린 것과 같다(D-O1-05).
 */
function assign(d: Draft, e: HostAssignEvent): void {
  const key = slotKey(e.b, e.no)
  const current = d.readSlot(key)
  const product = current?.product
  if (current === undefined || product === null || product === undefined || product.phase !== 'SELLING') return
  const variant = variantOf(product, e.options)
  if (product.options.length > 0 && variant === null) return
  const text = variant?.text ?? null
  const record = text === null ? current : current.units.find((unit) => unit.text === text)
  if (record === undefined || record.conflict !== null) return
  if (d.readBuyer(e.buyer) === undefined) return
  const { replace, replaceTo } = e
  const qty = e.qty ?? 1
  const own = activeClaim(d, key, text, e.buyer)
  if (own !== undefined && own.status !== 'WAITLISTED') return
  const remaining = stockOf(product, text) - confirmedUnits(d, record.winners)
  let target: ClaimDraft | undefined
  if (replace !== undefined) {
    const winner = activeClaim(d, key, text, replace)
    if (winner?.status !== 'CONFIRMED') return
    if (replaceTo === 'WAITLIST' && winner.qty >= 2) return
    if (qty > remaining + winner.qty) return
    target = d.claim(winner.id)
  } else if (qty > remaining) return
  const unit = d.unit(e.b, e.no, text)
  // 그 구매자의 대기 찜이 있으면 먼저 대기에서 빠져 확정된다(새 찜 없음, INV-2). 없으면 새 확정 찜(순위 = 이 조치, R-6)
  let claim: ClaimDraft
  if (own === undefined) {
    claim = d.newClaim(
      newClaimFields({
        b: e.b,
        no: e.no,
        buyer: e.buyer,
        origin: 'assign',
        seq: d.seq,
        at: d.at,
        time: d.at,
        minute: false,
        message: null,
        ref: null,
        received: null,
        variant: text,
        options: variant?.pairs ?? null,
        qty,
        qtyWritten: e.qty !== undefined,
        item: null,
      }),
    )
  } else {
    unit.waitlist.splice(unit.waitlist.indexOf(own.id), 1)
    claim = d.claim(own.id)
    if (e.qty !== undefined && claim.qty !== qty) {
      claim.qty = qty
      claim.qtyWritten = true
    }
  }
  if (target !== undefined) {
    unconfirm(d, target, unit)
    if (replaceTo === 'CANCEL') finish(d, target, unit, 'CANCELLED', null)
  }
  confirm(d, claim, unit, product)
  // 교체된 1등은 대기 1순위 (차단 중이면 REJECTED(BLOCKED), D-049). 넘치면 맨 끝 대기자부터 품절
  if (target !== undefined && replaceTo === 'WAITLIST') displace(d, target, unit)
  if (target !== undefined && replaceTo === 'CANCEL' && target.qty > qty) succession(d, unit, product, target.qty - qty)
  trimWaitlist(d, unit)
  settleAwaiting(d, unit)
}

/** host.resolveConflict (R-7 7): KEEP = c를 대기 자리에, SWITCH = c 확정·가장 뒤 1등 → 대기 1순위. 충돌이 없으면 아무 일도 없다 */
function resolveConflict(d: Draft, e: HostResolveConflictEvent): void {
  if ((d.readSlot(slotKey(e.b, e.no))?.conflict ?? null) === null) return
  const unit = d.unit(e.b, e.no, null)
  if (e.decision === 'KEEP') resolveKeep(d, unit)
  else resolveSwitch(d, unit)
  settleAwaiting(d, unit)
}

/**
 * host.convertMessage (R-7 4, D-054, D-062, D-076): 그 방송에서 받은 주문도 취소도 아니었던 메시지를 찜으로. 구매자 = 메시지 채널, 순위 재료·at = 원래 메시지.
 * 모르는 메시지·무시한 방송자 메시지·주문이나 취소였던 메시지(어느 번호로든)·이미 그 번호로 바꾼 메시지는 아무 일도 없다.
 * 옵션 방송(R-20 7, D-O1-07): 옵션 상품을 가리키거나 받을 때 확인 필요 항목이 된 메시지면 아무 일도 없다. 수량 1, 1등을 밀어내지 않는다(rules contend).
 */
function convert(d: Draft, e: HostConvertMessageEvent): void {
  const key = messageKey(e.b, e.msg)
  const message = d.readMessage(key)
  if (message === undefined || message.ignored || message.order || message.cancel || message.review || message.converted.includes(e.no)) return
  if ((d.readSlot(slotKey(e.b, e.no))?.product?.options.length ?? 0) > 0) return
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
    variant: null,
    options: null,
    qty: 1,
    qtyWritten: false,
    item: null,
  })
  if (claim !== null) d.message(key).converted.push(e.no)
}

/**
 * host.resolveReview (R-20 7, D-O-10·D-O1-04): 확인 필요 항목을 그 구매자의 찜으로. 순위 재료·at = 원래 메시지(입력).
 * 아무 일도 없는 경우(항목이 남는다): 항목 없음, 상품이 판매 중 아님(READY·HOLD·CLOSED), 같은 자리에 그 구매자의 활성 찜이 있음,
 * 수량 2 이상인데 남은 수량이 모자라거나 앞선 대기자가 있음(승계 결정 필요 자리도 같다).
 * 그 밖: 차단된 구매자면 REJECTED(BLOCKED). 승계 결정 필요 자리의 수량 1은 대기 자리. 1등을 밀어내지 않는다 — 수량 ≤ 남은 수량이고
 * 순위가 앞선 대기자가 없으면 확정, 아니면 수량 1은 대기 자리(넘치면 맨 끝 품절). 찜이 생기면 항목이 사라진다.
 */
function resolveReview(d: Draft, e: HostResolveReviewEvent): void {
  const rkey = reviewKey(e.b, e.item)
  const review = d.readReview(rkey)
  if (review === undefined) return
  const key = slotKey(e.b, e.no)
  const slot = d.readSlot(key)
  const product = slot?.product
  if (slot === undefined || product === null || product === undefined || product.phase !== 'SELLING') return
  const variant = variantOf(product, e.options)
  const text = variant?.text ?? null
  if (activeIdIn(d, slot, text, review.buyer) !== undefined) return
  const fields = (): Omit<ClaimDraft, 'id' | 'n'> =>
    newClaimFields({
      b: e.b,
      no: e.no,
      buyer: review.buyer,
      origin: review.origin,
      seq: review.seq,
      at: review.at,
      time: review.time,
      minute: review.minute,
      message: review.message,
      ref: review.ref,
      received: review.received,
      variant: text,
      options: variant?.pairs ?? null,
      qty: e.qty,
      qtyWritten: true,
      item: null,
    })
  if (d.isBlocked(review.buyer)) {
    const claim = d.newClaim(fields())
    claim.status = 'REJECTED'
    claim.reason = 'BLOCKED'
    claim.pid = product.id
    d.setReview(rkey, null)
    return
  }
  const record = text === null ? slot : (slot.units.find((unit) => unit.text === text) as NonNullable<typeof slot.units[number]>)
  const remaining = stockOf(product, text) - confirmedUnits(d, record.winners)
  const material = { seq: review.seq, time: review.time, minute: review.minute, n: Number.POSITIVE_INFINITY, b: e.b }
  const ahead = record.waitlist.some((id) => {
    const other = d.readClaim(id)
    if (other === undefined) throw new CorruptStateError(`대기 찜 ${id}가 없다`)
    return compareClaims(d, other, material) < 0
  })
  const confirmNow = !record.awaiting && e.qty <= remaining && !ahead
  if (!confirmNow && e.qty >= 2) return
  const unit = d.unit(e.b, e.no, text)
  const claim = d.newClaim(fields())
  if (confirmNow) confirm(d, claim, unit, product)
  else queue(d, claim, unit)
  settleAwaiting(d, unit)
  d.setReview(rkey, null)
}

/** host.dismissReview (R-20 7): 주문이 아닌 것으로 정하고 항목을 지운다. 없는 항목이면 아무 일도 없다 */
function dismissReview(d: Draft, e: HostDismissReviewEvent): void {
  const key = reviewKey(e.b, e.item)
  if (d.readReview(key) !== undefined) d.setReview(key, null)
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
    const unit = unitOfClaim(d, record)
    detach(record, unit)
    finish(d, d.claim(id), unit, 'REJECTED', 'BLOCKED')
    settleAwaiting(d, unit)
  }
}

// ── 구매자 합치기 (R-11, D-057, D-100) ──────────────────────────────────

/** 막는 조건과 "앞선 쪽" 순서는 미리 보기(previewMerge)와 같은 계획 함수(merge.ts)로 정한다. 막히면 아무 일도 없다 */
function merge(d: Draft, e: BuyerMergeEvent): void {
  const plan = planMerge(d, e.from, e.into)
  if (plan.blocked === null) applyMerge(d, e.from, e.into, plan)
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
    if (claim.variant === null) {
      if (pget(slot.active, oldRoot) !== claim.id) throw new CorruptStateError(`${slot.key}: 찜 ${claim.id}의 활성 표시가 없다`)
      slot.active = pset(pdelete(slot.active, oldRoot), e.from, claim.id)
    } else {
      const before = variantActiveKey(oldRoot, claim.variant)
      if (pget(slot.variantActive, before) !== claim.id) throw new CorruptStateError(`${unitKeyOf(slot.key, claim.variant)}: 찜 ${claim.id}의 활성 표시가 없다`)
      slot.variantActive = pset(pdelete(slot.variantActive, before), variantActiveKey(e.from, claim.variant), claim.id)
    }
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
  'broadcast.start': startBroadcast,
  'broadcast.end': endBroadcast,
  'broadcast.thanks': switchThanks,
  'broadcast.pendingExpire': switchPendingExpire,
  'product.register': register,
  'product.open': productCommand,
  'product.hold': productCommand,
  'product.close': productCommand,
  'product.update': update,
  'product.renumber': renumber,
  'product.confirm': confirmTentative,
  'product.withdraw': withdraw,
  'product.focus': focus,
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
  'host.resolveReview': resolveReview,
  'host.dismissReview': dismissReview,
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
 * - 상태 형식이 다르면 StateFormatError, 입력 오류(구조 검사 checkShape)면 InvalidEventError(상태 그대로).
 *   판매자가 적는 칸의 휴대폰 번호는 보지 않는다 — 기록 전 검사(checkEvent)만 본다. 기록된 로그의 재생이 규칙 변경으로 빠지지 않게(D-079 ⑤, RA-S04-011).
 * - 처음 쓰는 스프린트가 따로 있는 종류, settlement.groupBy=MANUAL인 broadcast.start(이미 선언한 방송의 사본이어도 — 로그에 남지 않게)는 NotImplementedError.
 */
export function applyEvent(state: EngineState, event: EngineEvent): ApplyResult {
  assertStateFormat(state)
  const problems = checkShape(state, event)
  const type = typeof event === 'object' && event !== null && typeof event.type === 'string' ? event.type : null
  if (problems.length > 0) throw new InvalidEventError(type, problems)
  const deferred = ownGet(DEFERRED_EVENTS, type as string)
  if (deferred !== undefined) throw new NotImplementedError(deferred)
  if (event.type === 'broadcast.start' && resolveSettings(event.settings ?? {})['settlement.groupBy'] === 'MANUAL') throw new NotImplementedError(MANUAL_GROUPING)
  const handler = ownGet(HANDLERS, type as string) as (d: Draft, event: EngineEvent) => void
  const draft = new Draft(state, event)
  handler(draft, event)
  pruneRequests(draft)
  pruneUnits(draft)
  return draft.commit()
}
