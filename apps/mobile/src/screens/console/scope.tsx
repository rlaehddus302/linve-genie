// 방송 하나의 범위 자료를 여러 화면이 함께 쓴다 (D-UX4-57, 사용자 지시 2026-11-09 "창 안에 창은 왜 다른 식으로 처리가 되어있어?"):
// 방송 화면 위에 진짜 쌓인 화면(상품 추가·방송 관리)을 올려도 같은 저장소(실시간 연결·따라잡기)를 쓴다 — 새로 받지 않는다.
// 처음 붙는 화면이 "방송 화면에 들어왔다" 기록을 보내고 시작하며, 마지막 화면이 떨어지면 멈춘다.
import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { BroadcastItem, WriteResult } from '@livejjim/web/src/api/types.ts'
import { ApiError, isApiError, newRequestId, post, withQuery, withRetry } from '../../api/client.ts'
import { peekCached, rememberCached } from '../../lib/cached-get.ts'
import { BuyerNames } from '../../lib/derive.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { ScopeStore, type ScopeSnapshot } from '../../lib/scope-store.ts'
import { useServices, type Services } from '../../services.tsx'
import { ConsoleContext, type ConsoleApi } from './context.ts'

interface Shared {
  readonly store: ScopeStore
  users: number
}
const registry = new WeakMap<Services, Map<string, Shared>>()

/**
 * 방송 화면을 다시 열 때 (D-UX4-83, 사용자 지시 2026-11-10 "찰나의 순간에 다시 연결하는 중… 로딩 아이콘이랑 불러오는 중 보이지. ux에 별로"):
 * 마지막으로 본 방송·자료를 화면 자료 기억(D-UX4-77 — 로그아웃·계정 바뀜이면 지운다)에 두었다가 그것으로 바로 그리고, 뒤에서 새로 받는다.
 */
export const scopeMemoryKey = (broadcastId: string): string => `app:console-scope:${broadcastId}`
type ScopeMemory = { readonly broadcast: BroadcastItem; readonly data: ScopeData }

function sharedFor(services: Services, broadcastId: string): Shared {
  let byId = registry.get(services)
  if (byId === undefined) {
    byId = new Map()
    registry.set(services, byId)
  }
  let shared = byId.get(broadcastId)
  if (shared === undefined) {
    shared = { store: new ScopeStore({ broadcastId, openStream: () => services.stream.open(), seed: peekCached<ScopeMemory>(scopeMemoryKey(broadcastId)) }), users: 0 }
    byId.set(broadcastId, shared)
  }
  return shared
}

/** 이 방송의 범위 자료 (같은 방송을 보는 화면끼리 하나를 나눠 쓴다) */
export function useScopeStore(broadcastId: string): { store: ScopeStore; snapshot: ScopeSnapshot } {
  const services = useServices()
  const shared = useMemo(() => sharedFor(services, broadcastId), [broadcastId, services])
  const store = shared.store
  // 방송 화면에 들어왔다는 기록을 먼저 끝낸 뒤 방송 목록을 받는다 (D-UX3-25 고침): 새 방송 단계에서 만든 방송은 이 기록 전에는 목록에 없어,
  // 둘을 함께 보내면 목록이 먼저 와 "그 방송을 찾지 못했어요"가 떴다(라벨 [괜찮아요]로 바로 넘어올 때). 기록이 실패해도 그대로 불러온다.
  useEffect(() => {
    shared.users += 1
    let live = true
    if (shared.users === 1) {
      void withRetry(() => post(`/api/broadcasts/${encodeURIComponent(broadcastId)}/open`, {}))
        .catch(() => undefined)
        .then(() => {
          if (live) void store.start()
        })
    }
    return () => {
      live = false
      shared.users -= 1
      if (shared.users === 0) {
        // 다음에 다시 열 때 바로 그릴 자료로 남긴다
        const last = store.getSnapshot()
        if (last.phase === 'ready' && last.broadcast !== null && last.data !== null) rememberCached<ScopeMemory>(scopeMemoryKey(broadcastId), { broadcast: last.broadcast, data: last.data })
        store.stop()
        registry.get(services)?.delete(broadcastId)
      }
    }
  }, [shared, store, broadcastId, services])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return { store, snapshot }
}

