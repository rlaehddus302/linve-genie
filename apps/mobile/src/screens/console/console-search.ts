// 라이브 화면 하나로 찾기 (D-UX4-205, 사용자 2026-11-16 "검색은 상품 검색이든 찜 검색이든 하나로 통합해서 다 보여주면 돼. 번호, 품종, 닉네임으로 검색되게 하면 되겠지."):
// 한 칸에 쓴 글로 상품과 찜 기록을 함께 찾는다. 글은 띄어쓰기·대소문자를 가리지 않는다(searchText).
import type { Product } from '@livejjim/web/src/api/types.ts'
import { productSlots } from '../../lib/derive.ts'
import { feedMatches, searchText, type FeedBuyer } from './feed-rows.ts'
import { rowName } from './ProductBoard.tsx'

/** 숫자만 쓴 글이면 앞 0을 뺀 번호 앞부분, 아니면 null */
export function numberPrefix(query: string): string | null {
  const wanted = searchText(query)
  return /^\d{1,9}$/.test(wanted) ? wanted.replace(/^0+(?=\d)/, '') : null
}

/** 상품: 번호 앞부분 · 품종 · 찜한(1등·대기) 손님 닉네임 중 하나라도 맞으면. 빈 글은 아무것도 맞지 않는다 */
export function productMatches(product: Product, query: string, nameOf: (buyerId: string) => string): boolean {
  const wanted = searchText(query)
  if (wanted === '') return false
  const prefix = numberPrefix(query)
  if (prefix !== null && String(product.no).startsWith(prefix)) return true
  if (searchText(rowName(product)).includes(wanted)) return true
  const slots = productSlots(product)
  return [...slots.winners, ...slots.waitlist].some((id) => searchText(nameOf(id)).includes(wanted))
}

/** 찜 기록 줄(손님 하나): 닉네임 · 찜한 번호 · 찜한 상품의 품종 중 하나라도 맞으면. 빈 글은 아무것도 맞지 않는다 */
export function feedRowMatches(row: Pick<FeedBuyer, 'buyer' | 'nos'>, query: string, productNameOf: (no: number) => string): boolean {
  const wanted = searchText(query)
  if (wanted === '') return false
  if (feedMatches(row, query)) return true
  return row.nos.some((item) => {
    const name = searchText(productNameOf(item.no))
    return name !== '' && name.includes(wanted)
  })
}
