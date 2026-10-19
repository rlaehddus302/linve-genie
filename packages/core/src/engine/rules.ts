// 판정 규칙 (DOMAIN_RULES R-4, R-5, R-7, R-8, R-13). 모두 작업 사본(Draft) 위에서 돈다.
// "같은 구매자"는 지금의 구매자(합친 결과), "차단"은 찜의 구매자 자신으로 본다(R-4 머리말, R-11).
import { formatThanksText } from '../format.ts'
import { CorruptStateError, type ClaimDraft, type Draft, type SlotDraft } from './draft.ts'
import { receivedOf } from './ledger.ts'
import { emptyPMap, pdelete, pget, pkeys, pset } from './pmap.ts'
import { compareRank, isSameMinuteTie, type RankMaterial } from './rank.ts'
import type { ClaimReason, ClaimRecord, ClaimStatus, EffectKind, EffectRecord, ProductRecord, SlotRecord, ThanksTarget } from './types.ts'

/** R-4 판정 결과. none = 4번 줄(같은 사람 반복) — 새 찜을 만들지 않는다. contend = 자리가 다 찼다(R-7 → 7·8번 줄) */
export type Outcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'waitlist' }
  | { readonly kind: 'contend' }
  | { readonly kind: 'reject'; readonly reason: ClaimReason }

const NONE: Outcome = { kind: 'none' }
const PENDING: Outcome = { kind: 'pending' }
const CONFIRM: Outcome = { kind: 'confirm' }
const WAITLIST: Outcome = { kind: 'waitlist' }
const CONTEND: Outcome = { kind: 'contend' }
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
  const broadcast = d.base.broadcasts.find((item) => item.id === b)
  if (broadcast === undefined) throw new CorruptStateError(`방송 ${b}가 없다`)
  return broadcast.date
}

// ── 활성 표시 (지금의 구매자 → 활성 찜) ──────────────────────────────────

export function activeIdOf(d: Draft, slot: AnySlot | undefined, buyer: string): string | undefined {
  return slot === undefined ? undefined : pget(slot.active, d.root(buyer))
}

function setActive(d: Draft, slot: SlotDraft, claim: AnyClaim): void {
  slot.active = pset(slot.active, d.root(claim.buyer), claim.id)
}

function clearActive(d: Draft, slot: SlotDraft, claim: AnyClaim): void {
  const root = d.root(claim.buyer)
  if (pget(slot.active, root) === claim.id) slot.active = pdelete(slot.active, root)
}

// ── R-4 판정표 ───────────────────────────────────────────────────────────

/**
 * R-4 판정표. 4번 줄(같은 사람 활성 찜)을 맨 먼저 본다(D-038).
 * 5번 줄(승계 결정 필요)은 대기 자리, 6번 줄은 확정, 자리가 다 찼으면 contend(R-7을 본 뒤 7·8번 줄).
 * @param self 이미 있는 찜을 다시 판정할 때(보류 찜 공개) 그 찜 ID — 자기 자신은 "같은 사람의 다른 찜"이 아니다
 */
export function decide(d: Draft, slot: AnySlot | undefined, buyer: string, self?: string): Outcome {
  const holder = activeIdOf(d, slot, buyer)
  if (holder !== undefined && holder !== self) return NONE
  if (d.isBlocked(buyer)) return reject('BLOCKED')
  const product = slot?.product ?? null
  if (product === null || product.phase === 'READY') return PENDING
  if (product.phase !== 'SELLING') return reject('NOT_ON_SALE')
  // slot은 상품이 있으면 반드시 있다
  const { winners, awaiting } = slot as AnySlot
  if (awaiting) return WAITLIST
  if (winners.length < product.stock) return CONFIRM
  return CONTEND
}

/** 상품에 붙은 찜으로 표시한다 (번호를 바꾸면 찜의 상품 키가 상품을 따라간다, D-056) */
function attach(claim: ClaimDraft, slot: AnySlot): void {
  if (claim.pid === null && slot.product !== null) claim.pid = slot.product.id
}

