// 찜 기록 보기 고르기 (D-RETRO-51·52, 사용자 지시 2026-11-12 복기 "오름차순으로 … 글자 크기를 줄여 한 화면에 더 많이"):
// 정렬(최근순 · 이름순) · 글자 크기(크게 · 작게).
// D-UX4-151 (사용자 지시 2026-11-16): 번호별 보기(D-RETRO-50)와 그 정렬(번호순·최근순)을 걷었다 — 상품 탭 [찜 된 것만]이 같은 일을 한다.
// 옛 앱이 저장한 mode·numberSort는 읽을 때 버린다(다음에 고르면 새 꼴로 쓴다).
// 이 휴대폰에만 둔다(앱 저장소 — 서버로 보내지 않는다, 화면 아래 창 고르기 dock-choice와 같은 방법). 기본은 지금까지의 모습(최근순 · 크게, D-UX4-27).
import { useSyncExternalStore } from 'react'

/** 손님 줄 순서: 최근순(가장 최근에 찜한 손님이 맨 아래, D-UX3-75) · 이름순(한글 → 영문 → 숫자·기호, D-UX4-153) */
export type BuyerSort = 'recent' | 'name'
export type FeedSize = 'large' | 'small'

export interface FeedView {
  readonly buyerSort: BuyerSort
  readonly size: FeedSize
}

export const FEED_VIEW_DEFAULT: FeedView = { buyerSort: 'recent', size: 'large' }
export const FEED_VIEW_KEY = 'livejjim.console.feedView'

/** 화면 낱말 */
export const BUYER_SORT_WORD: Readonly<Record<BuyerSort, string>> = { recent: '최근순', name: '이름순' }
export const FEED_SIZE_WORD: Readonly<Record<FeedSize, string>> = { large: '크게', small: '작게' }

/** 앱 저장소에서 쓰는 부분 (AsyncStorage) */
export interface FeedViewStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

let current: FeedView = FEED_VIEW_DEFAULT
let storage: FeedViewStorage | null = null
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

/** 저장한 글 → 보기. 모르는 값은 칸마다 기본으로 (옛 앱·깨진 값이어도 화면이 뜬다) */
export function parseFeedView(raw: string | null): FeedView {
  if (raw === null) return FEED_VIEW_DEFAULT
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return FEED_VIEW_DEFAULT
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return FEED_VIEW_DEFAULT
  const saved = value as Record<string, unknown>
  return {
    buyerSort: saved.buyerSort === 'name' || saved.buyerSort === 'recent' ? saved.buyerSort : FEED_VIEW_DEFAULT.buyerSort,
    size: saved.size === 'small' || saved.size === 'large' ? saved.size : FEED_VIEW_DEFAULT.size,
  }
}

const same = (a: FeedView, b: FeedView): boolean => a.buyerSort === b.buyerSort && a.size === b.size

export const getFeedView = (): FeedView => current

export function subscribeFeedView(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 고른 것만 바꾼다 — 바로 화면에 반영하고 저장소에 쓴다(실패해도 화면은 그대로) */
export function setFeedView(patch: Partial<FeedView>): void {
  const next = parseFeedView(JSON.stringify({ ...current, ...patch }))
  if (same(next, current)) return
  current = next
  notify()
  void storage?.setItem(FEED_VIEW_KEY, JSON.stringify(next)).catch(() => undefined)
}

/** 앱을 켤 때 한 번: 저장한 값을 되살리고, 바꿀 때마다 쓴다. 저장소가 실패해도 기본으로 간다 */
export async function wireFeedView(store: FeedViewStorage): Promise<void> {
  storage = store
  try {
    const saved = parseFeedView(await store.getItem(FEED_VIEW_KEY))
    if (!same(saved, current)) {
      current = saved
      notify()
    }
  } catch {
    // 못 읽으면 기본
  }
}

/** 시험용: 처음 상태로 */
export function resetFeedView(): void {
  current = FEED_VIEW_DEFAULT
  storage = null
  notify()
}

/** 지금 고른 찜 기록 보기 */
export const useFeedView = (): FeedView => useSyncExternalStore(subscribeFeedView, getFeedView, getFeedView)
