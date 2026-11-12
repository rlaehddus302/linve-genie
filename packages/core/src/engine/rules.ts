// 판정 규칙 (DOMAIN_RULES R-4, R-5, R-7, R-8, R-13, 옵션 방송은 R-19). 모두 작업 사본(Draft) 위에서 돈다.
// "같은 구매자"는 지금의 구매자(합친 결과), "차단"은 찜의 구매자 자신으로 본다(R-4 머리말, R-11).
// 설정은 그 찜·상품이 속한 방송의 스냅샷으로 읽는다(d.settingsOf(방송), D-070). 한 번호(slot)의 찜은 모두 그 번호의 방송에 속한다.
// 판정 단위는 판정 자리(Unit)다: 옵션 없는 상품이면 번호 자신, 옵션 상품이면 변형 하나(R-19 "판정 단위는 변형이다").
// 확정·대기·승계 결정 필요·충돌·대기 한도는 자리마다, 확정버전·보류 찜·상품 상태는 번호(상품)마다다.
// 수량(R-19 "수량"): "확정 찜 수 < 재고"는 "수량 ≤ 남은 수량"으로 읽는다. 대기 찜은 늘 수량 1이다(INV-O1).
import { formatThanksText } from '../format.ts'
import { indexesOfText, unitPriceOf } from '../options.ts'
import { CorruptStateError, Unit, unitKeyOf, variantActiveKey, type ClaimDraft, type Draft, type SlotDraft } from './draft.ts'
import { receivedOf } from './ledger.ts'
import { emptyPMap, pdelete, pget, pkeys, pset } from './pmap.ts'
import { compareRank, isSameMinuteTie, type RankMaterial } from './rank.ts'
import type { SaleSettings } from '../settings.ts'
import type { ClaimReason, ClaimRecord, ClaimStatus, EffectKind, EffectRecord, ProductRecord, ReviewReason, SlotRecord, ThanksTarget, UnitRecord } from './types.ts'

/**
 * R-4 판정 결과. none = 4번 줄(같은 사람 반복) — 새 찜을 만들지 않는다. contend = 자리가 다 찼다(R-7 → 7·8번 줄).
 * review = 수량 2 이상인데 남은 수량이 모자란다 — 찜을 만들지 않고 확인 필요로 보낸다(R-19 "수량", STOCK_SHORT).
 */
export type Outcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'waitlist' }
  | { readonly kind: 'contend' }
  | { readonly kind: 'review'; readonly reason: ReviewReason }
  | { readonly kind: 'reject'; readonly reason: ClaimReason }

const NONE: Outcome = { kind: 'none' }
const PENDING: Outcome = { kind: 'pending' }
const CONFIRM: Outcome = { kind: 'confirm' }
const WAITLIST: Outcome = { kind: 'waitlist' }
const CONTEND: Outcome = { kind: 'contend' }
const STOCK_SHORT: Outcome = { kind: 'review', reason: 'STOCK_SHORT' }
const reject = (reason: ClaimReason): Outcome => ({ kind: 'reject', reason })

/** 감사 문구에 쓰는 문자 구매자 이름 (YT-04 AC1) */
export const SMS_NAME = '문자찜'

/** 활성 찜 = 확정·대기·보류·충돌 (INV-2) */
export function isActive(status: ClaimStatus): boolean {
  return status === 'CONFIRMED' || status === 'WAITLISTED' || status === 'PENDING' || status === 'CONFLICT'
}

type AnyClaim = ClaimRecord | ClaimDraft
type AnySlot = SlotRecord | SlotDraft

/** 방송의 날짜 (정산 묶음 날짜, R-12) */
export function dateOf(d: Draft, b: string): string {
  return d.broadcastOf(b).date
}

/** 옵션 방송인가 (claim.parseMode=OPTIONS, R-19 "판매 방식") */
export function isOptionBroadcast(d: Draft, b: string): boolean {
  return d.settingsOf(b)['claim.parseMode'] === 'OPTIONS'
}

// ── 판정 자리 읽기 ───────────────────────────────────────────────────────

/** 번호의 판정 자리 기록 (text = null이면 번호 자신). 옵션 상품에 없는 변형이면 undefined */
export function unitRecordOf(slot: AnySlot, text: string | null): UnitRecord | AnySlot | undefined {
  return text === null ? slot : slot.units.find((unit) => unit.text === text)
}

