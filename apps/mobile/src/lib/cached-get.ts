// 서버에서 받은 화면 자료를 기억해 두고 다시 올 때 바로 보인다 (D-UX4-77, 판매자 요청 2026-11-10 "다른 화면 갔다 오면 처음부터 다시 그려져요").
// 화면을 다시 열면 ① 기억해 둔 자료로 바로 그리고(불러오는 중 없음) ② 뒤에서 조용히 서버에 다시 묻고 ③ 달라진 것이 있을 때만 그 부분을 부드럽게 바꾼다.
// - 기억은 GET 경로 하나에 하나. 같은 경로를 여러 화면이 보면 새 자료가 오면 모두 같이 바뀐다.
// - 받은 자료가 전과 똑같으면(JSON이 같으면) 아무것도 바꾸지 않는다 — 화면이 다시 그려지지 않는다.
// - 뒤에서 다시 받다가 실패하면 보이던 자료를 그대로 둔다. 보일 자료가 하나도 없을 때만 오류를 돌려준다.
// - 로그아웃·로그인 풀림·다른 계정으로 들어오면 모두 지운다 — 다른 판매자의 자료가 보이지 않게(services.tsx).
// - 화면이 다시 보일 때(쌓인 화면에서 돌아옴) 다시 묻는 신호는 앱 뼈대가 화면마다 넣는다(ScreenFocusProvider).
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { LayoutAnimation, Platform } from 'react-native'
import { get, isApiError, type ApiError } from '../api/client.ts'

interface Entry {
  readonly value: unknown
  readonly json: string
  /** 이 자료를 만든 요청 순서 — 늦게 시작한 요청의 답이 먼저 온 답을 덮어도 되고, 그 반대는 안 된다 */
  readonly ticket: number
}

/** 기억해 둘 경로 수 — 넘으면 가장 오래 안 쓴 것부터 지운다 */
export const CACHE_LIMIT = 200

const cache = new Map<string, Entry>()
const listeners = new Map<string, Set<(entry: Entry) => void>>()
const inflight = new Map<string, Promise<Entry>>()
let tickets = 0
/** 지운 때의 순서 — 그 전에 시작한 요청의 답은 기억하지 않는다(로그아웃 전 요청이 뒤늦게 와도 남지 않게) */
let clearedAt = 0
let account: string | null = null

function nextTicket(): number {
  tickets += 1
  return tickets
}

function store(path: string, value: unknown, json: string, ticket: number): Entry {
  const old = cache.get(path)
  if (ticket <= clearedAt) return { value, json, ticket }
  if (old !== undefined && old.ticket > ticket) return old
  const entry: Entry = old !== undefined && old.json === json ? { value: old.value, json, ticket } : { value, json, ticket }
  cache.delete(path)
  cache.set(path, entry)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  for (const listener of listeners.get(path) ?? []) listener(entry)
  return entry
}

/** 기억해 둔 자료 (없으면 null) */
export function peekCached<T>(path: string | null): T | null {
  if (path === null) return null
  const entry = cache.get(path)
  return entry === undefined ? null : (entry.value as T)
}

/** 기억해 둔 자료를 바꾼다 (화면이 쓰기 뒤 스스로 고친 자료 — 다른 화면에도 같이 보인다) */
export function rememberCached<T>(path: string, value: T): void {
  store(path, value, JSON.stringify(value) ?? 'null', nextTicket())
}

/** 한 경로를 서버에서 새로 받아 기억한다. fresh가 아니면 이미 가는 같은 요청에 붙는다 */
export function fetchCached<T>(path: string, fresh = false): Promise<T> {
  const running = fresh ? undefined : inflight.get(path)
  const promise =
    running ??
    (() => {
      const ticket = nextTicket()
      const started = get<unknown>(path).then((value) => store(path, value, JSON.stringify(value) ?? 'null', ticket))
      inflight.set(path, started)
      const done = () => {
        if (inflight.get(path) === started) inflight.delete(path)
      }
      started.then(done, done)
      return started
    })()
  return promise.then((entry) => entry.value as T)
}

/** 모두 지운다 — 로그아웃·로그인 풀림·계정 바뀜 (시험마다도) */
export function clearCached(): void {
  cache.clear()
  inflight.clear()
  clearedAt = nextTicket()
}

