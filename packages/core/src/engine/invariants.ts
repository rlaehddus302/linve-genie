// 한 상태만 보고 확인할 수 있는 불변식 (DOMAIN_RULES 불변식 표, AC-S02-01·91·93, AC-S03-92).
// INV-1·2·5·6·7·9, 차단 중인 구매자의 대기·보류·충돌 찜 없음(R-9, D-049), 충돌 성질(R-7 7, D-053).
// 서버의 재생 무결성 검사(S04)와 골든 러너가 매 이벤트 뒤에 부른다. 상태 크기에 비례하는 한 번 순회로 검사한다(AC-S03-05):
// 찜을 한 번 돌며 번호별·구매자별로 모으고, 번호·구매자를 한 번씩 본다(구매자×찜 이중 순회, 번호별 펼침 복사 없음).
// 목록이 찜 상태와 정확히 같으면 그 목록에 끝난 찜이 있을 수 없으므로, 끝난 찜(INV-9)은 어긋난 목록만 다시 본다.
// 이벤트 사이의 불변식(INV-3·4·8·10·11·12)은 두 상태·로그를 비교해야 해서 속성 테스트가 본다.
import { variantActiveKey } from './draft.ts'
import { pentries, pget, pkeys, pvalues } from './pmap.ts'
import { isActive } from './rules.ts'
import type { ClaimRecord, EngineState, InvariantViolation, SlotRecord } from './types.ts'
import { listSettlements } from './views.ts'

const isMoney = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0

/** 겹치지 않고 정확히 같은 집합인지 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  if (set.size !== a.length) return false
  return b.every((item) => set.has(item))
}

interface Context {
  readonly state: EngineState
  readonly root: (buyer: string) => string
  /** 찜 ID → 찜 (어긋난 목록을 다시 볼 때만 만든다) */
  readonly lookup: () => ReadonlyMap<string, ClaimRecord>
  readonly out: InvariantViolation[]
}

interface UnitView {
  readonly text: string | null
  readonly winners: readonly string[]
  readonly waitlist: readonly string[]
  readonly conflict: string | null
}

/** 판정 자리 하나 (번호 자신 또는 변형): INV-1·INV-7·INV-O1·R-7·INV-9 */
function checkUnit(unit: UnitView, claims: readonly ClaimRecord[], stock: number, where: string, { lookup, out }: Context): void {
  const confirmed: string[] = []
  const waiting: string[] = []
  const conflicts: string[] = []
  let units = 0
  for (const claim of claims) {
    if (claim.status === 'CONFIRMED') {
      confirmed.push(claim.id)
      units += claim.qty
    } else if (claim.status === 'WAITLISTED') {
      waiting.push(claim.id)
      // INV-O1: 대기 찜의 수량은 늘 1
      if (claim.qty !== 1) out.push({ id: 'INV-O1', message: `${where}: 대기 찜 ${claim.id}의 수량이 ${String(claim.qty)}이다` })
    } else if (claim.status === 'CONFLICT') conflicts.push(claim.id)
  }
  // 확정 수량을 보이는 말: 모두 수량 1이면 지금처럼 'n명', 아니면 '수량 n'
  const shown = units === confirmed.length ? `${String(units)}명` : `수량 ${String(units)}`
  // INV-1: 확정 수량(확정 찜 수량의 합) ≤ 재고, 확정 목록 = 확정 상태인 찜
  if (units > stock) out.push({ id: 'INV-1', message: `${where}: 확정 ${shown} > 재고 ${String(stock)}` })
  const winnersOk = sameSet(unit.winners, confirmed)
  if (!winnersOk) out.push({ id: 'INV-1', message: `${where}: 확정 목록과 찜 상태가 다르다` })
  // INV-7: 대기 순번 1..n 빈틈없음 = 대기 목록이 대기 상태인 찜 전부와 정확히 같고 겹치지 않는다
  const waitlistOk = sameSet(unit.waitlist, waiting)
  if (!waitlistOk) out.push({ id: 'INV-7', message: `${where}: 대기 목록과 대기 상태인 찜이 다르다` })
  // R-7 7: 충돌은 자리마다 하나, 충돌 표시 ⇔ 충돌 찜, 충돌 찜이 있으면 확정 수량 = 재고
  const marked = unit.conflict === null ? [] : [unit.conflict]
  const conflictOk = conflicts.length <= 1 && sameSet(marked, conflicts)
  if (!conflictOk) out.push({ id: 'R-7', message: `${where}: 충돌 표시와 충돌 찜이 다르다 (찜 ${String(conflicts.length)}개)` })
  if (unit.conflict !== null && units !== stock) out.push({ id: 'R-7', message: `${where}: 충돌 중인데 확정 ${shown} ≠ 재고 ${String(stock)}` })
  // INV-9: 취소·거절·중복 찜은 확정·대기·충돌 자리(합계의 바탕)에 없다 — 어긋난 목록만 다시 본다
  if (winnersOk && waitlistOk && conflictOk) return
  const byId = lookup()
  const suspects = [...(winnersOk ? [] : unit.winners), ...(waitlistOk ? [] : unit.waitlist), ...(conflictOk ? [] : marked)]
  const ended = suspects.filter((id) => {
    const claim = byId.get(id)
    return claim !== undefined && !isActive(claim.status)
  })
  if (ended.length > 0) out.push({ id: 'INV-9', message: `${where}: 끝난 찜이 목록에 남아 있다 (${ended.join(', ')})` })
}

