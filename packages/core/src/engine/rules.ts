// 판정 규칙 (DOMAIN_RULES R-4, R-5, R-8, R-13). 모두 작업 사본(Draft) 위에서 돈다.
import { formatThanksText } from '../format.ts'
import { CorruptStateError, ownGet, ownSet, type ClaimDraft, type Draft, type SlotDraft } from './draft.ts'
import type { ClaimReason, ClaimStatus, EffectKind, ProductRecord, SlotRecord, ThanksTarget } from './types.ts'

/** R-4 판정 결과. none = 4번 줄(같은 사람 반복) — 새 찜을 만들지 않는다 */
export type Outcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'waitlist' }
  | { readonly kind: 'reject'; readonly reason: ClaimReason }

const NONE: Outcome = { kind: 'none' }
const PENDING: Outcome = { kind: 'pending' }
const CONFIRM: Outcome = { kind: 'confirm' }
const WAITLIST: Outcome = { kind: 'waitlist' }
const reject = (reason: ClaimReason): Outcome => ({ kind: 'reject', reason })

/** 활성 찜 = 확정·대기·보류 (INV-2) */
export function isActive(status: ClaimStatus): boolean {
  return status === 'CONFIRMED' || status === 'WAITLISTED' || status === 'PENDING'
}

/** 대기 인원 한도 안에 자리가 있는지. 범위 밖 설정값(음수·NaN)이면 자리가 없다 */
function waitlistHasRoom(d: Draft, waitlist: readonly string[]): boolean {
  return waitlist.length < d.settings['waitlist.max']
}

/**
 * R-4 판정표. 4번 줄(같은 사람 활성 찜)을 맨 먼저 본다(D-038).
 * @param self 이미 있는 찜을 다시 판정할 때(보류 찜 공개) 그 찜 ID — 자기 자신은 "같은 사람의 다른 찜"이 아니다
 */
export function decide(d: Draft, slot: SlotRecord | SlotDraft | undefined, buyer: string, self?: string): Outcome {
  const holder = slot === undefined ? undefined : ownGet(slot.active, buyer)
  if (holder !== undefined && holder !== self) return NONE
  if (d.isBlocked(buyer)) return reject('BLOCKED')
  const product = slot?.product ?? null
  if (product === null || product.phase === 'READY') return PENDING
  if (product.phase !== 'SELLING') return reject('NOT_ON_SALE')
  // slot은 상품이 있으면 반드시 있다
  const { winners, waitlist, awaiting } = slot as SlotRecord
  if (awaiting) return waitlistHasRoom(d, waitlist) ? WAITLIST : reject('SOLD_OUT')
  if (winners.length < product.stock) return CONFIRM
  if (waitlistHasRoom(d, waitlist)) return WAITLIST
  return reject('SOLD_OUT')
}

/** 찜을 활성이 아닌 상태로 끝낸다: 상태·사유, 활성 표시와 취소 요청을 지운다 (D-043: 찜이 끝나면 요청도 사라진다) */
export function finish(claim: ClaimDraft, slot: SlotDraft, status: 'REJECTED' | 'CANCELLED', reason: ClaimReason | null): void {
  claim.status = status
  claim.reason = reason
  claim.request = null
  if (ownGet(slot.active, claim.buyer) === claim.id) delete slot.active[claim.buyer]
}

function remove(list: string[], id: string): void {
  const at = list.indexOf(id)
  if (at >= 0) list.splice(at, 1)
}

function emit(d: Draft, claim: ClaimDraft, kind: EffectKind, target: ThanksTarget | null, version: number, text: string | null): void {
  const id = `${claim.id}:${kind}:${target ?? '-'}:${String(version)}`
  d.newEffect({ id, seq: d.seq, kind, target, claim: claim.id, key: claim.key, b: claim.b, no: claim.no, buyer: claim.buyer, text, version, status: 'PENDING' })
  claim.effects.push(id)
}

/** R-4·R-13: 찜을 확정하고 확정버전을 올린 뒤 설정대로 효과를 낸다 */
export function confirm(d: Draft, claim: ClaimDraft, slot: SlotDraft, product: ProductRecord): void {
  slot.version += 1
  const version = slot.version
  claim.status = 'CONFIRMED'
  claim.reason = null
  claim.price = product.price
  claim.version = version
  claim.locked = false
  slot.winners.push(claim.id)
  ownSet(slot.active, claim.buyer, claim.id)
  const buyer = d.knownBuyer(claim.buyer)
  buyer.subtotal += product.price
  const { settings } = d
  if (settings['print.autoOnConfirm']) emit(d, claim, 'PRINT_PRODUCT_LABEL', null, version, null)
  const text = formatThanksText({ no: slot.no, name: product.name, price: product.price, buyerName: buyer.display })
  if (settings['thanks.liveChat']) emit(d, claim, 'POST_THANKS', 'LIVE_CHAT', version, text)
  if (settings['thanks.videoComment'] === 'PER_SALE') emit(d, claim, 'POST_THANKS', 'VIDEO_COMMENT', version, text)
}