/** 로그인한 계정을 알린다 — 전과 다른 계정이면 모두 지운다. null(로그아웃·로그인 풀림)이면 늘 지운다 */
export function setCachedAccount(id: string | null): void {
  if (id === null || id !== account) clearCached()
  account = id
}

/** 시험용: 지금 기억해 둔 경로 수 */
export function cachedCount(): number {
  return cache.size
}

/** 바뀐 자료를 넣기 전에 다음 그리기를 짧게 부드럽게 (네이티브만 — 웹·시험은 그대로) */
export const SWAP_MS = 220
function animateNext(): void {
  if (Platform.OS === 'web') return
  try {
    LayoutAnimation.configureNext({
      duration: SWAP_MS,
      // 자리 바꿈(update)은 움직이지 않는다 (D-UX4-85, 사용자 지시 2026-11-10 "스와이프해서 뒤로가기 하면 이전 화면이 오른쪽으로 오바해서 들썩"):
      // LayoutAnimation은 앱 전체 다음 그리기에 걸려, 뒤로 가기 넘김과 겹치면 화면 틀까지 미끄러졌다. 새로 생기고 없어지는 것만 옅게 나타나고 사라진다
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    })
  } catch {
    // 움직임을 못 걸어도 자료는 바꾼다
  }
}

// ── 화면이 다시 보일 때 ──

const FocusContext = createContext(0)

/** 다시 보인 뒤 넘김이 가라앉기를 기다리는 시간 (iOS·안드로이드 뒤로 가기 넘김 ≈ 350ms) */
export const FOCUS_SETTLE_MS = 500

interface FocusNavigation {
  readonly addListener: (event: 'focus' | 'blur', callback: () => void) => () => void
}

/** 화면 하나를 감싼다: 다른 화면에 가렸다가 다시 보이면 숫자를 올린다(처음 보일 때는 그대로) — useCachedGet이 이 숫자로 다시 묻는다 */
export function ScreenFocusProvider({ navigation, children }: { readonly navigation: FocusNavigation; readonly children: ReactNode }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let hidden = false
    const offBlur = navigation.addListener('blur', () => {
      hidden = true
    })
    let pending: ReturnType<typeof setTimeout> | undefined
    const offFocus = navigation.addListener('focus', () => {
      if (!hidden) return
      hidden = false
      // 넘김(밀어서 뒤로 가기)이 다 끝난 뒤에 다시 묻는다 (D-UX4-85) — 넘기는 동안 화면이 바뀌지 않게
      if (pending !== undefined) clearTimeout(pending)
      pending = setTimeout(() => setCount((n) => n + 1), FOCUS_SETTLE_MS)
    })
    return () => {
      offBlur()
      offFocus()
      if (pending !== undefined) clearTimeout(pending)
    }
  }, [navigation])
  return createElement(FocusContext.Provider, { value: count }, children)
}

/** 화면이 다시 보인 횟수 (앱 뼈대 밖·시험에서는 0) */
export function useScreenFocusCount(): number {
  return useContext(FocusContext)
}

// ── 화면에서 쓰는 꼴 ──

export interface Cached<T> {
  /** 보일 자료 — 기억해 둔 것이 있으면 처음부터 있다 */
  readonly data: T | null
  /** 보일 자료가 없을 때만 오류 (있으면 보이던 것을 그대로 둔다) */
  readonly error: ApiError | null
  /** 서버에 다시 묻는다 (쓰기 뒤 등) — 끝나면 풀린다. 실패해도 보이던 자료는 그대로 */
  readonly reload: () => Promise<void>
  /** 화면이 스스로 자료를 고친다 (기억도 같이) */
  readonly set: (next: T | ((old: T | null) => T)) => void
  /**
   * 이 화면이 열린 뒤 서버에 한 번 물어 답(또는 실패)을 받았는지 — 기억해 둔 자료만 보이는 동안은 false.
   * 읽는 화면만 이 값 때문에 한 번 더 그린다(읽지 않으면 그대로). 날짜처럼 "처음 정할 값"을 새 자료로 정할 때 쓴다
   */
  readonly checked: boolean
}

interface HookState<T> {
  readonly path: string | null
  readonly data: T | null
  readonly json: string | null
  readonly error: ApiError | null
}

function fromCache<T>(path: string | null): HookState<T> {
  const entry = path === null ? undefined : cache.get(path)
  return { path, data: entry === undefined ? null : (entry.value as T), json: entry === undefined ? null : entry.json, error: null }
}