/** 판정 자리의 재고: 옵션 없는 상품은 상품 재고, 변형은 변형 재고 (상품이 없으면 0) */
export function stockOf(product: ProductRecord | null, text: string | null): number {
  if (product === null) return 0
  if (text === null) return product.options.length === 0 ? product.stock : 0
  return product.variants.find((variant) => variant.text === text)?.stock ?? 0
}

/** 판정 자리의 확정 수량 = 확정 찜 수량의 합 (R-19 "수량") */
export function confirmedUnits(d: Draft, winners: readonly string[]): number {
  let total = 0
  for (const id of winners) {
    const claim = d.readClaim(id)
    if (claim === undefined) throw new CorruptStateError(`확정 찜 ${id}가 없다`)
    total += claim.qty
  }
  return total
}

/** 남은 수량 = 재고 − 확정 수량 */
export function remainingOf(d: Draft, product: ProductRecord | null, text: string | null, winners: readonly string[]): number {
  return stockOf(product, text) - confirmedUnits(d, winners)
}

/** 변형 단가 = 상품 가격 + 가격 차이 합 (R-19 "가격"). 옵션 없는 찜은 상품 가격 */
export function unitPrice(product: ProductRecord, text: string | null): number {
  if (text === null) return product.price
  const indexes = indexesOfText(product.options, text)
  if (indexes === null) throw new CorruptStateError(`상품 ${product.id}에 변형 '${text}'가 없다`)
  return unitPriceOf(product.price, product.options, indexes)
}

// ── 활성 표시 (지금의 구매자 → 활성 찜) ──────────────────────────────────

/** 그 번호·자리에서 지금의 구매자의 활성 찜 ID */
export function activeIdIn(d: Draft, slot: AnySlot | undefined, text: string | null, buyer: string): string | undefined {
  if (slot === undefined) return undefined
  const root = d.root(buyer)
  return text === null ? pget(slot.active, root) : pget(slot.variantActive, variantActiveKey(root, text))
}

function setActive(d: Draft, unit: Unit, claim: AnyClaim): void {
  const root = d.root(claim.buyer)
  const slot = unit.slot
  if (unit.text === null) slot.active = pset(slot.active, root, claim.id)
  else slot.variantActive = pset(slot.variantActive, variantActiveKey(root, unit.text), claim.id)
}

function clearActive(d: Draft, unit: Unit, claim: AnyClaim): void {
  const root = d.root(claim.buyer)
  const slot = unit.slot
  if (unit.text === null) {
    if (pget(slot.active, root) === claim.id) slot.active = pdelete(slot.active, root)
    return
  }
  const key = variantActiveKey(root, unit.text)
  if (pget(slot.variantActive, key) === claim.id) slot.variantActive = pdelete(slot.variantActive, key)
}

// ── R-4 판정표 ───────────────────────────────────────────────────────────

/**
 * R-4 판정표 (자리 text, 수량 qty). 4번 줄(같은 사람 활성 찜)을 맨 먼저 본다(D-038).
 * 5번 줄(승계 결정 필요)은 대기 자리, 6번 줄은 "수량 ≤ 남은 수량"이면 확정, 자리가 모자라면 수량 1은 contend(R-7을 본 뒤 7·8번 줄).
 * 수량 2 이상은 대기하지 않는다(R-19 "수량"): 남은 수량 0이면 품절, 아니면 확인 필요(STOCK_SHORT) — 승계 결정 필요 자리여도 같다.
 * @param self 이미 있는 찜을 다시 판정할 때(보류 찜 공개) 그 찜 ID — 자기 자신은 "같은 사람의 다른 찜"이 아니다
 */
export function decide(d: Draft, slot: AnySlot | undefined, text: string | null, buyer: string, qty: number, self?: string): Outcome {
  const holder = activeIdIn(d, slot, text, buyer)
  if (holder !== undefined && holder !== self) return NONE
  if (d.isBlocked(buyer)) return reject('BLOCKED')
  const product = slot?.product ?? null
  if (product === null || product.phase === 'READY') return PENDING
  if (product.phase !== 'SELLING') return reject('NOT_ON_SALE')
  // slot은 상품이 있으면 반드시 있고, 자리는 부르는 쪽이 그 상품의 변형으로 정했다
  const record = unitRecordOf(slot as AnySlot, text)
  if (record === undefined) throw new CorruptStateError(`${(slot as AnySlot).key}: 변형 '${String(text)}'의 판정 자리가 없다`)
  const remaining = remainingOf(d, product, text, record.winners)
  if (qty >= 2) {
    if (remaining <= 0) return reject('SOLD_OUT')
    return record.awaiting || qty > remaining ? STOCK_SHORT : CONFIRM
  }
  if (record.awaiting) return WAITLIST
  if (remaining >= 1) return CONFIRM
  return CONTEND
}