/** 자리의 재고 (옵션 없는 상품은 상품 재고, 변형은 변형 재고, 상품이 없거나 옵션 상품의 번호 자신은 0) */
function stockIn(slot: SlotRecord, text: string | null): number {
  const product = slot.product
  if (product === null) return 0
  if (text === null) return product.options.length === 0 ? product.stock : 0
  return product.variants.find((variant) => variant.text === text)?.stock ?? 0
}

function checkSlot(slot: SlotRecord, claims: readonly ClaimRecord[], context: Context): void {
  const { root, lookup, out } = context
  const where = `상품 ${slot.key}`
  const pending = new Set<string>()
  const byUnit = new Map<string | null, ClaimRecord[]>()
  const plainActive = new Map<string, string>()
  const variantActive = new Map<string, string>()
  let plainCount = 0
  let variantCount = 0
  const texts = new Set(slot.units.map((unit) => unit.text))
  for (const claim of claims) {
    if (claim.status === 'PENDING') pending.add(claim.id)
    const group = byUnit.get(claim.variant)
    if (group === undefined) byUnit.set(claim.variant, [claim])
    else group.push(claim)
    if (!isActive(claim.status)) continue
    if (claim.variant === null) {
      plainCount++
      plainActive.set(root(claim.buyer), claim.id)
    } else {
      variantCount++
      variantActive.set(variantActiveKey(root(claim.buyer), claim.variant), claim.id)
      // 보류 찜 밖의 변형 찜은 그 상품의 변형 자리에 있어야 한다
      if (claim.status !== 'PENDING' && !texts.has(claim.variant)) out.push({ id: 'INV-2', message: `${where}: 찜 ${claim.id}의 변형 '${claim.variant}' 자리가 없다` })
    }
  }
  checkUnit({ text: null, winners: slot.winners, waitlist: slot.waitlist, conflict: slot.conflict }, byUnit.get(null) ?? [], stockIn(slot, null), where, context)
  for (const unit of slot.units) checkUnit(unit, byUnit.get(unit.text) ?? [], stockIn(slot, unit.text), `${where}#${unit.text}`, context)
  // INV-2: 한 구매자(지금의 구매자) 한 자리 활성 찜 ≤ 1 (충돌 찜 포함), 보류 목록·활성 표시 = 찜 상태
  // (영속 맵은 키마다 찾지 않고 한 번에 훑어 맞춰 본다)
  const pendingOk = slot.pending.size === pending.size && pkeys(slot.pending).every((id) => pending.has(id))
  if (!pendingOk) {
    out.push({ id: 'INV-2', message: `${where}: 보류 목록과 보류 상태인 찜이 다르다` })
    const byId = lookup()
    const ended = pkeys(slot.pending).filter((id) => {
      const claim = byId.get(id)
      return claim !== undefined && !isActive(claim.status)
    })
    if (ended.length > 0) out.push({ id: 'INV-9', message: `${where}: 끝난 찜이 보류 목록에 남아 있다 (${ended.join(', ')})` })
  }
  if (plainActive.size !== plainCount || variantActive.size !== variantCount) out.push({ id: 'INV-2', message: `${where}: 한 구매자에게 활성 찜이 둘 이상이다` })
  const plainOk = slot.active.size === plainCount && plainActive.size === plainCount && pentries(slot.active).every(([owner, id]) => plainActive.get(owner) === id)
  const variantOk = slot.variantActive.size === variantCount && variantActive.size === variantCount && pentries(slot.variantActive).every(([owner, id]) => variantActive.get(owner) === id)
  if (!plainOk || !variantOk) out.push({ id: 'INV-2', message: `${where}: 활성 찜 표시가 찜 상태와 다르다` })
}

