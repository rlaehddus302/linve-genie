// 가격을 고칠 때 "이미 찜한 손님에게도 적용할까요?" 물음의 글과 물을 손님 수 (D-RETRO-20).
// 상품 수정창(ProductEdit)과 동시에 넣은 손 등록 알림(SyncClash, D-RETRO-13)이 같은 물음을 쓴다 — 서로 가져오지 않게 여기에 둔다.
import type { Product } from '@livejjim/web/src/api/types.ts'
import { productSlots } from '../../lib/derive.ts'

export const PRICE_SCOPE_NEW = '새 찜부터'
export const PRICE_SCOPE_ALL = '찜한 손님도'
export const priceScopeAsk = (buyers: number): string => `이미 찜한 손님 ${String(buyers)}명에게도 새 가격을 적용할까요?`

/** 가격 적용 범위를 물을 손님 수: 그 상품에 확정된 찜의 손님 (같은 손님은 한 번). 0이면 묻지 않는다 */
export function claimedBuyers(product: Product): number {
  return new Set(productSlots(product).winners).size
}