/**
 * GET 경로 하나를 기억과 함께 받는다. path가 null이면 묻지 않는다.
 * refresh: 바뀌면 다시 묻는다(경로가 넘겨 주는 다시 받기 숫자 등). 화면이 처음 그려질 때·다시 보일 때도 묻는다.
 */
export function useCachedGet<T>(path: string | null, refresh: unknown = 0): Cached<T> {
  const [state, setState] = useState<HookState<T>>(() => fromCache<T>(path))
  let current = state
  if (state.path !== path) {
    // 경로가 바뀌면(날짜를 바꿈 등) 그 경로의 기억으로 바로 바꾼다
    current = fromCache<T>(path)
    setState(current)
  }
  const latest = useRef(current)
  latest.current = current
  const focus = useScreenFocusCount()

  // 같은 경로의 새 자료가 기억에 들어오면(이 화면이 받았든 다른 화면이 받았든) 달라졌을 때만 바꾼다
  useEffect(() => {
    if (path === null) return
    const listener = (entry: Entry) => {
      const shown = latest.current
      if (shown.path !== path) return
      if (shown.json === entry.json && shown.error === null) return
      if (shown.data !== null && shown.json !== entry.json) animateNext()
      const next: HookState<T> = { path, data: entry.value as T, json: entry.json, error: null }
      latest.current = next
      setState(next)
    }
    let set = listeners.get(path)
    if (set === undefined) {
      set = new Set()
      listeners.set(path, set)
    }
    set.add(listener)
    // 구독 전에 기억이 바뀌었으면 따라잡는다
    const entry = cache.get(path)
    if (entry !== undefined && entry.json !== latest.current.json) listener(entry)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(path)
    }
  }, [path])

  const failed = useCallback(
    (forPath: string, caught: unknown) => {
      const shown = latest.current
      if (shown.path !== forPath || shown.data !== null) return
      if (!isApiError(caught)) return
      const next: HookState<T> = { ...shown, error: caught }
      latest.current = next
      setState(next)
    },
    [],
  )

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // 물어 본 경로 — checked를 읽는 화면만 바뀔 때 다시 그린다
  const [checkedPath, setCheckedPath] = useState<string | null>(null)
  const wantsChecked = useRef(false)
  const checkedRef = useRef<string | null>(null)
  const markChecked = useCallback((forPath: string) => {
    if (!alive.current || checkedRef.current === forPath) return
    checkedRef.current = forPath
    if (wantsChecked.current) setCheckedPath(forPath)
  }, [])

  const run = useCallback(
    (forPath: string, fresh: boolean) =>
      fetchCached<T>(forPath, fresh).then(
        () => markChecked(forPath),
        (caught: unknown) => {
          if (alive.current) failed(forPath, caught)
          markChecked(forPath)
        },
      ),
    [failed, markChecked],
  )

  // 처음·경로가 바뀔 때·다시 보일 때는 이미 가는 같은 요청에 붙고, refresh가 바뀌면(쓰기 뒤 등) 새로 묻는다 — 쓰기 전에 떠난 요청의 답을 받지 않게
  const lastRefresh = useRef(refresh)
  useEffect(() => {
    if (path === null) return
    const fresh = !Object.is(lastRefresh.current, refresh)
    lastRefresh.current = refresh
    void run(path, fresh)
  }, [path, refresh, focus, run])

  const reload = useCallback(async () => {
    const forPath = latest.current.path
    if (forPath === null) return
    await run(forPath, true)
  }, [run])

  const setData = useCallback((next: T | ((old: T | null) => T)) => {
    const shown = latest.current
    if (shown.path === null) return
    const value = typeof next === 'function' ? (next as (old: T | null) => T)(shown.data) : next
    rememberCached(shown.path, value)
    // 기억에 넣으면 구독이 화면을 바꾼다 — 구독 전(경로가 막 바뀜)이면 여기서
    if (latest.current.data !== value && latest.current.json !== (JSON.stringify(value) ?? 'null')) {
      const updated: HookState<T> = { path: shown.path, data: value, json: JSON.stringify(value) ?? 'null', error: null }
      latest.current = updated
      setState(updated)
    }
  }, [])

  const result: Cached<T> = {
    data: current.data,
    error: current.data === null ? current.error : null,
    reload,
    set: setData,
    get checked() {
      wantsChecked.current = true
      return path !== null && (checkedPath === path || checkedRef.current === path)
    },
  }
  return result
}
