// 한 상태만 보고 확인할 수 있는 불변식 (DOMAIN_RULES 불변식 표, AC-S02-01·91·93, AC-S03-92).
// INV-1·2·5·6·7·9, 차단 중인 구매자의 대기·보류·충돌 찜 없음(R-9, D-049), 충돌 성질(R-7 7, D-053).
// 서버의 재생 무결성 검사(S04)와 골든 러너가 매 이벤트 뒤에 부른다. 상태 크기에 비례하는 한 번 순회로 검사한다(AC-S03-05):
// 찜을 한 번 돌며 번호별·구매자별로 모으고, 번호·구매자를 한 번씩 본다(구매자×찜 이중 순회, 번호별 펼침 복사 없음).
// 이벤트 사이의 불변식(INV-3·4·8·10·11·12)은 두 상태·로그를 비교해야 해서 속성 테스트가 본다.
import { pget, pkeys, pvalues } from './pmap.ts'
import { isActive } from './rules.ts'
import type { ClaimRecord, EngineState, InvariantViolation, SlotRecord } from './types.ts'
import { listSettlements } from './views.ts'

const isMoney = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0
const isEnded = (claim: ClaimRecord | undefined): boolean => claim !== undefined && !isActive(claim.status)

/** 겹치지 않고 정확히 같은 집합인지 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  if (set.size !== a.length) return false
  return b.every((item) => set.has(item))
}

interface Context {
  readonly byId: ReadonlyMap<string, ClaimRecord>
  readonly root: (buyer: string) => string
  readonly out: InvariantViolation[]
}

function checkSlot(slot: SlotRecord, claims: readonly ClaimRecord[], { byId, root, out }: Context): void {
  const where = `상품 ${slot.key}`
  const stock = slot.product?.stock ?? 0
  const confirmed: string[] = []
  const waiting: string[] = []
  const pending: string[] = []
  const conflicts: string[] = []
  const active: ClaimRecord[] = []
  for (const claim of claims) {
    if (claim.status === 'CONFIRMED') confirmed.push(claim.id)
    else if (claim.status === 'WAITLISTED') waiting.push(claim.id)
    else if (claim.status === 'PENDING') pending.push(claim.id)
    else if (claim.status === 'CONFLICT') conflicts.push(claim.id)
    if (isActive(claim.status)) active.push(claim)
  }
  // INV-1: 확정 찜 수 ≤ 재고, 확정 목록 = 확정 상태인 찜
  if (slot.winners.length > stock) out.push({ id: 'INV-1', message: `${where}: 확정 ${String(slot.winners.length)}명 > 재고 ${String(stock)}` })
  if (!sameSet(slot.winners, confirmed)) out.push({ id: 'INV-1', message: `${where}: 확정 목록과 찜 상태가 다르다` })
  // INV-7: 대기 순번 1..n 빈틈없음 = 대기 목록이 대기 상태인 찜 전부와 정확히 같고 겹치지 않는다
  if (!sameSet(slot.waitlist, waiting)) out.push({ id: 'INV-7', message: `${where}: 대기 목록과 대기 상태인 찜이 다르다` })
  // INV-2: 한 구매자(지금의 구매자) 한 번호 활성 찜 ≤ 1 (충돌 찜 포함), 보류 목록·활성 표시 = 찜 상태
  const owners = new Set(active.map((claim) => root(claim.buyer)))
  if (owners.size !== active.length) out.push({ id: 'INV-2', message: `${where}: 한 구매자에게 활성 찜이 둘 이상이다` })
  if (!sameSet(pkeys(slot.pending), pending)) out.push({ id: 'INV-2', message: `${where}: 보류 목록과 보류 상태인 찜이 다르다` })
  const indexOk = slot.active.size === active.length && active.every((claim) => pget(slot.active, root(claim.buyer)) === claim.id)
  if (!indexOk) out.push({ id: 'INV-2', message: `${where}: 활성 찜 표시가 찜 상태와 다르다` })
  // R-7 7: 충돌은 상품마다 하나, 충돌 표시 ⇔ 충돌 찜, 충돌 찜이 있으면 확정 수 = 재고
  const marked = slot.conflict === null ? [] : [slot.conflict]
  if (conflicts.length > 1 || !sameSet(marked, conflicts)) out.push({ id: 'R-7', message: `${where}: 충돌 표시와 충돌 찜이 다르다 (찜 ${String(conflicts.length)}개)` })
  if (slot.conflict !== null && slot.winners.length !== stock) out.push({ id: 'R-7', message: `${where}: 충돌 중인데 확정 ${String(slot.winners.length)}명 ≠ 재고 ${String(stock)}` })
  // INV-9: 취소·거절·중복 찜은 확정·대기·보류·충돌 자리(합계의 바탕)에 없다
  const ended = [...slot.winners, ...slot.waitlist, ...pkeys(slot.pending), ...marked].filter((id) => isEnded(byId.get(id)))
  if (ended.length > 0) out.push({ id: 'INV-9', message: `${where}: 끝난 찜이 목록에 남아 있다 (${ended.join(', ')})` })
}

/** 위반 목록 (없으면 빈 배열) */
export function checkInvariants(state: EngineState): InvariantViolation[] {
  const out: InvariantViolation[] = []
  const roots = new Map<string, string>()
  const root = (buyer: string): string => {
    const known = roots.get(buyer)
    if (known !== undefined) return known
    let current = buyer
    const seen = new Set<string>()
    for (;;) {
      const parent = pget(state.buyers, current)?.parent ?? null
      if (parent === null || seen.has(current)) break
      seen.add(current)
      current = parent
    }
    roots.set(buyer, current)
    return current
  }

  // 찜 한 번 순회: 번호별 모음, 구매자별 확정 합계, 차단 중인 구매자의 대기·보류·충돌 찜
  const byId = new Map<string, ClaimRecord>()
  const bySlot = new Map<string, ClaimRecord[]>()
  const confirmedSum = new Map<string, number>()
  const amounts: [string, unknown][] = []
  for (const claim of pvalues(state.claims)) {
    byId.set(claim.id, claim)
    const group = bySlot.get(claim.key)
    if (group === undefined) bySlot.set(claim.key, [claim])
    else group.push(claim)
    if (claim.status === 'CONFIRMED') confirmedSum.set(claim.buyer, (confirmedSum.get(claim.buyer) ?? 0) + (claim.price ?? 0))
    if (claim.price !== null) amounts.push([`찜 ${claim.id} 가격 스냅샷`, claim.price])
    if ((claim.status === 'WAITLISTED' || claim.status === 'PENDING' || claim.status === 'CONFLICT') && pget(state.blocked, claim.buyer) === true) {
      out.push({ id: 'R-9', message: `찜 ${claim.id}: 차단 중인 구매자 ${claim.buyer}의 ${claim.status} 찜` })
    }
  }

  const context: Context = { byId, root, out }
  const slotKeys = new Set<string>()
  for (const slot of pvalues(state.slots)) {
    slotKeys.add(slot.key)
    checkSlot(slot, bySlot.get(slot.key) ?? [], context)
    if (slot.product !== null) amounts.push([`상품 ${slot.key} 가격`, slot.product.price])
  }
  // 번호 기록이 없는 찜은 거절된 찜뿐이다(차단·판매 아님 등으로 번호를 만들지 않았다)
  for (const claim of byId.values()) {
    if (!slotKeys.has(claim.key) && isActive(claim.status)) out.push({ id: 'INV-2', message: `찜 ${claim.id}: 번호 ${claim.key} 기록 없이 활성이다` })
  }

  // INV-5: 구매자 합계 = 확정 찜 가격 스냅샷의 합 (자신의 찜. 지금의 구매자 합계는 합쳐진 구매자 것을 더한 것이다)
  for (const buyer of pvalues(state.buyers)) {
    const expected = confirmedSum.get(buyer.id) ?? 0
    if (buyer.subtotal !== expected) out.push({ id: 'INV-5', message: `구매자 ${buyer.id}: 합계 ${String(buyer.subtotal)} ≠ 확정 찜 가격 스냅샷의 합 ${String(expected)}` })
    amounts.push([`구매자 ${buyer.id} 합계`, buyer.subtotal])
  }

  // INV-6: 모든 금액은 0 이상의 정수 (조정 합계만 음수 가능)
  for (const s of listSettlements(state)) {
    const label = `정산 ${s.buyer}@${s.date}`
    amounts.push([`${label} 상품 합계`, s.subtotal], [`${label} 배송비`, s.shipping], [`${label} 최종 금액`, s.total], [`${label} 받은 금액`, s.received], [`${label} 환불 필요`, s.refundDue])
    if (!Number.isSafeInteger(s.adjustments)) out.push({ id: 'INV-6', message: `${label} 조정 합계가 정수가 아니다 (값: ${String(s.adjustments)})` })
  }
  for (const [what, value] of amounts) if (!isMoney(value)) out.push({ id: 'INV-6', message: `${what}이 0 이상의 정수가 아니다 (값: ${String(value)})` })
  return out
}