/** 찜을 활성이 아닌 상태로 끝낸다: 상태·사유, 활성 표시와 취소 요청을 지운다 (D-043: 찜이 끝나면 요청도 사라진다) */
export function finish(d: Draft, claim: ClaimDraft, slot: SlotDraft, status: 'REJECTED' | 'CANCELLED' | 'DUPLICATE', reason: ClaimReason | null): void {
  attach(claim, slot)
  claim.status = status
  claim.reason = reason
  claim.request = null
  clearActive(d, slot, claim)
}

function remove(list: string[], id: string): void {
  const at = list.indexOf(id)
  if (at >= 0) list.splice(at, 1)
}

/** 판정 순위 비교 (R-6). 같은 키면 생성 순서 */
export function compareClaims(d: Draft, a: RankMaterial & { readonly n: number }, b: RankMaterial & { readonly n: number }): number {
  return compareRank(a, b, d.settings) || a.n - b.n
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

/** R-4·R-13: 찜을 확정하고 확정버전을 올린 뒤 설정대로 효과를 낸다 */
export function confirm(d: Draft, claim: ClaimDraft, slot: SlotDraft, product: ProductRecord): void {
  slot.version += 1
  const version = slot.version
  attach(claim, slot)
  claim.status = 'CONFIRMED'
  claim.reason = null
  claim.price = product.price
  claim.version = version
  claim.locked = false
  claim.reprint = false
  slot.winners.push(claim.id)
  setActive(d, slot, claim)
  d.knownBuyer(claim.buyer).subtotal += product.price
  const { settings } = d
  if (settings['print.autoOnConfirm']) emit(d, claim, 'PRINT_PRODUCT_LABEL', null, version, null, slot)
  const text = formatThanksText({ no: slot.no, name: product.name, price: product.price, buyerName: thanksName(d, claim) })
  if (settings['thanks.liveChat']) emit(d, claim, 'POST_THANKS', 'LIVE_CHAT', version, text, slot)
  if (settings['thanks.videoComment'] === 'PER_SALE') emit(d, claim, 'POST_THANKS', 'VIDEO_COMMENT', version, text, slot)
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
 * 게시된 감사는 그대로 둔다. 확정 목록에서 빼고 구매자 합계에서 뺀다. 상태는 부르는 쪽이 정한다.
 */
export function unconfirm(d: Draft, claim: ClaimDraft, slot: SlotDraft): void {
  const version = claim.version
  for (const id of [...claim.effects]) {
    const effect = d.readEffect(id)
    if (effect === undefined) throw new CorruptStateError(`찜 ${claim.id}의 효과 ${id}가 없다`)
    if (effect.version !== version || effect.kind === 'VOID_LABEL') continue
    if (effect.status === 'PENDING') d.effect(effect).status = 'CANCELLED'
    else if (effect.status === 'DONE' && effect.kind === 'PRINT_PRODUCT_LABEL') voidLabel(d, claim, effect)
  }
  remove(slot.winners, claim.id)
  d.knownBuyer(claim.buyer).subtotal -= claim.price as number
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

/** 대기 인원 한도. 범위 밖 설정값(음수·NaN)이면 대기 없음 */
export function waitlistLimit(d: Draft): number {
  const max = d.settings['waitlist.max']
  return max > 0 ? Math.ceil(max) : 0
}

/** 넣은 뒤 대기 수가 한도를 넘으면 맨 끝 대기자부터 REJECTED(SOLD_OUT) */
export function trimWaitlist(d: Draft, slot: SlotDraft): void {
  const limit = waitlistLimit(d)
  while (slot.waitlist.length > limit) finish(d, d.claim(slot.waitlist.pop() as string), slot, 'REJECTED', 'SOLD_OUT')
}

/**
 * 새 찜·KEEP·풀린 충돌·대기로 가는 변환: 자기보다 순위가 앞서는 대기자 중 가장 뒤에 있는 대기자 바로 뒤(없으면 1순위), 넘치면 맨 끝 품절.
 * ARRIVAL의 새 찜은 순위가 늘 맨 뒤라 맨 끝이다.
 * @param trim false면 넘침 정리를 부르는 쪽에 맡긴다 (확정 자리가 비어 풀린 충돌 찜 — 승계·재고 규칙 뒤에 정리, D-068)
 */
function queue(d: Draft, claim: ClaimDraft, slot: SlotDraft, trim = true): void {
  let at = 0
  for (let i = slot.waitlist.length - 1; i >= 0; i--) {
    const other = d.readClaim(slot.waitlist[i] as string)
    if (other === undefined) throw new CorruptStateError(`대기 찜 ${String(slot.waitlist[i])}가 없다`)
    if (compareClaims(d, other, claim) < 0) {
      at = i + 1
      break
    }
  }
  attach(claim, slot)
  slot.waitlist.splice(at, 0, claim.id)
  claim.status = 'WAITLISTED'
  claim.reason = null
  setActive(d, slot, claim)
  if (trim) trimWaitlist(d, slot)
}

/**
 * 확정에서 밀려난 찜(역전·SWITCH·교체 WAITLIST)은 대기 1순위. 차단 중이면 대기에 넣지 않고 REJECTED(BLOCKED) (D-049).
 * 대기에 넣었으면 넘침을 정리한다. 확정 해제(unconfirm)는 부르는 쪽이 먼저 한다.
 */
export function displace(d: Draft, claim: ClaimDraft, slot: SlotDraft): void {
  if (d.isBlocked(claim.buyer)) {
    finish(d, claim, slot, 'REJECTED', 'BLOCKED')
    return
  }
  claim.status = 'WAITLISTED'
  claim.reason = null
  slot.waitlist.unshift(claim.id)
  trimWaitlist(d, slot)
}

/** 확정 찜 중 판정 순위가 가장 뒤인 찜 (R-7 "누구와 비교하나") */
function lastWinner(d: Draft, slot: SlotDraft): ClaimDraft {
  let last: AnyClaim | undefined
  for (const id of slot.winners) {
    const claim = d.readClaim(id)
    if (claim === undefined) throw new CorruptStateError(`확정 찜 ${id}가 없다`)
    if (last === undefined || compareClaims(d, claim, last) > 0) last = claim
  }
  if (last === undefined) throw new CorruptStateError(`${slot.key}: 자리가 찼는데 확정 찜이 없다`)
  return d.claim(last.id)
}

// ── 역전과 충돌 (R-7) ────────────────────────────────────────────────────

function markConflict(d: Draft, claim: ClaimDraft, slot: SlotDraft): void {
  attach(claim, slot)
  claim.status = 'CONFLICT'
  claim.reason = null
  slot.conflict = claim.id
  setActive(d, slot, claim)
}

/** c를 확정하고 w의 확정을 풀어 대기 1순위로 (역전·SWITCH) */
function swap(d: Draft, claim: ClaimDraft, winner: ClaimDraft, slot: SlotDraft, product: ProductRecord): void {
  unconfirm(d, winner, slot)
  confirm(d, claim, slot, product)
  displace(d, winner, slot)
}

/**
 * 자리가 다 찼을 때 들어온 찜 (R-7 "누구와 비교하나", 1·2·4·6·7).
 * RECEIVED_TIME(또는 메시지 변환)이고 충돌 중이 아니면 순위가 가장 뒤인 1등 w와 비교한다:
 * HOST 동률 → 충돌, 앞서면 w가 잠금 전이면 자동 역전·잠금 후면 충돌(변환은 늘 충돌). 그 밖은 대기 자리.
 */
function contend(d: Draft, claim: ClaimDraft, slot: SlotDraft, product: ProductRecord): void {
  const policy = d.settings['contention.policy']
  if (slot.conflict === null && (policy === 'RECEIVED_TIME' || claim.origin === 'convert')) {
    const winner = lastWinner(d, slot)
    const hostTie = policy === 'RECEIVED_TIME' && d.settings['contention.sameMinuteTieBreaker'] === 'HOST' && isSameMinuteTie(claim, winner)
    const ahead = compareClaims(d, claim, winner) < 0
    if (hostTie || (ahead && (claim.origin === 'convert' || lockedForContest(d, winner)))) {
      markConflict(d, claim, slot)
      return
    }
    if (ahead) {
      swap(d, claim, winner, slot, product)
      return
    }
  }
  queue(d, claim, slot)
}

/** 판정 결과를 찜에 적용한다 (새 찜, 공개 순간의 보류 찜). reject·none은 부르는 쪽이 처리한다 */
export function enter(d: Draft, claim: ClaimDraft, slot: SlotDraft, outcome: Outcome): void {
  switch (outcome.kind) {
    case 'pending':
      claim.status = 'PENDING'
      claim.reason = 'UNOPENED'
      slot.pending = pset(slot.pending, claim.id, true)
      setActive(d, slot, claim)
      return
    case 'waitlist':
      queue(d, claim, slot)
      return
    case 'confirm':
      confirm(d, claim, slot, slot.product as ProductRecord)
      return
    case 'contend':
      contend(d, claim, slot, slot.product as ProductRecord)
      return
    case 'reject':
      finish(d, claim, slot, 'REJECTED', outcome.reason)
      return
    case 'none':
      throw new CorruptStateError(`찜 ${claim.id}: 같은 구매자의 활성 찜이 ${slot.key}에 또 있다`)
  }
}

/** 충돌 KEEP (host.resolveConflict, R-7 7): c를 대기 자리에 넣는다(넘치면 맨 끝 품절). 충돌이 있을 때만 부른다 */
export function resolveKeep(d: Draft, slot: SlotDraft): void {
  const id = slot.conflict as string
  slot.conflict = null
  queue(d, d.claim(id), slot)
}

/**
 * 충돌 중에 확정 자리가 비면 충돌이 먼저 풀린다(R-7 7): c를 KEEP처럼 대기 자리에 넣는다. 충돌이 없으면 아무것도 하지 않는다.
 * 넘침 정리는 하지 않는다 — 부르는 쪽이 승계(R-8)·재고(R-10) 규칙을 적용한 뒤에 정리한다 (D-068: 자리 하나가 비고 c 하나가 들어오므로,
 * 먼저 정리하면 꽉 찬 대기의 맨 끝이 곧 생길 빈자리를 두고 품절되고, 대기 한도 0이면 1등보다 앞선 c 자신이 품절된다).
 */
export function releaseConflict(d: Draft, slot: SlotDraft): void {
  const id = slot.conflict
  if (id === null) return
  slot.conflict = null
  queue(d, d.claim(id), slot, false)
}

/** 충돌 SWITCH (R-7 7): c를 확정하고, 그때 순위가 가장 뒤인 확정 찜 w → 대기 1순위(차단 중이면 BLOCKED, 넘치면 맨 끝 품절) */
export function resolveSwitch(d: Draft, slot: SlotDraft): void {
  const id = slot.conflict as string
  slot.conflict = null
  swap(d, d.claim(id), lastWinner(d, slot), slot, slot.product as ProductRecord)
}

// ── 취소·승계 (R-8) ──────────────────────────────────────────────────────

/** "승계 결정 필요" 표시는 확정 수 = 재고, 대기가 빔으로도 사라진다 (D-041) */
export function settleAwaiting(slot: SlotDraft): void {
  if (slot.awaiting && (slot.waitlist.length === 0 || slot.product === null || slot.winners.length >= slot.product.stock)) slot.awaiting = false
}

/** REOPEN 규칙: 대기자 전원 WAITLIST_CLEARED (R-8) */
export function clearWaitlist(d: Draft, slot: SlotDraft): void {
  const ids = slot.waitlist
  slot.waitlist = []
  for (const id of ids) finish(d, d.claim(id), slot, 'REJECTED', 'WAITLIST_CLEARED')
  slot.awaiting = false
}

/** R-8 cancel.succession — 확정 찜 하나가 풀린 뒤 */
function succession(d: Draft, slot: SlotDraft, product: ProductRecord): void {
  if (slot.waitlist.length === 0) return
  const mode = d.settings['cancel.succession']
  if (mode === 'REOPEN') clearWaitlist(d, slot)
  else if (mode === 'ASK') slot.awaiting = true
  else confirm(d, d.claim(slot.waitlist.shift() as string), slot, product)
}

/** 대기·보류·충돌 목록에서 뺀다 (상태는 부르는 쪽이 정한다) */
export function detach(claim: AnyClaim, slot: SlotDraft): void {
  if (claim.status === 'WAITLISTED') remove(slot.waitlist, claim.id)
  else if (claim.status === 'PENDING') slot.pending = pdelete(slot.pending, claim.id)
  else if (claim.status === 'CONFLICT' && slot.conflict === claim.id) slot.conflict = null
}

/**
 * 방송자 취소·무효와 같은 처리 (R-8): 확정 → 효과 정리, 충돌이 있으면 먼저 풀고(R-7 7) 승계, 그 뒤에 대기 넘침 정리(D-068).
 * 대기 → 뒤 순번 당김, 보류·충돌 → 끝. status: 취소는 CANCELLED, 무효는 REJECTED(BY_HOST).
 */
export function release(d: Draft, claim: ClaimDraft, slot: SlotDraft, status: 'CANCELLED' | 'REJECTED', reason: ClaimReason | null): void {
  const was = claim.status
  if (was === 'CONFIRMED') unconfirm(d, claim, slot)
  else detach(claim, slot)
  finish(d, claim, slot, status, reason)
  if (was === 'CONFIRMED' && slot.product !== null) {
    releaseConflict(d, slot)
    succession(d, slot, slot.product)
    // AUTO는 하나가 빠지고 하나가 들어와 남는 넘침이 없고, ASK는 빈 자리가 방송자 결정으로 남아 한도를 넘는 맨 끝이 품절, REOPEN은 이미 비었다
    trimWaitlist(d, slot)
  }
  settleAwaiting(slot)
}

// ── 공개 순간의 보류 찜 (R-5) ────────────────────────────────────────────

/**
 * R-5: 상품이 시각 T에 공개되면 그 번호의 보류 찜을 판정 순위 순서로 하나씩 새 찜처럼 판정한다(at ≥ T − 유효 시간, 경계 포함).
 * 더 오래된 찜은 EXPIRED. 재고가 다 찬 뒤의 찜은 R-7을 본다(HOST 동률이면 공개 순간에도 충돌, D-052).
 */
export function openPending(d: Draft, slot: SlotDraft, openedAt: number): void {
  const start = openedAt - d.settings['claim.preOpenWindowSec'] * 1000
  const ids = sortedPending(d, slot)
  slot.pending = emptyPMap()
  for (const id of ids) {
    const claim = d.claim(id)
    if (claim.at < start) {
      finish(d, claim, slot, 'REJECTED', 'EXPIRED')
      continue
    }
    // 공개된 상품이라 보류는 나오지 않는다. 같은 사람 반복(4번 줄)은 활성 찜이 둘(INV-2 위반)일 때만 나오고 enter가 멈춘다
    enter(d, claim, slot, decide(d, slot, claim.buyer, claim.id))
  }
}

/** 그 번호에서 지금의 구매자의 활성 찜 (없으면 undefined) */
export function activeClaim(d: Draft, key: string, buyer: string): AnyClaim | undefined {
  const id = activeIdOf(d, d.readSlot(key), buyer)
  return id === undefined ? undefined : d.readClaim(id)
}