/** 상품에 붙은 찜으로 표시한다 (번호를 바꾸면 찜의 상품 키가 상품을 따라간다, D-056) */
function attach(claim: ClaimDraft, unit: Unit): void {
  if (claim.pid === null && unit.product !== null) claim.pid = unit.product.id
}

/** 찜을 활성이 아닌 상태로 끝낸다: 상태·사유, 활성 표시와 취소 요청을 지운다 (D-043: 찜이 끝나면 요청도 사라진다) */
export function finish(d: Draft, claim: ClaimDraft, unit: Unit, status: 'REJECTED' | 'CANCELLED' | 'DUPLICATE', reason: ClaimReason | null): void {
  attach(claim, unit)
  claim.status = status
  claim.reason = reason
  claim.request = null
  clearActive(d, unit, claim)
}

function remove(list: string[], id: string): void {
  const at = list.indexOf(id)
  if (at >= 0) list.splice(at, 1)
}

/** 판정 순위 비교 (R-6) — 같은 번호의 찜끼리, 그 방송의 경합 정책으로. 같은 키면 생성 순서 */
export function compareClaims(d: Draft, a: RankMaterial & { readonly n: number; readonly b: string }, b: RankMaterial & { readonly n: number }): number {
  return compareRank(a, b, d.settingsOf(a.b)) || a.n - b.n
}

/** 보류 찜 ID, 판정 순위 순 */
export function sortedPending(d: Draft, slot: AnySlot): string[] {
  const claims = pkeys(slot.pending).map((id) => {
    const claim = d.readClaim(id)
    if (claim === undefined) throw new CorruptStateError(`보류 찜 ${id}가 없다`)
    return claim
  })
  return claims.sort((a, b) => compareClaims(d, a, b)).map((claim) => claim.id)
}

// ── 효과 (R-13) ──────────────────────────────────────────────────────────

interface Place {
  readonly key: string
  readonly b: string
  readonly no: number
}

function emit(d: Draft, claim: ClaimDraft, kind: EffectKind, target: ThanksTarget | null, version: number, text: string | null, place: Place): void {
  const id = `${claim.id}:${kind}:${target ?? '-'}:${String(version)}`
  d.newEffect({ id, seq: d.seq, kind, target, claim: claim.id, key: place.key, b: place.b, no: place.no, buyer: claim.buyer, text, version, status: 'PENDING' })
  claim.effects.push(id)
}

/**
 * 감사 문구의 구매자 이름 (R-13, D-057): 찜의 구매자 자신 기준이고 합치기와 상관없다.
 * 문자찜으로 생긴 찜(지정 구매자가 유튜브 채널이어도)과 문자 구매자의 찜은 항상 `문자찜`, 그 밖은 그 채널의 가장 최근 닉네임.
 */
function thanksName(d: Draft, claim: AnyClaim): string {
  if (claim.origin === 'sms') return SMS_NAME
  const buyer = d.knownBuyer(claim.buyer)
  return buyer.kind === 'sms' ? SMS_NAME : buyer.display
}

/** 찜 금액 = 단가 스냅샷 × 수량 (정수 곱, R-19 "가격") */
export function amountOf(claim: Pick<ClaimRecord, 'price' | 'qty'>): number {
  return (claim.price as number) * claim.qty
}

