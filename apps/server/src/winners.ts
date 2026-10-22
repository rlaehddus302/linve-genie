// 상품의 지금 1등 찜 (O3, RA-O3-001): 옵션 상품의 1등은 변형마다에만 있다(D-O1-01) — 상품 자신의 winnerClaims는 빈 목록.
// 출력(print.ts)·봉인 장부(youtube/seal.ts)·방송 후 요약(youtube/outbox.ts)이 함께 쓴다. 판정은 하지 않는다(코어 조회 결과만 모은다).
import type { ProductInfo } from '@livejjim/core'

/** 그 상품의 지금 1등 찜 전부 — 상품 자신의 1등, 그다음 변형 순서대로 변형의 1등 */
export function winnerClaimsOf(product: Pick<ProductInfo, 'winnerClaims' | 'variants'>): string[] {
  return [...product.winnerClaims, ...product.variants.flatMap((variant) => variant.winnerClaims)]
}