/** 위반 목록 (없으면 빈 배열) */
export function checkInvariants(state: EngineState): InvariantViolation[] {
  const out: InvariantViolation[] = []
  // 합쳐진 구매자만 따로 모아 두고(대부분은 자기 자신이 지금의 구매자다) 연결을 따라간다
  const parents = new Map<string, string>()
  for (const buyer of pvalues(state.buyers)) if (buyer.parent !== null) parents.set(buyer.id, buyer.parent)
  const roots = new Map<string, string>()
  const root = (buyer: string): string => {
    if (!parents.has(buyer)) return buyer
    const known = roots.get(buyer)
    if (known !== undefined) return known
    let current = buyer
    // 연결이 고리면(손상된 상태) 구매자 수만큼 따라간 뒤 멈춘다 — INV-2 검사가 어긋남을 알린다
    for (let steps = 0; steps <= parents.size; steps++) {
      const parent = parents.get(current)
      if (parent === undefined) break
      current = parent
    }
    roots.set(buyer, current)
    return current
  }
  let byId: Map<string, ClaimRecord> | undefined
  const lookup = (): ReadonlyMap<string, ClaimRecord> => (byId ??= new Map(pvalues(state.claims).map((claim) => [claim.id, claim])))

  // 찜 한 번 순회: 번호별 모음, 구매자별 확정 합계, 가격 스냅샷, 차단 중인 구매자의 대기·보류·충돌 찜
  const bySlot = new Map<string, ClaimRecord[]>()
  const confirmedSum = new Map<string, number>()
  const anyBlocked = state.blocked.size > 0
  const claims = pvalues(state.claims)
  for (const claim of claims) {
    const group = bySlot.get(claim.key)
    if (group === undefined) bySlot.set(claim.key, [claim])
    else group.push(claim)
    // INV-5: 찜 금액 = 단가 스냅샷 × 수량
    if (claim.status === 'CONFIRMED') confirmedSum.set(claim.buyer, (confirmedSum.get(claim.buyer) ?? 0) + (claim.price as number) * claim.qty)
    if (!Number.isSafeInteger(claim.qty) || claim.qty < 1) out.push({ id: 'INV-6', message: `찜 ${claim.id} 수량이 1 이상의 정수가 아니다 (값: ${String(claim.qty)})` })
    if (claim.price !== null && !isMoney(claim.price)) out.push({ id: 'INV-6', message: `찜 ${claim.id} 가격 스냅샷이 0 이상의 정수가 아니다 (값: ${String(claim.price)})` })
    if (anyBlocked && (claim.status === 'WAITLISTED' || claim.status === 'PENDING' || claim.status === 'CONFLICT') && pget(state.blocked, claim.buyer) === true) {
      out.push({ id: 'R-9', message: `찜 ${claim.id}: 차단 중인 구매자 ${claim.buyer}의 ${claim.status} 찜` })
    }
  }

  const context: Context = { state, root, lookup, out }
  for (const slot of pvalues(state.slots)) {
    checkSlot(slot, bySlot.get(slot.key) ?? [], context)
    bySlot.delete(slot.key)
    if (slot.product !== null && !isMoney(slot.product.price)) out.push({ id: 'INV-6', message: `상품 ${slot.key} 가격이 0 이상의 정수가 아니다 (값: ${String(slot.product.price)})` })
  }
  // 번호 기록이 없는 찜은 거절된 찜뿐이다(차단·판매 아님 등으로 번호를 만들지 않았다)
  for (const orphans of bySlot.values()) {
    for (const claim of orphans) if (isActive(claim.status)) out.push({ id: 'INV-2', message: `찜 ${claim.id}: 번호 ${claim.key} 기록 없이 활성이다` })
  }

  // INV-O2: 확인 필요 항목은 찜이 아니다 — 재고·합계·효과에 들어가지 않는다(찜·효과 ID가 없다). 항목은 형식만 본다
  for (const review of pvalues(state.reviews)) {
    if (pget(state.buyers, review.buyer) === undefined) out.push({ id: 'INV-O2', message: `확인 필요 ${review.item}: 엔진이 모르는 구매자 ${review.buyer}` })
    if (review.qty !== null && !(Number.isSafeInteger(review.qty) && review.qty >= 0)) out.push({ id: 'INV-O2', message: `확인 필요 ${review.item}: 읽은 수량이 0 이상의 정수가 아니다` })
  }

  // INV-5: 구매자 합계 = 확정 찜 가격 스냅샷의 합 (자신의 찜. 지금의 구매자 합계는 합쳐진 구매자 것을 더한 것이다)
  for (const buyer of pvalues(state.buyers)) {
    const expected = confirmedSum.get(buyer.id) ?? 0
    if (buyer.subtotal !== expected) out.push({ id: 'INV-5', message: `구매자 ${buyer.id}: 합계 ${String(buyer.subtotal)} ≠ 확정 찜 가격 스냅샷의 합 ${String(expected)}` })
    if (!isMoney(buyer.subtotal)) out.push({ id: 'INV-6', message: `구매자 ${buyer.id} 합계가 0 이상의 정수가 아니다 (값: ${String(buyer.subtotal)})` })
  }

  // INV-6: 모든 금액은 0 이상의 정수 (조정 합계만 음수 가능)
  for (const s of listSettlements(state)) {
    const label = `정산 ${s.buyer}@${s.date}`
    const amounts: [string, number][] = [
      ['상품 합계', s.subtotal],
      ['배송비', s.shipping],
      ['최종 금액', s.total],
      ['받은 금액', s.received],
      ['환불 필요', s.refundDue],
    ]
    for (const [what, value] of amounts) if (!isMoney(value)) out.push({ id: 'INV-6', message: `${label} ${what}이 0 이상의 정수가 아니다 (값: ${String(value)})` })
    if (!Number.isSafeInteger(s.adjustments)) out.push({ id: 'INV-6', message: `${label} 조정 합계가 정수가 아니다 (값: ${String(s.adjustments)})` })
  }
  return out
}
