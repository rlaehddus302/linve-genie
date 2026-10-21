// 구매자 합치기 (R-11 "구매자 합치기"·"미리 보기", D-057, D-100).
// 판정(buyer.merge 처리)과 순수 조회(previewMerge)가 같은 계획 함수 planMerge를 쓴다 — 막는 조건과 "앞선 쪽" 순서를 두 번 구현하지 않는다.
// planMerge는 작업 사본을 읽기만 하고, applyMerge가 그 계획대로 작업 사본을 바꾼다.
import { CorruptStateError, Unit, ownGet, variantActiveKey, type ClaimDraft, type Draft, type SlotDraft } from './draft.ts'
import { pdelete, pset } from './pmap.ts'
import { activeIdIn, compareClaims, detach, isActive, settleAwaiting, unitRecordOf } from './rules.ts'
import type { ClaimRecord, MergeBlockReason, SlotRecord } from './types.ts'

type AnyClaim = ClaimRecord | ClaimDraft
type AnySlot = SlotRecord | SlotDraft

/** 합친 결과 한 상품에 활성 찜이 둘이면 앞선 쪽: 확정 > 충돌 > 대기(앞 순번) > 보류(판정 순위) */
const STATUS_ORDER: Readonly<Record<string, number>> = { CONFIRMED: 0, CONFLICT: 1, WAITLISTED: 2, PENDING: 3 }

function aheadOf(d: Draft, slot: AnySlot, a: AnyClaim, b: AnyClaim): boolean {
  // 둘 다 활성 찜이다
  const byStatus = (ownGet(STATUS_ORDER, a.status) as number) - (ownGet(STATUS_ORDER, b.status) as number)
  if (byStatus !== 0) return byStatus < 0
  if (a.status === 'WAITLISTED') {
    // 같은 자리(번호·변형)의 두 대기 찜 — 앞 순번
    const waitlist = unitRecordOf(slot, a.variant)?.waitlist ?? []
    return waitlist.indexOf(a.id) < waitlist.indexOf(b.id)
  }
  return compareClaims(d, a, b) < 0
}

/** 지금의 구매자 아래(자신 포함)의 활성 찜 — 구매자 순서(members), 구매자마다 생성 순서 */
export function activeClaimsOf(d: Draft, members: readonly string[]): AnyClaim[] {
  const out: AnyClaim[] = []
  for (const member of members) {
    for (const id of d.claimIdsOf(member)) {
      const claim = d.readClaim(id)
      if (claim !== undefined && isActive(claim.status)) out.push(claim)
    }
  }
  return out
}

/** 옮길 쪽 활성 찜 하나: 그 번호에 남는 찜(keep)과 DUPLICATE가 될 찜(drop — 남는 쪽에 찜이 없으면 null) */
export interface MergeStep {
  readonly claim: AnyClaim
  readonly keep: AnyClaim
  readonly drop: AnyClaim | null
}

export type MergePlan =
  | {
      readonly blocked: MergeBlockReason
      /** into의 지금의 구매자 (into를 모르면 null) */
      readonly target: string | null
      /** BOTH_CONFIRMED면 남는 쪽에도 확정 찜이 있는 옮길 쪽 확정 찜, 아니면 빈 목록 */
      readonly bothConfirmed: readonly AnyClaim[]
    }
  | { readonly blocked: null; readonly target: string; readonly bothConfirmed: readonly AnyClaim[]; readonly steps: readonly MergeStep[] }

/**
 * buyer.merge(from, into)의 계획 (R-11). 작업 사본을 읽기만 한다. 막는 이유는 위에서부터 처음 맞는 것:
 * 둘 중 하나를 엔진이 모름 → 같은 구매자 → from이 이미 합쳐져 있음 → 고리(into의 지금의 구매자가 from) → 확정 찜이 둘이 되는 상품.
 * 막히지 않으면 from 나무의 활성 찜마다 그 번호의 남는 쪽(지금의 구매자) 활성 찜과 겨뤄 앞선 쪽을 남긴다.
 */
export function planMerge(d: Draft, from: string, into: string): MergePlan {
  const source = d.readBuyer(from)
  const target = d.readBuyer(into) === undefined ? null : d.root(into)
  if (source === undefined || target === null) return { blocked: 'UNKNOWN_BUYER', target, bothConfirmed: [] }
  if (from === into) return { blocked: 'SAME_BUYER', target, bothConfirmed: [] }
  if (source.parent !== null) return { blocked: 'FROM_MERGED', target, bothConfirmed: [] }
  // 고리 금지: into의 지금의 구매자가 from이면 into는 from 아래에 있다
  if (target === from) return { blocked: 'CYCLE', target, bothConfirmed: [] }
  const moving = activeClaimsOf(d, d.members(from))
  const activeOf = (claim: AnyClaim): string | undefined => activeIdIn(d, d.readSlot(claim.key) as AnySlot, claim.variant, target)
  // 확정 찜이 둘이 되는 상품이 하나라도 있으면 합치기 전체가 아무 일도 없다
  const bothConfirmed = moving.filter((claim) => {
    if (claim.status !== 'CONFIRMED') return false
    const other = activeOf(claim)
    return other !== undefined && d.readClaim(other)?.status === 'CONFIRMED'
  })
  if (bothConfirmed.length > 0) return { blocked: 'BOTH_CONFIRMED', target, bothConfirmed }
  const steps = moving.map((claim): MergeStep => {
    const otherId = activeOf(claim)
    if (otherId === undefined) return { claim, keep: claim, drop: null }
    const other = d.readClaim(otherId)
    if (other === undefined) throw new CorruptStateError(`활성 찜 ${otherId}가 없다`)
    return aheadOf(d, d.readSlot(claim.key) as AnySlot, claim, other) ? { claim, keep: claim, drop: other } : { claim, keep: other, drop: claim }
  })
  return { blocked: null, target, bothConfirmed: [], steps }
}

/**
 * 막히지 않은 계획을 작업 사본에 적용한다: from을 into 아래에 두고, from 나무의 활성 표시(from 키)를 지금의 구매자로 옮긴다.
 * 겹친 번호는 앞선 쪽만 남기고 나머지는 DUPLICATE(효과 없음). 번호마다 따로라 계획을 먼저 세워도 차례로 바꾼 것과 같다.
 */
export function applyMerge(d: Draft, from: string, into: string, plan: MergePlan & { readonly blocked: null }): void {
  d.knownBuyer(from).parent = into
  d.knownBuyer(into).children.push(from)
  for (const { claim, keep, drop } of plan.steps) {
    const slot = d.slot(claim.b, claim.no)
    if (claim.variant === null) slot.active = pset(pdelete(slot.active, from), plan.target, keep.id)
    else slot.variantActive = pset(pdelete(slot.variantActive, variantActiveKey(from, claim.variant)), variantActiveKey(plan.target, claim.variant), keep.id)
    if (drop === null) continue
    const unit = new Unit(slot, claim.variant)
    detach(drop, unit)
    const dropped = d.claim(drop.id)
    dropped.status = 'DUPLICATE'
    dropped.reason = null
    dropped.request = null
    settleAwaiting(d, unit)
  }
}
