// 화면이 열린 동안 범위 자료 저장소 하나를 열고(SSE 구독·증분 조회), 화면이 내려가면 닫는다 (AC-S06-40).
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ConsoleStore, LOADING_SNAPSHOT, type ConsoleSnapshot, type ConsoleStoreOptions } from './console-store.ts'

const noop = () => () => {}
const loading = () => LOADING_SNAPSHOT

/**
 * key가 바뀌면 새 저장소를 연다(key가 null이면 열지 않는다). options는 key와 함께 바뀌어야 한다.
 */
export function useScopeStore(key: string | null, options: () => ConsoleStoreOptions): { readonly store: ConsoleStore | null; readonly snapshot: ConsoleSnapshot } {
  const [store, setStore] = useState<ConsoleStore | null>(null)
  useEffect(() => {
    if (key === null) {
      setStore(null)
      return
    }
    const next = new ConsoleStore(options())
    setStore(next)
    void next.start()
    return () => next.stop()
    // options는 key로 정해진다
  }, [key])
  const snapshot = useSyncExternalStore(store?.subscribe ?? noop, store?.getSnapshot ?? loading)
  return { store: key === null ? null : store, snapshot: key === null ? LOADING_SNAPSHOT : snapshot }
}
