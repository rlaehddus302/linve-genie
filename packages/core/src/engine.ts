// 판정 엔진 공개 API (R-0, AC-S02-01): initEngine · applyEvent · 조회 함수 · checkInvariants.
export { initEngine, applyEvent } from './engine/reducer.ts'
export { checkInvariants } from './engine/invariants.ts'
export {
  getProduct,
  listProducts,
  listClaims,
  listPending,
  getBuyer,
  listBuyers,
  getSettlement,
  listSettlements,
  listEffects,
  listCancelRequests,
  activeClaimId,
  productStatus,
} from './engine/views.ts'
export type * from './engine/types.ts'
export type { PMap } from './engine/pmap.ts'
