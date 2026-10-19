// 판정 엔진 공개 API (R-0, AC-S02-01, AC-S03-01): initEngine · applyEvent · 입력 검사 · 순수 도우미 · 조회 함수 · checkInvariants.
export { initEngine, applyEvent } from './engine/reducer.ts'
export { checkEvent, InvalidEventError, isInvalidEvent, EVENT_TYPES } from './engine/validate.ts'
export { checkInvariants } from './engine/invariants.ts'
export { CorruptStateError } from './engine/draft.ts'
export { normalizePhone, phoneLast4 } from './engine/phone.ts'
export { resolveReceivedTime, isValidReceivedTime, isValidDate, type ReceivedTime } from './engine/time.ts'
export { rankKey, compareRank, isSameMinuteTie, type RankMaterial, type ContentionSettings } from './engine/rank.ts'
export { settle, type SettlementTotals } from './engine/ledger.ts'
export {
  getProduct,
  listProducts,
  listClaims,
  listPending,
  getBuyer,
  listBuyers,
  currentBuyerOf,
  buyerOfRef,
  listSmsRefs,
  getSettlement,
  listSettlements,
  listEffects,
  listCancelRequests,
  activeClaimId,
  productStatus,
} from './engine/views.ts'
export type * from './engine/types.ts'
export type { PMap } from './engine/pmap.ts'
