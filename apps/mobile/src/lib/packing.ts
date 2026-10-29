// 포장 모드의 값 고르기 (STL-08, D-I2-05·06 — 웹 lib/packing.ts와 같은 규칙). 상태는 서버가 정한 다섯 말을 그대로 쓰고 화면은 거르기·순서·안내 글만 만든다.
import type { PackingEntry, PackingItem, PackingWord } from '@livejjim/web/src/api/types.ts'

export const PACKING_TONE: Readonly<Record<PackingWord, 'info' | 'success' | 'warning'>> = {
  '포장 대기': 'info',
  '포장 완료': 'success',
  '배송 완료': 'success',
  '포장 다시 확인': 'warning',
  '배송 뒤 바뀜': 'warning',
}

export function isChanged(status: PackingWord): boolean {
  return status === '포장 다시 확인' || status === '배송 뒤 바뀜'
}

export function packingWords(status: PackingWord, invoice: string | null): string {
  return (status === '배송 완료' || status === '배송 뒤 바뀜') && invoice !== null ? `${status} · 송장 ${invoice}` : status
}

export type PackingFilter = 'todo' | 'packed' | 'shipped' | 'all'

export const PACKING_FILTERS: readonly { readonly key: PackingFilter; readonly word: string; readonly empty: string }[] = [
  { key: 'todo', word: '포장할 것', empty: '포장할 구매자가 없어요.' },
  { key: 'packed', word: '포장 완료', empty: '포장 완료한 구매자가 없어요.' },
  { key: 'shipped', word: '배송 완료', empty: '배송 완료한 구매자가 없어요.' },
  { key: 'all', word: '전체', empty: '그날 포장할 구매자가 없어요.' },
]

export function inFilter(entry: Pick<PackingEntry, 'status'>, filter: PackingFilter): boolean {
  switch (filter) {
    case 'todo':
      return entry.status === '포장 대기' || entry.status === '포장 다시 확인'
    case 'packed':
      return entry.status === '포장 완료'
    case 'shipped':
      return entry.status === '배송 완료' || entry.status === '배송 뒤 바뀜'
    case 'all':
      return true
  }
}

export function sortEntries(entries: readonly PackingEntry[]): PackingEntry[] {
  return [...entries].sort((a, b) => Number(!isChanged(a.status)) - Number(!isChanged(b.status)) || a.name.localeCompare(b.name, 'ko') || (a.buyer < b.buyer ? -1 : a.buyer > b.buyer ? 1 : 0))
}

const qtyOf = (item: { readonly qty?: number }): number => item.qty ?? 1

/** "상품 n개"의 n = 수량 합 */
export function itemCount(items: readonly { readonly qty?: number }[]): number {
  return items.reduce((sum, item) => sum + qtyOf(item), 0)
}

/** 품목 줄 `21번 반바지 L 2개` / `7번 핑크프릴` */
export function itemLineWords(item: Pick<PackingItem, 'no' | 'name' | 'variant' | 'qty'>): string {
  const name = item.name === '' ? '' : ` ${item.name}`
  const variant = (item.variant ?? '').trim()
  const qty = qtyOf(item)
  return `${String(item.no)}번${name}${variant === '' ? '' : ` ${variant}`}${qty > 1 ? ` ${String(qty)}개` : ''}`
}

/** 포장 완료 본문의 품목 `{ key, qty }` */
export function packItems(items: readonly Pick<PackingItem, 'key' | 'qty'>[]): { readonly key: string; readonly qty: number }[] {
  return items.map((item) => ({ key: item.key, qty: qtyOf(item) }))
}

export const NO_SALES = '아직 판매 기록이 없어요.'
export const ALL_CHECKED_HINT = '모두 담으면 포장 완료를 누를 수 있어요.'
export const PACKED_NOTICE = '포장 완료로 적었어요.'
export const SEALED_VIEW_ONLY = '30일이 지나 봉인한 날짜예요. 볼 수만 있어요.'
