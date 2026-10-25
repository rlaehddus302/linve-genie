// 1등 자리를 비운 조치의 결과 한 줄 (D-MOB2-04, UX-06). 보낸 기기에서만: 1등(CONFIRMED) 찜을 대상으로 한
// host.cancel·host.reject·host.approveCancel이 적용되면(changed), 화면이 응답 seq까지 따라잡은 뒤 조치 전·뒤 상품(또는 그 변형)을 견줘
// 문장을 만든다(words.ts vacatedOutcome). 판정은 하지 않는다 — 엔진 결과를 읽기만 한다.
import type { Claim, Product } from '../api/types.ts'
import { BuyerNames, variantOf } from './derive.ts'
import type { ScopeData } from './scope-data.ts'
import type { OutcomeLine } from './undo-queue.ts'
import { vacatedOutcome, type VacatedUnitView } from './words.ts'

/** 결과 한 줄을 붙이는 조치 */
const VACATING = new Set(['host.cancel', 'host.reject', 'host.approveCancel'])

/** 보내기 직전에 잡아 둔 조치 전 모양 */
export interface VacatedBefore {
  readonly claim: string
  readonly product: string
  readonly variant: string | null
  readonly label: string
  readonly unit: VacatedUnitView
}

function unitOf(product: Product, claim: Pick<Claim, 'key' | 'variant'>): VacatedUnitView | undefined {
  if (claim.variant === null) return { winnerClaims: product.winnerClaims, waitlistClaims: product.waitlistClaims, awaitingSuccession: product.awaitingSuccession }
  const variant = variantOf(product, claim)
  return variant === undefined ? undefined : { winnerClaims: variant.winnerClaims, waitlistClaims: variant.waitlistClaims, awaitingSuccession: variant.awaitingSuccession }
}

/**
 * 결과 줄 앞의 이름: "15번", 옵션 찜이면 번호 뒤에 그 찜의 옵션 글("15번 빨강" — claimOptionWords와 같은 변형 글, 수량은 붙이지 않는다)
 */
export function vacatedLabel(claim: Pick<Claim, 'no' | 'variant'>): string {
  return `${String(claim.no)}번${claim.variant === null ? '' : ` ${claim.variant}`}`
}

/**
 * 보내기 직전: 그 조치가 1등 찜 하나를 가리키면 조치 전 모양을 잡는다(아니면 null — 결과 줄 없음).
 * 대기·보류·충돌 찜의 조치, 찜 여럿·찜 없는 조치는 null
 */
export function captureVacated(data: ScopeData | null, event: Readonly<Record<string, unknown>>, claims: readonly string[]): VacatedBefore | null {
  if (data === null || typeof event.type !== 'string' || !VACATING.has(event.type) || claims.length !== 1) return null
  const claim = data.claims.get(claims[0] ?? '')
  if (claim === undefined || claim.status !== 'CONFIRMED') return null
  const product = data.products.get(claim.product)
  if (product === undefined) return null
  const unit = unitOf(product, claim)
  if (unit === undefined || !unit.winnerClaims.includes(claim.id)) return null
  return { claim: claim.id, product: product.key, variant: claim.variant, label: vacatedLabel(claim), unit }
}

/** 따라잡은 뒤: 조치 뒤 모양으로 결과 한 줄 (아직 1등이면·상품이 없으면 null — 평소처럼 "보냈어요") */
export function vacatedLine(before: VacatedBefore, data: ScopeData | null): OutcomeLine | null {
  if (data === null) return null
  const claim = data.claims.get(before.claim)
  if (claim === undefined || claim.status === 'CONFIRMED') return null
  const product = data.products.get(before.product)
  if (product === undefined) return null
  const after = unitOf(product, claim)
  if (after === undefined) return null
  const names = new BuyerNames(data.buyers, data.claims)
  const waitlistCleared = before.unit.waitlistClaims.some((id) => {
    const item = data.claims.get(id)
    return item?.status === 'REJECTED' && item.reason === 'WAITLIST_CLEARED'
  })
  const result = vacatedOutcome({
    label: before.label,
    before: before.unit,
    after,
    afterStatus: product.status,
    waitlistCleared,
    nameOfClaim: (id) => {
      const item = data.claims.get(id)
      return item === undefined ? names.name('') : names.name(item.currentBuyer)
    },
  })
  return { text: result.text, tone: result.kind === 'winner' ? 'success' : result.kind === 'ask' ? 'warning' : 'info' }
}
