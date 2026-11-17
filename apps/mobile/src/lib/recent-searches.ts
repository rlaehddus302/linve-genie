// 라이브 찾기 화면의 최근 검색어 (D-SEARCH-RECENT-01, 사용자 지시 2026-11-17 토스 검색 사진 "사진1 참고해서 최근 검색어도 보여주자."):
// 찾기 칸에서 [검색](키보드)을 누르거나 결과를 눌러 열면 그 글을 맨 앞에 남긴다(같은 글은 앞으로 옮김, 많아야 10개).
// 이 휴대폰에만 둔다(앱 저장소 — 서버로 보내지 않는다, 찜 기록 정렬 feed-view와 같은 방법).
import { useSyncExternalStore } from 'react'

export const RECENT_SEARCHES_KEY = 'livejjim.console.recentSearches'
/** 남기는 가장 많은 수 */
export const RECENT_SEARCHES_MAX = 10
/** 한 검색어의 가장 긴 글자 수 (붙여 넣은 긴 글이 쌓이지 않게) */
export const RECENT_SEARCH_LENGTH = 40

/** 앱 저장소에서 쓰는 부분 (AsyncStorage) */
export interface RecentSearchStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

const EMPTY: readonly string[] = []
let current: readonly string[] = EMPTY
let storage: RecentSearchStorage | null = null
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

/** 남길 꼴: 앞뒤 빈칸을 떼고 사이 빈칸은 하나로 */
export const cleanSearch = (text: string): string => text.normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, RECENT_SEARCH_LENGTH)

/** 저장한 글 → 목록. 깨진 값·글이 아닌 것은 버린다 (옛 앱·깨진 값이어도 화면이 뜬다) */
export function parseRecentSearches(raw: string | null): readonly string[] {
  if (raw === null) return EMPTY
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return EMPTY
  }
  if (!Array.isArray(value)) return EMPTY
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = cleanSearch(item)
    if (text !== '' && !out.includes(text)) out.push(text)
    if (out.length === RECENT_SEARCHES_MAX) break
  }
  return out
}

/** 검색어 하나를 맨 앞에 더한 목록 (같은 글은 앞으로, 많아야 10개) */
export function withRecentSearch(list: readonly string[], text: string): readonly string[] {
  const clean = cleanSearch(text)
  if (clean === '') return list
  return [clean, ...list.filter((item) => item !== clean)].slice(0, RECENT_SEARCHES_MAX)
}

const write = (next: readonly string[]): void => {
  if (next === current || (next.length === current.length && next.every((item, index) => item === current[index]))) return
  current = next
  notify()
  void storage?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)).catch(() => undefined)
}

export const getRecentSearches = (): readonly string[] => current

export function subscribeRecentSearches(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 검색어를 남긴다 — 바로 화면에 반영하고 저장소에 쓴다(실패해도 화면은 그대로) */
export function addRecentSearch(text: string): void {
  write(withRecentSearch(current, text))
}

/** [전체 삭제] */
export function clearRecentSearches(): void {
  write(EMPTY)
}

/** 앱을 켤 때 한 번: 저장한 목록을 되살린다. 그 사이 남긴 것은 앞에 둔다. 저장소가 실패해도 빈 목록으로 간다 */
export async function wireRecentSearches(store: RecentSearchStorage): Promise<void> {
  storage = store
  try {
    const saved = parseRecentSearches(await store.getItem(RECENT_SEARCHES_KEY))
    const merged = current.reduceRight((list, text) => withRecentSearch(list, text), saved)
    if (merged.length > 0 || current.length > 0) write(merged)
  } catch {
    // 못 읽으면 빈 목록
  }
}

/** 시험용: 처음 상태로 */
export function resetRecentSearches(): void {
  current = EMPTY
  storage = null
  notify()
}

/** 지금 최근 검색어 (최근 것부터) */
export const useRecentSearches = (): readonly string[] => useSyncExternalStore(subscribeRecentSearches, getRecentSearches, getRecentSearches)