/**
 * R-13 "확정이 풀릴 때": 지금 확정의 미실행 효과는 취소, 출력 완료된 라벨은 VOID_LABEL(그 확정버전).
 * 게시된 감사는 그대로 둔다. 확정 목록에서 빼고 구매자 합계에서 뺀다. 상태는 부르는 쪽이 정한다.
 */
export function unconfirm(d: Draft, claim: ClaimDraft, slot: SlotDraft): void {
  const version = claim.version
  for (const id of [...claim.effects]) {
    const effect = d.readEffect(id)
    if (effect === undefined) throw new CorruptStateError(`찜 ${claim.id}의 효과 ${id}가 없다`)
    if (effect.version !== version || effect.kind === 'VOID_LABEL') continue
    if (effect.status === 'PENDING') d.effect(effect).status = 'CANCELLED'
    else if (effect.status === 'DONE' && effect.kind === 'PRINT_PRODUCT_LABEL') voidLabel(d, claim, effect.version)
  }
  remove(slot.winners, claim.id)
  d.knownBuyer(claim.buyer).subtotal -= claim.price ?? 0
  claim.locked = false
}

/** 출력된 라벨의 폐기 표시 (R-13). 확정버전 = 폐기할 라벨의 확정버전 */
export function voidLabel(d: Draft, claim: ClaimDraft, version: number): void {
  emit(d, claim, 'VOID_LABEL', null, version, null)
}

/** "승계 결정 필요" 표시는 확정 수 = 재고, 대기가 빔으로도 사라진다 (D-041) */
export function settleAwaiting(slot: SlotDraft): void {
  if (slot.awaiting && (slot.waitlist.length === 0 || slot.product === null || slot.winners.length >= slot.product.stock)) slot.awaiting = false
}

/** REOPEN 규칙: 대기자 전원 WAITLIST_CLEARED (R-8) */
export function clearWaitlist(d: Draft, slot: SlotDraft): void {
  for (const id of slot.waitlist) finish(d.claim(id), slot, 'REJECTED', 'WAITLIST_CLEARED')
  slot.waitlist = []
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

/**
 * 방송자 취소·무효와 같은 처리 (R-8): 확정 → 효과 정리 + 승계, 대기 → 뒤 순번 당김, 보류 → 끝.
 * status: 취소는 CANCELLED, 무효는 REJECTED(BY_HOST).
 */
export function release(d: Draft, claim: ClaimDraft, slot: SlotDraft, status: 'CANCELLED' | 'REJECTED', reason: ClaimReason | null): void {
  const was = claim.status
  if (was === 'CONFIRMED') unconfirm(d, claim, slot)
  else if (was === 'WAITLISTED') remove(slot.waitlist, claim.id)
  else remove(slot.pending, claim.id)
  finish(claim, slot, status, reason)
  if (was === 'CONFIRMED' && slot.product !== null) succession(d, slot, slot.product)
  settleAwaiting(slot)
}

/** 판정 결과를 찜에 적용한다 (새 찜, 공개 순간의 보류 찜) */
export function place(d: Draft, claim: ClaimDraft, slot: SlotDraft, outcome: Exclude<Outcome, { kind: 'none' }>): void {
  switch (outcome.kind) {
    case 'pending':
      claim.status = 'PENDING'
      claim.reason = 'UNOPENED'
      slot.pending.push(claim.id)
      ownSet(slot.active, claim.buyer, claim.id)
      return
    case 'waitlist':
      claim.status = 'WAITLISTED'
      claim.reason = null
      slot.waitlist.push(claim.id)
      ownSet(slot.active, claim.buyer, claim.id)
      return
    case 'confirm':
      confirm(d, claim, slot, slot.product as ProductRecord)
      return
    case 'reject':
      finish(claim, slot, 'REJECTED', outcome.reason)
      return
  }
}

/**
 * R-5: 상품이 시각 T에 공개되면 그 번호의 보류 찜을 판정 순위 순서로, at ≥ T − 유효 시간이면 R-4, 더 오래되면 EXPIRED.
 * 경계는 포함한다. 재고가 2 이상이면 여럿이 확정될 수 있고 확정버전은 순서대로 붙는다.
 */
export function openPending(d: Draft, slot: SlotDraft, openedAt: number): void {
  const start = openedAt - d.settings['claim.preOpenWindowSec'] * 1000
  const ids = slot.pending
  slot.pending = []
  for (const id of ids) {
    const claim = d.claim(id)
    if (claim.at < start) {
      finish(claim, slot, 'REJECTED', 'EXPIRED')
      continue
    }
    const outcome = decide(d, slot, claim.buyer, claim.id)
    // 공개된 상품이므로 보류·같은 사람 반복은 나오지 않는다(INV-2). 혹시 나오면 판정하지 않고 만료로 끝낸다.
    if (outcome.kind === 'none' || outcome.kind === 'pending') finish(claim, slot, 'REJECTED', 'EXPIRED')
    else place(d, claim, slot, outcome)
  }
}