/** R-4·R-13: 찜을 확정하고 확정버전(상품마다)을 올린 뒤 설정대로 효과를 낸다. 가격 스냅샷 = 그때의 변형 단가 */
export function confirm(d: Draft, claim: ClaimDraft, unit: Unit, product: ProductRecord): void {
  unit.version += 1
  const version = unit.version
  attach(claim, unit)
  const price = unitPrice(product, claim.variant)
  claim.status = 'CONFIRMED'
  claim.reason = null
  claim.price = price
  claim.version = version
  claim.locked = false
  claim.reprint = false
  unit.winners.push(claim.id)
  setActive(d, unit, claim)
  d.knownBuyer(claim.buyer).subtotal += price * claim.qty
  const settings = d.settingsOf(unit.b)
  if (settings['print.autoOnConfirm']) emit(d, claim, 'PRINT_PRODUCT_LABEL', null, version, null, unit)
  const text = formatThanksText({ no: unit.no, name: product.name, price, buyerName: thanksName(d, claim), optionText: claim.variant, qty: claim.qty })
  if (settings['thanks.liveChat']) emit(d, claim, 'POST_THANKS', 'LIVE_CHAT', version, text, unit)
  if (settings['thanks.videoComment'] === 'PER_SALE') emit(d, claim, 'POST_THANKS', 'VIDEO_COMMENT', version, text, unit)
}

/** 지금 확정의 상품 라벨 출력 완료 보고가 있는지 */
export function labelPrinted(d: Draft, claim: AnyClaim): boolean {
  return claim.effects.some((id) => {
    const effect = d.readEffect(id)
    return effect?.kind === 'PRINT_PRODUCT_LABEL' && effect.version === claim.version && effect.status === 'DONE'
  })
}

/**
 * R-13 "확정이 풀릴 때": 지금 확정의 미실행 효과는 취소, 출력 완료된 라벨은 VOID_LABEL(그 라벨의 확정버전·상품 키).
 * 게시된 감사는 그대로 둔다. 확정 목록에서 빼고 구매자 합계에서 찜 금액을 뺀다. 상태는 부르는 쪽이 정한다.
 */
export function unconfirm(d: Draft, claim: ClaimDraft, unit: Unit): void {
  const version = claim.version
  for (const id of [...claim.effects]) {
    const effect = d.readEffect(id)
    if (effect === undefined) throw new CorruptStateError(`찜 ${claim.id}의 효과 ${id}가 없다`)
    if (effect.version !== version || effect.kind === 'VOID_LABEL') continue
    if (effect.status === 'PENDING') d.effect(effect).status = 'CANCELLED'
    else if (effect.status === 'DONE' && effect.kind === 'PRINT_PRODUCT_LABEL') voidLabel(d, claim, effect)
  }
  remove(unit.winners, claim.id)
  d.knownBuyer(claim.buyer).subtotal -= amountOf(claim)
  claim.locked = false
  claim.reprint = false
}

/** 출력된 라벨의 폐기 표시 (R-13). 확정버전·상품 키 = 폐기할 라벨의 것 (번호를 바꿨어도, D-056) */
export function voidLabel(d: Draft, claim: ClaimDraft, label: EffectRecord): void {
  emit(d, claim, 'VOID_LABEL', null, label.version, null, label)
}

// ── 잠금 (R-7 3, D-053) ──────────────────────────────────────────────────

/** 그 찜이 속한 정산 묶음(지금의 구매자, 방송 날짜)의 받은 금액 */
export function groupReceived(d: Draft, claim: AnyClaim): number {
  return receivedOf(d, d.root(claim.buyer), dateOf(d, claim.b))
}

/** 확정 찜의 잠금: 지금 확정의 출력·게시 보고, host.confirm, 또는 입금 기록(묶음 받은 금액 > 0) */
export function isLocked(d: Draft, claim: AnyClaim): boolean {
  return claim.status === 'CONFIRMED' && (claim.locked || groupReceived(d, claim) > 0)
}

/** R-7 비교에서의 잠금: 위 잠금 + 직접 배정으로 새로 만든 찜은 늘 잠금 후 */
function lockedForContest(d: Draft, claim: AnyClaim): boolean {
  return claim.origin === 'assign' || isLocked(d, claim)
}

// ── 대기 (R-4 "대기에 넣는 자리", D-053) ─────────────────────────────────

/** 대기 인원 한도 (그 방송의 스냅샷 — 설정값은 0~100 정수로 검사했다, D-071) */
function waitlistLimit(settings: SaleSettings): number {
  return settings['waitlist.max']
}

/** 넣은 뒤 대기 수가 한도를 넘으면 맨 끝 대기자부터 REJECTED(SOLD_OUT) */
export function trimWaitlist(d: Draft, unit: Unit): void {
  const limit = waitlistLimit(d.settingsOf(unit.b))
  while (unit.waitlist.length > limit) finish(d, d.claim(unit.waitlist.pop() as string), unit, 'REJECTED', 'SOLD_OUT')
}

