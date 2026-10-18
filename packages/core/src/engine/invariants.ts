// 한 상태만 보고 확인할 수 있는 불변식 (DOMAIN_RULES 불변식 표, AC-S02-01·91·93).
// INV-1·2·5·6·7·9. 서버의 재생 무결성 검사(S04)와 골든 러너가 매 이벤트 뒤에 부른다.
// 이벤트 사이의 불변식(INV-3·4·8·10·11·12)은 두 상태·로그를 비교해야 해서 속성 테스트가 본다.
import { ownGet } from './draft.ts'
import { pvalues } from './pmap.ts'
import { isActive } from './rules.ts'
import type { ClaimRecord, ClaimStatus, EngineState, InvariantViolation, SlotRecord } from './types.ts'
import { listSettlements } from './views.ts'

const isMoney = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length || new Set(a).size !== a.length) return false
  const set = new Set(a)
  return b.every((item) => set.has(item))
}

function idsWith(claims: readonly ClaimRecord[], status: ClaimStatus): string[] {
  return claims.filter((claim) => claim.status === status).map((claim) => claim.id)
}

function checkSlot(slot: SlotRecord, claims: readonly ClaimRecord[], byId: ReadonlyMap<string, ClaimRecord>, out: InvariantViolation[]): void {
  const where = `상품 ${slot.key}`
  const stock = slot.product?.stock ?? 0
  // INV-1: 확정 찜 수 ≤ 재고, 확정 목록 = 확정 상태인 찜
  if (slot.winners.length > stock) out.push({ id: 'INV-1', message: `${where}: 확정 ${String(slot.winners.length)}명 > 재고 ${String(stock)}` })
  if (!sameSet(slot.winners, idsWith(claims, 'CONFIRMED'))) out.push({ id: 'INV-1', message: `${where}: 확정 목록과 찜 상태가 다르다` })
  // INV-7: 대기 순번 1..n 빈틈없음 = 대기 목록이 대기 상태인 찜 전부와 정확히 같고 겹치지 않는다
  if (!sameSet(slot.waitlist, idsWith(claims, 'WAITLISTED'))) out.push({ id: 'INV-7', message: `${where}: 대기 목록과 대기 상태인 찜이 다르다` })
  // INV-2: 한 구매자 한 번호 활성 찜 ≤ 1, 활성 표시 = 활성 찜
  const active = claims.filter((claim) => isActive(claim.status))
  const buyers = new Set(active.map((claim) => claim.buyer))
  if (buyers.size !== active.length) out.push({ id: 'INV-2', message: `${where}: 한 구매자에게 활성 찜이 둘 이상이다` })
  if (!sameSet(slot.pending, idsWith(claims, 'PENDING'))) out.push({ id: 'INV-2', message: `${where}: 보류 목록과 보류 상태인 찜이 다르다` })
  const indexOk =
    Object.keys(slot.active).length === active.length && active.every((claim) => ownGet(slot.active, claim.buyer) === claim.id)
  if (!indexOk) out.push({ id: 'INV-2', message: `${where}: 활성 찜 표시가 찜 상태와 다르다` })
  // INV-9: 취소·거절된 찜은 확정·대기·보류 목록(합계의 바탕)에 없다
  const ended = [...slot.winners, ...slot.waitlist, ...slot.pending].filter((id) => {
    const status = byId.get(id)?.status
    return status === 'CANCELLED' || status === 'REJECTED'
  })
  if (ended.length > 0) out.push({ id: 'INV-9', message: `${where}: 끝난 찜이 목록에 남아 있다 (${ended.join(', ')})` })
}

/** 위반 목록 (없으면 빈 배열) */
export function checkInvariants(state: EngineState): InvariantViolation[] {
  const out: InvariantViolation[] = []
  const claims = pvalues(state.claims)
  const byId = new Map(claims.map((claim) => [claim.id, claim]))
  const bySlot = new Map<string, ClaimRecord[]>()
  for (const claim of claims) bySlot.set(claim.key, [...(bySlot.get(claim.key) ?? []), claim])

  for (const slot of pvalues(state.slots)) checkSlot(slot, bySlot.get(slot.key) ?? [], byId, out)
  // 번호 기록이 없는 찜은 거절된 찜뿐이다(차단·판매 아님 등으로 번호를 만들지 않았다)
  const slotKeys = new Set(pvalues(state.slots).map((slot) => slot.key))
  for (const claim of claims) {
    if (!slotKeys.has(claim.key) && isActive(claim.status)) out.push({ id: 'INV-2', message: `찜 ${claim.id}: 번호 ${claim.key} 기록 없이 활성이다` })
  }

  // INV-5: 구매자 합계 = 확정 찜 가격 스냅샷의 합 (INV-9: 취소·거절 찜은 빠진다)
  for (const buyer of pvalues(state.buyers)) {
    const expected = claims.filter((claim) => claim.buyer === buyer.id && claim.status === 'CONFIRMED').reduce((sum, claim) => sum + (claim.price ?? 0), 0)
    if (buyer.subtotal !== expected) out.push({ id: 'INV-5', message: `구매자 ${buyer.id}: 합계 ${String(buyer.subtotal)} ≠ 확정 찜 가격 스냅샷의 합 ${String(expected)}` })
  }

  // INV-6: 모든 금액은 0 이상의 정수 (조정 항목은 S03)
  const amounts: [string, unknown][] = [
    ...pvalues(state.slots).flatMap((slot): [string, unknown][] => (slot.product === null ? [] : [[`상품 ${slot.key} 가격`, slot.product.price]])),
    ...claims.flatMap((claim): [string, unknown][] => (claim.price === null ? [] : [[`찜 ${claim.id} 가격 스냅샷`, claim.price]])),
    ...pvalues(state.buyers).map((buyer): [string, unknown] => [`구매자 ${buyer.id} 합계`, buyer.subtotal]),
    ...listSettlements(state).flatMap((s): [string, unknown][] => [
      [`정산 ${s.buyer}@${s.date} 상품 합계`, s.subtotal],
      [`정산 ${s.buyer}@${s.date} 배송비`, s.shipping],
      [`정산 ${s.buyer}@${s.date} 최종 금액`, s.total],
    ]),
  ]
  for (const [what, value] of amounts) if (!isMoney(value)) out.push({ id: 'INV-6', message: `${what}이 0 이상의 정수가 아니다 (값: ${String(value)})` })
  return out
}
