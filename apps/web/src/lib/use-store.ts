// 화면이 열린 동안 범위 자료 저장소 하나를 열고(SSE 구독·증분 조회), 화면이 내려가면 닫는다 (AC-S06-40).
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ConsoleStore, LOADING_SNAPSHOT, type ConsoleSnapshot, type ConsoleStoreOptions } from './console-store.ts'

const noop = () => () => {}
const loading = () => LOADING_SNAPSHOT

/**
 * key가 바뀌면 새 저장소를 연다(key가 null이면 열지 않는다). options는 key와 함께 바뀌어야 한다.
 *
 * 저장소는 그것을 연 key와 함께 둔다. key가 바뀐 바로 그 그림(효과가 새 저장소를 열기 전)에는 옛 key의 저장소를
 * 돌려주지 않고 "불러오는 중"을 돌려준다 — 옛 방송 자료로 새 방송의 입력 칸이 잠깐 열렸다가(판매자가 그새 치면)
 * 새 저장소가 열리며 칸이 다시 그려져 친 글이 사라지거나, 옛 방송 저장소로 보내지는 일을 막는다 (QL2, AC-S06-51).
 */
export function useScopeStore(key: string | null, options: () => ConsoleStoreOptions): { readonly store: ConsoleStore | null; readonly snapshot: ConsoleSnapshot } {
  const [opened, setOpened] = useState<{ readonly key: string; readonly store: ConsoleStore } | null>(null)
  useEffect(() => {
    if (key === null) {
      setOpened(null)
      return
    }
    const next = new ConsoleStore(options())
    setOpened({ key, store: next })
    void next.start()
    return () => next.stop()
    // options는 key로 정해진다
  }, [key])
  const store = key !== null && opened !== null && opened.key === key ? opened.store : null
  const snapshot = useSyncExternalStore(store?.subscribe ?? noop, store?.getSnapshot ?? loading)
  return { store, snapshot: store === null ? LOADING_SNAPSHOT : snapshot }
}