/**
 * 새 찜·KEEP·풀린 충돌·대기로 가는 변환·바로잡기: 자기보다 순위가 앞서는 대기자 중 가장 뒤에 있는 대기자 바로 뒤(없으면 1순위), 넘치면 맨 끝 품절.
 * ARRIVAL의 새 찜은 순위가 늘 맨 뒤라 맨 끝이다.
 * @param trim false면 넘침 정리를 부르는 쪽에 맡긴다 (확정 자리가 비어 풀린 충돌 찜 — 승계·재고 규칙 뒤에 정리, D-068)
 */
export function queue(d: Draft, claim: ClaimDraft, unit: Unit, trim = true): void {
  let at = 0
  for (let i = unit.waitlist.length - 1; i >= 0; i--) {
    const other = d.readClaim(unit.waitlist[i] as string)
    if (other === undefined) throw new CorruptStateError(`대기 찜 ${String(unit.waitlist[i])}가 없다`)
    if (compareClaims(d, other, claim) < 0) {
      at = i + 1
      break
    }
  }
  attach(claim, unit)
  unit.waitlist.splice(at, 0, claim.id)
  claim.status = 'WAITLISTED'
  claim.reason = null
  setActive(d, unit, claim)
  if (trim) trimWaitlist(d, unit)
}

/**
 * 확정에서 밀려난 찜(역전·SWITCH·교체 WAITLIST)은 대기 1순위. 차단 중이면 대기에 넣지 않고 REJECTED(BLOCKED) (D-049).
 * 대기에 넣었으면 넘침을 정리한다. 확정 해제(unconfirm)는 부르는 쪽이 먼저 한다.
 */
export function displace(d: Draft, claim: ClaimDraft, unit: Unit): void {
  if (d.isBlocked(claim.buyer)) {
    finish(d, claim, unit, 'REJECTED', 'BLOCKED')
    return
  }
  claim.status = 'WAITLISTED'
  claim.reason = null
  unit.waitlist.unshift(claim.id)
  trimWaitlist(d, unit)
}

/** 확정 찜 중 판정 순위가 가장 뒤인 찜 (R-7 "누구와 비교하나") */
function lastWinner(d: Draft, unit: Unit): ClaimDraft {
  let last: AnyClaim | undefined
  for (const id of unit.winners) {
    const claim = d.readClaim(id)
    if (claim === undefined) throw new CorruptStateError(`확정 찜 ${id}가 없다`)
    if (last === undefined || compareClaims(d, claim, last) > 0) last = claim
  }
  if (last === undefined) throw new CorruptStateError(`${unit.unitKey}: 자리가 찼는데 확정 찜이 없다`)
  return d.claim(last.id)
}

// ── 역전과 충돌 (R-7) ────────────────────────────────────────────────────

function markConflict(d: Draft, claim: ClaimDraft, unit: Unit): void {
  attach(claim, unit)
  claim.status = 'CONFLICT'
  claim.reason = null
  unit.conflict = claim.id
  setActive(d, unit, claim)
}

/** c를 확정하고 w의 확정을 풀어 대기 1순위로 (역전·SWITCH) */
function swap(d: Draft, claim: ClaimDraft, winner: ClaimDraft, unit: Unit, product: ProductRecord): void {
  unconfirm(d, winner, unit)
  confirm(d, claim, unit, product)
  displace(d, winner, unit)
}

/**
 * 자리가 다 찼을 때 들어온 수량 1 찜 (R-7 "누구와 비교하나", 1·2·4·6·7).
 * RECEIVED_TIME(또는 메시지 변환)이고 충돌 중이 아니면 순위가 가장 뒤인 1등 w와 비교한다:
 * HOST 동률 → 충돌, 앞서면 w가 잠금 전이면 자동 역전·잠금 후면 충돌(변환은 늘 충돌). 그 밖은 대기 자리.
 * 옵션 방송은 접수순만이고 메시지 변환도 1등을 밀어내지 않는다(R-20 7) — 늘 대기 자리다.
 */
