// 방송 화면 상품 목록 정렬 (D-UX4-150, 사용자 2026-11-16 "정렬 기능"): 화면 없는 순수 함수 — 시계·난수 없이 받은 상품만 다시 세운다.
// 기본은 최근 등록순(D-UX3-87). 같은 값끼리는 번호 작은순 → 나중에 올린 상품 먼저(늘 같은 차례가 나오게).
import type { Product } from '@livejjim/web/src/api/types.ts'
import { productOrder } from './derive.ts'

export type ProductSort = 'no-asc' | 'no-desc' | 'recent' | 'oldest' | 'price-asc' | 'price-desc'

/** 고르는 판에 보이는 차례 */
export const PRODUCT_SORTS: readonly ProductSort[] = ['no-asc', 'no-desc', 'recent', 'oldest', 'price-asc', 'price-desc']

// 기본은 최근 등록순 — 사용자가 정한 D-UX3-87("가장 최근에 말한 게 가장 위로")을 지킨다. 방금 올린 상품이 맨 위에서 빛난다
export const DEFAULT_PRODUCT_SORT: ProductSort = 'recent'

/** 고르는 판 제목·정렬 단추 이름 */
export const SORT_TITLE = '목록 순서'

const WORDS: Readonly<Record<ProductSort, string>> = {
  'no-asc': '번호 작은순',
  'no-desc': '번호 큰순',
  recent: '최근 등록순',
  oldest: '오래된 등록순',
  'price-asc': '가격 낮은순',
  'price-desc': '가격 높은순',
}

/** 정렬 이름 (쉬운 말 — 단추 글자·고르는 판 줄) */
export const sortWord = (sort: ProductSort): string => WORDS[sort]

type Sortable = Pick<Product, 'id' | 'no' | 'price'>

const byNo = (a: Sortable, b: Sortable): number => a.no - b.no
/** 가격순: 아직 가격이 없는 상품(가격 듣는 중, D-RECOG-22)은 어느 쪽 정렬이든 맨 뒤 — 0원으로 앞에 서지 않는다 */
const byPrice = (a: Sortable, b: Sortable, dir: 1 | -1): number => {
  if (a.price === null || b.price === null) return a.price === b.price ? 0 : a.price === null ? 1 : -1
  return (a.price - b.price) * dir
}
const byRecent = (a: Sortable, b: Sortable): number => productOrder(b) - productOrder(a)

const COMPARE: Readonly<Record<ProductSort, (a: Sortable, b: Sortable) => number>> = {
  'no-asc': (a, b) => byNo(a, b) || byRecent(a, b),
  'no-desc': (a, b) => byNo(b, a) || byRecent(a, b),
  recent: (a, b) => byRecent(a, b) || byNo(a, b),
  oldest: (a, b) => byRecent(b, a) || byNo(a, b),
  'price-asc': (a, b) => byPrice(a, b, 1) || byNo(a, b) || byRecent(a, b),
  'price-desc': (a, b) => byPrice(a, b, -1) || byNo(a, b) || byRecent(a, b),
}

/** 정렬한 새 배열 (받은 배열은 그대로) */
export function sortProducts<T extends Sortable>(products: readonly T[], sort: ProductSort): T[] {
  return [...products].sort(COMPARE[sort])
}
