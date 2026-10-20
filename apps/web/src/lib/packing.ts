// 포장 모드의 값 고르기 (STL-08, D-I2-05·D-I2-06, AC-I2-35~38). 상태는 서버가 정한 다섯 말을 그대로 쓰고 화면은 거르기·순서·안내 글만 만든다.
import type { PackingEntry, PackingItem, PackingRemoved, PackingWord } from '../api/types.ts'

/** 상태 말의 뜻 (D-102): 포장 대기 = 보통, 포장 완료·배송 완료 = 성공, 포장 다시 확인·배송 뒤 바뀜 = 주의 */
export const PACKING_TONE: Readonly<Record<PackingWord, 'info' | 'success' | 'warning'>> = {
  '포장 대기': 'info',
  '포장 완료': 'success',
  '배송 완료': 'success',
  '포장 다시 확인': 'warning',
  '배송 뒤 바뀜': 'warning',
}

/** 품목이 포장 때와 달라진 상태 (목록 맨 앞에 둔다) */
export function isChanged(status: PackingWord): boolean {
  return status === '포장 다시 확인' || status === '배송 뒤 바뀜'
}

/** 상태 말 + 송장번호 ("배송 완료 · 송장 123456789012") */
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

/** 걸러 보기 (AC-I2-35): 포장할 것 = 포장 대기·포장 다시 확인, 포장 완료, 배송 완료 = 배송 완료·배송 뒤 바뀜, 전체 */
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

/**
 * 순서 (AC-I2-35): 포장 다시 확인·배송 뒤 바뀜 먼저, 그다음 이름 순 — 구매자 목록과 같은 순서(표시 이름 한국어 순, 같으면 구매자 ID 순).
 * displayOf는 그 구매자의 표시 이름(모르면 entry.name).
 */
export function sortEntries(entries: readonly PackingEntry[], displayOf: (entry: PackingEntry) => string): PackingEntry[] {
  return [...entries].sort(
    (a, b) =>
      Number(!isChanged(a.status)) - Number(!isChanged(b.status)) ||
      displayOf(a).localeCompare(displayOf(b), 'ko') ||
      (a.buyer < b.buyer ? -1 : a.buyer > b.buyer ? 1 : 0),
  )
}

/** "다음 구매자": 정렬한 "포장할 것" 목록에서 지금 구매자 다음 사람(지금 구매자는 뺀다). 없으면 null */
export function nextBuyer(sorted: readonly PackingEntry[], current: string): string | null {
  const todo = sorted.filter((entry) => inFilter(entry, 'todo'))
  const at = sorted.findIndex((entry) => entry.buyer === current)
  const after = todo.find((entry) => entry.buyer !== current && sorted.indexOf(entry) > at)
  return (after ?? todo.find((entry) => entry.buyer !== current))?.buyer ?? null
}

/** 품목 이름 "15번" (방송이 둘 이상이면 "2부 15번") */
export function itemNumber(item: Pick<PackingItem, 'title' | 'no'>, multi: boolean): string {
  return multi ? `${item.title} ${String(item.no)}번` : `${String(item.no)}번`
}

/** 그 묶음의 품목이 방송 둘 이상에 걸쳐 있는가 */
export function spansBroadcasts(items: readonly Pick<PackingItem, 'broadcast'>[]): boolean {
  return new Set(items.map((item) => item.broadcast)).size > 1
}

export interface ItemChange {
  readonly add: readonly PackingItem[]
  readonly remove: readonly PackingRemoved[]
}

/**
 * 체크리스트·바뀐 품목 안내에 방송 제목을 붙이는가 (TD-I2-002): 지금 품목과 새로 담을 것·뺄 것을 합친 집합이 방송 둘 이상에 걸치면 붙인다.
 * 1부 7번을 남기고 2부 7번이 빠지면 지금 품목도 뺄 것도 한 방송씩이지만, 제목 없이 "뺄 것: 7번"이면 어느 7번인지 모른다.
 */
export function checklistSpansBroadcasts(items: readonly Pick<PackingItem, 'broadcast'>[], change: ItemChange): boolean {
  return spansBroadcasts([...items, ...change.add, ...change.remove])
}

/** 처음 본 품목(base)과 지금 품목의 차이 — 새로 담을 것(지금만 있음)·뺄 것(처음만 있음) */
export function diffItems(base: readonly PackingItem[], current: readonly PackingItem[]): ItemChange {
  const before = new Set(base.map((item) => item.key))
  const now = new Set(current.map((item) => item.key))
  return {
    add: current.filter((item) => !before.has(item.key)),
    remove: base.filter((item) => !now.has(item.key)).map((item) => ({ key: item.key, broadcast: item.broadcast, title: item.title, no: item.no })),
  }
}

/** "새로 담을 것: 31번 · 뺄 것: 28번" (없는 쪽은 뺀다) */
export function changeWords(change: ItemChange, multi: boolean): string {
  const parts: string[] = []
  if (change.add.length > 0) parts.push(`새로 담을 것: ${change.add.map((item) => itemNumber(item, multi)).join(', ')}`)
  if (change.remove.length > 0) parts.push(`뺄 것: ${change.remove.map((item) => itemNumber(item, multi)).join(', ')}`)
  return parts.join(' · ')
}

/** 바뀐 품목 안내 (AC-I2-37): 포장 전·포장 다시 확인 / 배송 뒤 바뀜 */
export function changeNotice(change: ItemChange, multi: boolean, shipped: boolean): string {
  const words = changeWords(change, multi)
  return shipped ? `배송한 뒤 구매 내역이 바뀌었어요 — ${words}. 따로 보내거나 환불해 주세요.` : `구매 내역이 바뀌었어요 — ${words}`
}

/** 상품 키 집합이 같은가 */
export function sameKeys(a: readonly Pick<PackingItem, 'key'>[], b: readonly Pick<PackingItem, 'key'>[]): boolean {
  if (a.length !== b.length) return false
  const keys = new Set(a.map((item) => item.key))
  return b.every((item) => keys.has(item.key))
}