function contend(d: Draft, claim: ClaimDraft, unit: Unit, product: ProductRecord): void {
  const settings = d.settingsOf(unit.b)
  const policy = settings['contention.policy']
  const converting = claim.origin === 'convert' && settings['claim.parseMode'] !== 'OPTIONS'
  if (unit.conflict === null && (policy === 'RECEIVED_TIME' || converting)) {
    const winner = lastWinner(d, unit)
    const hostTie = policy === 'RECEIVED_TIME' && settings['contention.sameMinuteTieBreaker'] === 'HOST' && isSameMinuteTie(claim, winner)
    const ahead = compareClaims(d, claim, winner) < 0
    if (hostTie || (ahead && (converting || lockedForContest(d, winner)))) {
      markConflict(d, claim, unit)
      return
    }
    if (ahead) {
      swap(d, claim, winner, unit, product)
      return
    }
  }
  queue(d, claim, unit)
}

/** 판정 결과를 찜에 적용한다 (새 찜, 공개 순간의 보류 찜). reject·none·review는 부르는 쪽이 처리한다 */
export function enter(d: Draft, claim: ClaimDraft, unit: Unit, outcome: Outcome): void {
  switch (outcome.kind) {
    case 'pending':
      claim.status = 'PENDING'
      claim.reason = 'UNOPENED'
      unit.pending = pset(unit.pending, claim.id, true)
      setActive(d, unit, claim)
      return
    case 'waitlist':
      queue(d, claim, unit)
      return
    case 'confirm':
      confirm(d, claim, unit, unit.product as ProductRecord)
      return
    case 'contend':
      contend(d, claim, unit, unit.product as ProductRecord)
      return
    case 'reject':
      finish(d, claim, unit, 'REJECTED', outcome.reason)
      return
    case 'none':
    case 'review':
      throw new CorruptStateError(`찜 ${claim.id}: ${unit.unitKey}에 넣을 수 없는 판정 (${outcome.kind})`)
  }
}

/** 충돌 KEEP (host.resolveConflict, R-7 7): c를 대기 자리에 넣는다(넘치면 맨 끝 품절). 충돌이 있을 때만 부른다 */
export function resolveKeep(d: Draft, unit: Unit): void {
  const id = unit.conflict as string
  unit.conflict = null
  queue(d, d.claim(id), unit)
}

/**
 * 충돌 중에 확정 자리가 비면 충돌이 먼저 풀린다(R-7 7): c를 KEEP처럼 대기 자리에 넣는다. 충돌이 없으면 아무것도 하지 않는다.
 * 넘침 정리는 하지 않는다 — 부르는 쪽이 승계(R-8)·재고(R-10) 규칙을 적용한 뒤에 정리한다 (D-068: 자리 하나가 비고 c 하나가 들어오므로,
 * 먼저 정리하면 꽉 찬 대기의 맨 끝이 곧 생길 빈자리를 두고 품절되고, 대기 한도 0이면 1등보다 앞선 c 자신이 품절된다).
 */
export function releaseConflict(d: Draft, unit: Unit): void {
  const id = unit.conflict
  if (id === null) return
  unit.conflict = null
  queue(d, d.claim(id), unit, false)
}

/** 충돌 SWITCH (R-7 7): c를 확정하고, 그때 순위가 가장 뒤인 확정 찜 w → 대기 1순위(차단 중이면 BLOCKED, 넘치면 맨 끝 품절) */
export function resolveSwitch(d: Draft, unit: Unit): void {
  const id = unit.conflict as string
  unit.conflict = null
  swap(d, d.claim(id), lastWinner(d, unit), unit, unit.product as ProductRecord)
}

// ── 취소·승계 (R-8) ──────────────────────────────────────────────────────

/** 판정 자리의 남은 수량 (작업 사본) */
export function remainingIn(d: Draft, unit: Unit): number {
  return remainingOf(d, unit.product, unit.text, unit.winners)
}

/** "승계 결정 필요" 표시는 확정 수량 = 재고, 대기가 빔으로도 사라진다 (D-041) */
export function settleAwaiting(d: Draft, unit: Unit): void {
  if (unit.awaiting && (unit.waitlist.length === 0 || unit.product === null || remainingIn(d, unit) <= 0)) unit.awaiting = false
}

