// 찜 삭제·상품 삭제 (D-UX4-25, 사용자 지시 2026-11-09 "찜 삭제 누르면 … 삭제하면 그 다음 대기 1이 찜되게", "상품 삭제 메뉴").
// 앱은 판정하지 않는다 — 엔진의 방송자 취소(host.cancel)·승계(host.promote)·판매 종료(product.close)를 차례로 보낼 뿐이다.
// - 찜 삭제 = 방송자 취소. 1등이 빠지면 엔진이 그 방송의 승계 설정대로 한다(기본 AUTO = 대기 1이 바로 찜).
//   승계 설정이 ASK라 "다음 손님을 정해야 해요"로 남으면, 판매자가 "삭제"를 누른 뜻대로 대기 1을 1등으로 올린다(겹친 상품·옵션 상품은 정하기 창에 둔다).
// - 상품 삭제 = 그 상품의 살아 있는 찜을 모두 취소한 뒤 판매 종료(CLOSED, 소프트 삭제 R-2). 대기·보류·겹침을 먼저, 1등을 맨 나중에 —
//   1등을 먼저 지우면 대기가 승계로 1등이 되고 라벨·감사가 나간 뒤 다시 지워진다.
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import type { Claim, Product } from '@livejjim/web/src/api/types.ts'
import { claimsOfProduct, productSlots } from '../../lib/derive.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import type { ConsoleApi } from './context.ts'

export const CLAIM_DELETE_REASON = '판매자가 찜을 삭제했어요'
export const PROMOTE_AFTER_DELETE_REASON = '찜 삭제 뒤 다음 대기 손님'
export const PRODUCT_DELETE_REASON = '판매자가 상품을 삭제했어요'
/** 새 찜이 들어와 판매 종료가 되지 않았을 때 */
export const PRODUCT_DELETE_RACE = '그사이 새 찜이 들어와 지우지 못했어요. 다시 눌러 주세요.'

/** 지울 수 있는(살아 있는) 찜 */
export const ACTIVE_CLAIM: ReadonlySet<Claim['status']> = new Set(['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT'])

/** 찜을 가리키는 조치의 변형 고르기 (옵션 상품, R-19) */
function pickOf(claim: Claim): Record<string, unknown> {
  return claim.options === null || claim.options.length === 0 ? {} : { options: Object.fromEntries(claim.options.map(([name, label]) => [name, label])) }
}

const latestOf = (api: ConsoleApi): ScopeData => api.latest?.() ?? api.data

/** 찜 하나 삭제 — 1등이었고 승계가 방송자 결정으로 남으면 대기 1을 1등으로 */
export async function deleteClaim(api: ConsoleApi, claim: Claim): Promise<void> {
  await api.command({ type: 'host.cancel', b: claim.broadcast, no: claim.no, buyer: claim.currentBuyer, reason: CLAIM_DELETE_REASON, ...pickOf(claim) })
  if (claim.status !== 'CONFIRMED') return
  const product = latestOf(api).products.get(claim.product)
  if (product === undefined || product.hasOptions) return
  const slots = productSlots(product)
  const next = slots.waitlist[0]
  if (!slots.awaitingSuccession || slots.conflict || next === undefined) return
  await api.command({ type: 'host.promote', b: claim.broadcast, no: claim.no, buyer: next, reason: PROMOTE_AFTER_DELETE_REASON })
}

const DELETE_ORDER: Readonly<Record<string, number>> = { WAITLISTED: 0, PENDING: 1, CONFLICT: 2, CONFIRMED: 3 }

/** 상품 삭제 — 살아 있는 찜을 모두 취소하고 판매 종료. 새 찜이 끼어들어 닫히지 않으면 PRODUCT_DELETE_RACE */
export async function deleteProduct(api: ConsoleApi, product: Product): Promise<void> {
  const claims = claimsOfProduct(latestOf(api), product)
    .filter((claim) => ACTIVE_CLAIM.has(claim.status))
    .sort((a, b) => (DELETE_ORDER[a.status] ?? 9) - (DELETE_ORDER[b.status] ?? 9))
  for (const claim of claims) await api.command({ type: 'host.cancel', b: claim.broadcast, no: claim.no, buyer: claim.currentBuyer, reason: PRODUCT_DELETE_REASON, ...pickOf(claim) })
  const result = await api.command({ type: 'product.close', b: product.broadcast, no: product.no })
  const after = latestOf(api).products.get(product.key)
  if (!result.changed && after !== undefined && after.status !== 'CLOSED') throw new Error(PRODUCT_DELETE_RACE)
}

/** 메뉴 판이 다 닫힌 뒤 다음 판을 연다 — 판 닫힘(SHEET_OUT_MS 200) + 아이폰이 판을 내리는 시간 (D-UX3-26) */
export const SHEET_HANDOFF_MS = 400

/** 아래 판을 닫고 그다음 팝업을 띄울 때 — 아이폰은 판(Modal)이 닫히는 동안 새 판을 띄우지 못한다. 웹은 바로 */
export function useSheetHandoff(): (next: () => void) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])
  return (next) => {
    if (Platform.OS === 'web') {
      next()
      return
    }
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      next()
    }, SHEET_HANDOFF_MS)
  }
}