/** 쓰기: 요청 번호를 붙여 /api/events로 보내고 응답 seq까지 따라잡는다 */
export function useScopeCommand(store: ScopeStore): ConsoleApi['command'] {
  return useCallback(
    async (event: Readonly<Record<string, unknown>>, requestId: string = newRequestId()): Promise<WriteResult> => {
      const current = store.getSnapshot()
      if (current.data === null) throw new ApiError({ status: 0, code: 'NOT_READY', message: '아직 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요.' })
      if (current.data.sealed) throw new ApiError({ status: 409, code: 'SEALED', message: '30일이 지난 라이브 기록은 봉인되어 고칠 수 없어요.' })
      let result: WriteResult
      try {
        result = await withRetry(() => post<WriteResult>(withQuery('/api/events', typeof event.b === 'string' ? {} : { date: current.data!.date, rehearsal: current.data!.rehearsal }), { requestId, ...event }))
      } catch (error) {
        if (isApiError(error) && error.code === 'PROCESSING_FAILED') void store.catchUp()
        throw error
      }
      await store.sync(result.seq)
      return result
    },
    [store],
  )
}

const NO_WORDS: ReadonlyMap<string, string> = new Map()

export interface ScopeReady {
  readonly snapshot: ScopeSnapshot
  readonly store: ScopeStore
  readonly broadcast: NonNullable<ScopeSnapshot['broadcast']>
}

/**
 * 방송 화면 위에 쌓인 화면이 쓰는 콘솔 값: 같은 범위 자료로 ConsoleContext를 채운다. 아직 못 받았으면 waiting을 그린다.
 */
export function ScopeConsole({ broadcastId, waiting, children }: { readonly broadcastId: string; readonly waiting: ReactNode; readonly children: (ready: ScopeReady) => ReactNode }) {
  const { store, snapshot } = useScopeStore(broadcastId)
  const command = useScopeCommand(store)
  const data = snapshot.data
  const { labels } = useServices()
  const hideSuffix = useSyncExternalStore(labels.subscribe, labels.getSnapshot).queue?.hideNicknameSuffix === true
  const names = useMemo(() => (data === null ? null : new BuyerNames(data.buyers, data.claims, hideSuffix)), [data, hideSuffix])
  const broadcast = snapshot.broadcast
  if (data === null || names === null || broadcast === null) return <>{waiting}</>
  const api: ConsoleApi = { b: broadcastId, data, names, ended: broadcast.ended, sealed: data.sealed, command, sync: (seq) => store.sync(seq), latest: () => store.getSnapshot().data ?? data, select: () => {}, selected: null, labelWords: NO_WORDS }
  return <ConsoleContext.Provider value={api}>{children({ snapshot, store, broadcast })}</ConsoleContext.Provider>
}

/**
 * 쌓인 화면 → 방송 화면 알림 (같은 방송끼리만): 상품을 추가했다(added) → 방송 화면이 그 상품을 강조한다.
 * 이미 있는 번호의 [그 상품 보기](show, D-RETRO-22) → 방송 화면이 그 줄로 가서 자세히를 연다
 */
export type ConsoleSignal = { readonly kind: 'added' | 'show'; readonly key: string }
const listeners = new Map<string, Set<(signal: ConsoleSignal) => void>>()

export function signalConsole(broadcastId: string, signal: ConsoleSignal): void {
  for (const listener of listeners.get(broadcastId) ?? []) listener(signal)
}

export function useConsoleSignals(broadcastId: string, onSignal: (signal: ConsoleSignal) => void): void {
  useEffect(() => {
    let set = listeners.get(broadcastId)
    if (set === undefined) {
      set = new Set()
      listeners.set(broadcastId, set)
    }
    set.add(onSignal)
    return () => {
      set.delete(onSignal)
    }
  }, [broadcastId, onSignal])
}