/** REOPEN 규칙: 대기자 전원 WAITLIST_CLEARED (R-8) */
export function clearWaitlist(d: Draft, unit: Unit): void {
  const ids = unit.waitlist
  unit.waitlist = []
  for (const id of ids) finish(d, d.claim(id), unit, 'REJECTED', 'WAITLIST_CLEARED')
  unit.awaiting = false
}

/** 남은 수량만큼(많아야 limit명) 대기 1순위부터 대기 순번 순서로 확정한다 — 대기 찜은 모두 수량 1이다 (R-19 "승계·재고 늘림") */
export function fillFromWaitlist(d: Draft, unit: Unit, product: ProductRecord, limit = Number.POSITIVE_INFINITY): void {
  for (let filled = 0; filled < limit && unit.waitlist.length > 0 && remainingIn(d, unit) >= 1; filled++) {
    confirm(d, d.claim(unit.waitlist.shift() as string), unit, product)
  }
}

/**
 * R-8 cancel.succession — 확정 찜이 풀린 뒤(풀린 수량 released만큼 남은 수량이 생겼다).
 * AUTO는 풀린 수량만큼(많아야 released명) 대기 1순위부터 확정한다(R-19 "승계·재고 늘림" — 수량 1 찜 하나가 풀리면 지금처럼 한 명.
 * 교체 WAITLIST로 원래 비어 있던 자리는 승계로 채우지 않는다 — 다육 방송의 지금 동작 그대로).
 * 대기 한도 0이면 ASK는 AUTO와 같다 (D-077 — 그때 대기에 있는 것은 자리가 비어 풀린 충돌 찜뿐이고, 물을 것 없이 그 찜이 빈 자리를 채운다)
 */
export function succession(d: Draft, unit: Unit, product: ProductRecord, released: number): void {
  if (unit.waitlist.length === 0) return
  const settings = d.settingsOf(unit.b)
  const mode = settings['cancel.succession']
  if (mode === 'REOPEN') clearWaitlist(d, unit)
  else if (mode === 'ASK' && waitlistLimit(settings) > 0) unit.awaiting = true
  else fillFromWaitlist(d, unit, product, released)
}

/** 대기·보류·충돌 목록에서 뺀다 (상태는 부르는 쪽이 정한다) */
export function detach(claim: AnyClaim, unit: Unit): void {
  if (claim.status === 'WAITLISTED') remove(unit.waitlist, claim.id)
  else if (claim.status === 'PENDING') unit.pending = pdelete(unit.pending, claim.id)
  else if (claim.status === 'CONFLICT' && unit.conflict === claim.id) unit.conflict = null
}

/**
 * 방송자 취소·무효와 같은 처리 (R-8): 확정 → 효과 정리, 충돌이 있으면 먼저 풀고(R-7 7) 승계, 그 뒤에 대기 넘침 정리(D-068).
 * 대기 → 뒤 순번 당김, 보류·충돌 → 끝. status: 취소는 CANCELLED, 무효는 REJECTED(BY_HOST).
 */
export function release(d: Draft, claim: ClaimDraft, unit: Unit, status: 'CANCELLED' | 'REJECTED', reason: ClaimReason | null): void {
  const was = claim.status
  if (was === 'CONFIRMED') unconfirm(d, claim, unit)
  else detach(claim, unit)
  finish(d, claim, unit, status, reason)
  if (was === 'CONFIRMED' && unit.product !== null) {
    releaseConflict(d, unit)
    succession(d, unit, unit.product, claim.qty)
    // AUTO는 빠진 만큼 들어와 남는 넘침이 없고, ASK는 빈 자리가 방송자 결정으로 남아 한도를 넘는 맨 끝이 품절, REOPEN은 이미 비었다
    trimWaitlist(d, unit)
  }
  settleAwaiting(d, unit)
}

// ── 공개 순간의 보류 찜 (R-5, 옵션 방송은 R-19 "공개 전 찜") ──────────────

/** 공개 순간 옵션 문제로 판정하지 않은 보류 찜 — 부르는 쪽(reducer)이 확인 필요 항목을 만든다 */
export type OptionMissingHook = (claim: ClaimDraft) => void

/** 수량 2 이상 보류 찜이 공개 순간 남은 수량이 모자라 판정하지 않은 경우 — 부르는 쪽이 확인 필요(STOCK_SHORT)를 만든다 */
export type StockShortHook = (claim: ClaimDraft) => void

