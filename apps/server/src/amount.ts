// 찜 금액 (O3 감사 D-O3-15, D-206): 라벨·포장·요약 댓글·봉인 장부는 코어 ClaimInfo.amount만 쓴다.
// 확정 찜의 amount는 코어가 늘 채우므로 없으면 프로그램 오류다 — 단가 × 수량이나 가격 스냅샷으로 채우지 않고 그 결과를 만들지 않는다.
import type { ClaimInfo } from '@livejjim/core'

/** 찜 금액이 없어 만들지 않았을 때 판매자에게 보이는 말 */
export const AMOUNT_MISSING_MESSAGE = '금액을 확인할 수 없어 만들지 않았어요. 관리자에게 알려 주세요.'

/** 확정 찜에 찜 금액이 없다 (찜 ID만 담는다 — 닉네임·금액·전화번호는 담지 않는다) */
export class MissingAmountError extends Error {
  readonly claimId: string
  constructor(claimId: string) {
    super('찜 금액이 없다')
    this.name = 'MissingAmountError'
    this.claimId = claimId
  }
}

/** 찜 금액 (정수 원). 없거나 정수가 아니면 null */
export function claimAmount(claim: Pick<ClaimInfo, 'amount'>): number | null {
  return typeof claim.amount === 'number' && Number.isSafeInteger(claim.amount) ? claim.amount : null
}

/** 찜 금액 — 없으면 MissingAmountError */
export function requireAmount(claim: Pick<ClaimInfo, 'id' | 'amount'>): number {
  const amount = claimAmount(claim)
  if (amount === null) throw new MissingAmountError(claim.id)
  return amount
}
