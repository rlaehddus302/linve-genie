// 찜 기록 보기 고르기 (D-RETRO-50~52, 사용자 지시 2026-11-12 복기 "번호별로 누가 찜했는지도 … 오름차순으로 … 글자 크기를 줄여 한 화면에 더 많이"):
// 보기(손님별 · 번호별) · 정렬(손님별: 최근순 · 이름순 / 번호별: 번호순 · 최근순) · 글자 크기(크게 · 작게).
// 이 휴대폰에만 둔다(앱 저장소 — 서버로 보내지 않는다, 화면 아래 창 고르기 dock-choice와 같은 방법). 기본은 지금까지의 모습(손님별 · 최근순 · 크게, D-UX4-27).
import { useSyncExternalStore } from 'react'

export type FeedMode = 'buyer' | 'number'
/** 손님별 줄 순서: 최근순(가장 최근에 찜한 손님이 맨 아래, D-UX3-75) · 이름순(가나다 오름차순) */
export type BuyerSort = 'recent' | 'name'
/** 번호별 줄 순서: 번호순(오름차순) · 최근순(가장 최근에 찜이 온 번호가 맨 아래) */
export type NumberSort = 'number' | 'recent'
export type FeedSize = 'large' | 'small'

export interface FeedView {
  readonly mode: FeedMode
  readonly buyerSort: BuyerSort
  readonly numberSort: NumberSort
  readonly size: FeedSize
}

export const FEED_VIEW_DEFAULT: FeedView = { mode: 'buyer', buyerSort: 'recent', numberSort: 'number', size: 'large' }
export const FEED_VIEW_KEY = 'livejjim.console.feedView'

/** 화면 낱말 */
export const FEED_MODE_WORD: Readonly<Record<FeedMode, string>> = { buyer: '손님별', number: '번호별' }
export const BUYER_SORT_WORD: Readonly<Record<BuyerSort, string>> = { recent: '최근순', name: '이름순' }
export const NUMBER_SORT_WORD: Readonly<Record<NumberSort, string>> = { number: '번호순', recent: '최근순' }
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
    mode: saved.mode === 'number' || saved.mode === 'buyer' ? saved.mode : FEED_VIEW_DEFAULT.mode,
    buyerSort: saved.buyerSort === 'name' || saved.buyerSort === 'recent' ? saved.buyerSort : FEED_VIEW_DEFAULT.buyerSort,
    numberSort: saved.numberSort === 'recent' || saved.numberSort === 'number' ? saved.numberSort : FEED_VIEW_DEFAULT.numberSort,
    size: saved.size === 'small' || saved.size === 'large' ? saved.size : FEED_VIEW_DEFAULT.size,
  }
}

const same = (a: FeedView, b: FeedView): boolean => a.mode === b.mode && a.buyerSort === b.buyerSort && a.numberSort === b.numberSort && a.size === b.size

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