export interface OpenHooks {
  readonly optionMissing: OptionMissingHook
  readonly stockShort: StockShortHook
}

/**
 * R-5: 상품이 시각 T에 공개되면 그 번호의 보류 찜을 판정 순위 순서로 하나씩 새 찜처럼 판정한다(at ≥ T − 유효 시간, 경계 포함).
 * 더 오래된 찜은 EXPIRED. 재고가 다 찬 뒤의 찜은 R-7을 본다(HOST 동률이면 공개 순간에도 충돌, D-052).
 * 옵션 상품(R-19 "공개 전 찜"): 변형마다 판정한다. 옵션이 없는 보류 찜은 변형이 하나면 그 변형으로, 둘 이상이면
 * 판정하지 않고 REJECTED(OPTION_MISSING) + 확인 필요. 그 상품에 없는 변형을 가진 보류 찜(번호를 바꾼 뒤 남은 찜)도 같다.
 * 수량 2 이상 보류 찜의 수량이 남은 수량(0보다 큼)보다 많으면 판정하지 않고 REJECTED(STOCK_SHORT) + 확인 필요(STOCK_SHORT, D-O1-11).
 */
export function openPending(d: Draft, slot: SlotDraft, openedAt: number, hooks: OpenHooks): void {
  const settings = d.settingsOf(slot.b)
  // 만료하지 않는 방송(D-PEND-01)은 아무리 오래된 보류 찜도 판정한다
  const start = settings['claim.preOpenExpire'] ? openedAt - settings['claim.preOpenWindowSec'] * 1000 : Number.NEGATIVE_INFINITY
  const ids = sortedPending(d, slot)
  slot.pending = emptyPMap()
  const product = slot.product as ProductRecord
  for (const id of ids) {
    const claim = d.claim(id)
    // 지금 활성 표시가 있는 자리 (번호만 쓴 찜은 번호 자신, 변형 찜은 그 변형)
    const own = new Unit(slot, claim.variant)
    if (claim.at < start) {
      finish(d, claim, own, 'REJECTED', 'EXPIRED')
      continue
    }
    let text = claim.variant
    let remapped = false
    const known = text === null ? product.options.length === 0 : product.variants.some((variant) => variant.text === text)
    if (!known) {
      const only = text === null && product.variants.length === 1 ? (product.variants[0] as { readonly text: string }).text : null
      if (only === null) {
        finish(d, claim, own, 'REJECTED', 'OPTION_MISSING')
        hooks.optionMissing(claim)
        continue
      }
      // 변형이 하나뿐인 상품 — 번호만 쓴 찜도 그 변형으로 판정한다 (선택지가 하나뿐인 항목은 댓글에 없어도 그 선택지, R-19)
      clearActive(d, own, claim)
      remapped = true
      text = only
      claim.variant = only
      claim.options = product.options.map((item) => [item.name, (item.choices[0] as { readonly label: string }).label] as const)
    }
    const unit = new Unit(slot, text)
    const outcome = decide(d, slot, text, claim.buyer, claim.qty, claim.id)
    if (outcome.kind === 'none' && remapped) {
      // 같은 사람이 같은 변형에 이미 활성 찜을 가졌다(번호만 쓴 찜이 변형 하나로 정해진 경우) — 앞선 찜을 남긴다
      finish(d, claim, unit, 'DUPLICATE', null)
      continue
    }
    if (outcome.kind === 'review') {
      // 일부만 자동 확정하지 않는다(R-19 "수량"). 재고가 남은 채 판정하지 않은 보류 찜은 REJECTED(STOCK_SHORT)로 끝내고 확인 필요로 (D-O1-11)
      finish(d, claim, unit, 'REJECTED', 'STOCK_SHORT')
      hooks.stockShort(claim)
      continue
    }
    enter(d, claim, unit, outcome)
  }
}

/** 그 번호·자리에서 지금의 구매자의 활성 찜 (없으면 undefined) */
export function activeClaim(d: Draft, key: string, text: string | null, buyer: string): AnyClaim | undefined {
  const id = activeIdIn(d, d.readSlot(key), text, buyer)
  return id === undefined ? undefined : d.readClaim(id)
}

/** 찜의 키 (변형 키 또는 상품 키) */
export function claimUnitKey(key: string, claim: Pick<ClaimRecord, 'variant'>): string {
  return unitKeyOf(key, claim.variant)
}
