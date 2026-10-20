// 화면 주소 (AC-S05-01, AC-S06-01, D-094):
//   `/` 방송 목록(홈) · `/broadcasts/<방송 ID>` 그 방송의 콘솔 · `/sms` 문자찜 입력
//   `/buyers` 구매자 · `/settlements` 정산 — 고른 날짜·리허설·구매자는 검색값(`?date=2026-10-18&rehearsal=true&buyer=UC_A`)
//   구매자 자세히의 합치기 창: 상대·방향은 `merge`(상대 구매자 ID)·`into`(남는 쪽 구매자 ID), 막힘에서 연 상품 자세히는 `product`(상품 키)
//   — 상품 자세히에 갔다 와도(브라우저 뒤로 가기 포함) 같은 합치기 창이 다시 열린다 (AC-S06b-34, D-102).
//   `/labels` 라벨(프린터·출력 대기열·버릴 라벨·출력 이력·라벨 설정·내보내기, I1 AC-I1-20)
//   `/settings` 설정(지금은 "라벨" 절 — 라벨 기능 켜기/끄기·바꾼 기록, N4a AC-N4a-10. 판매 규칙 등은 I3이 절을 더한다)
// 전화번호·메모·사유는 주소에 넣지 않는다(AC-S06-81) — 구매자 ID·상품 키만. 새로고침·북마크해도 같은 화면이다.
import { useCallback, useEffect, useRef, useState } from 'react'

export type ScopeRouteName = 'buyers' | 'settlements'

export interface ScopeRoute {
  readonly name: ScopeRouteName
  /** 고른 날짜 (없으면 화면이 기본 날짜를 고른다) */
  readonly date?: string
  readonly rehearsal: boolean
  /** 자세히를 연 구매자 (지금의 구매자 ID) */
  readonly buyer?: string
  /** 합치기 창의 상대 구매자 ID (구매자 화면) */
  readonly merge?: string
  /** 합치기 창의 남는 쪽 구매자 ID */
  readonly into?: string
  /** 합치기 막힘에서 연 상품 자세히 (상품 키 `<방송>/<번호>`) */
  readonly product?: string
}

const SCOPE_PARAMS = ['buyer', 'merge', 'into', 'product'] as const

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'console'; readonly id: string }
  | { readonly name: 'sms' }
  | { readonly name: 'labels' }
  | { readonly name: 'settings' }
  | ScopeRoute

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function scopeRoute(name: ScopeRouteName, search: string): ScopeRoute {
  const params = new URLSearchParams(search)
  const date = params.get('date')
  const out: { -readonly [K in keyof ScopeRoute]: ScopeRoute[K] } = {
    name,
    ...(date !== null && DATE_RE.test(date) ? { date } : {}),
    rehearsal: params.get('rehearsal') === 'true',
  }
  for (const key of SCOPE_PARAMS) {
    const value = params.get(key)
    if (value !== null && value !== '') out[key] = value
  }
  return out
}

export function parseRoute(pathname: string, search = ''): Route {
  const m = /^\/broadcasts\/([^/]+)\/?$/.exec(pathname)
  if (m?.[1] !== undefined) {
    try {
      return { name: 'console', id: decodeURIComponent(m[1]) }
    } catch {
      return { name: 'home' }
    }
  }
  const path = pathname.replace(/\/+$/, '')
  if (path === '/sms') return { name: 'sms' }
  if (path === '/labels') return { name: 'labels' }
  if (path === '/settings') return { name: 'settings' }
  if (path === '/buyers') return scopeRoute('buyers', search)
  if (path === '/settlements') return scopeRoute('settlements', search)
  return { name: 'home' }
}

export function routePath(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/'
    case 'console':
      return `/broadcasts/${encodeURIComponent(route.id)}`
    case 'sms':
      return '/sms'
    case 'labels':
      return '/labels'
    case 'settings':
      return '/settings'
    case 'buyers':
    case 'settlements': {
      const params = new URLSearchParams()
      if (route.date !== undefined) params.set('date', route.date)
      if (route.rehearsal) params.set('rehearsal', 'true')
      for (const key of SCOPE_PARAMS) {
        const value = route[key]
        if (value !== undefined) params.set(key, value)
      }
      const query = params.toString()
      return query === '' ? `/${route.name}` : `/${route.name}?${query}`
    }
  }
}

/** 메뉴 항목 (AC-S06-01): 지금 화면이 어느 메뉴에 속하는지. 설정은 메뉴가 아니라 위 줄 오른쪽 "설정" 링크다(AC-N4a-10) */
export type MenuKey = 'broadcasts' | 'sms' | 'buyers' | 'settlements' | 'labels' | 'settings'

export function menuOf(route: Route): MenuKey {
  switch (route.name) {
    case 'home':
    case 'console':
      return 'broadcasts'
    case 'sms':
      return 'sms'
    case 'buyers':
      return 'buyers'
    case 'settlements':
      return 'settlements'
    case 'labels':
      return 'labels'
    case 'settings':
      return 'settings'
  }
}

export interface NavigateOptions {
  /** 기록을 남기지 않고 지금 주소를 바꾼다 (기본 날짜를 주소에 적을 때) */
  readonly replace?: boolean
  /**
   * 같은 화면 안에서 창을 여는 이동 (합치기 창의 상대 고르기·막힘에서 상품 자세히, AC-S06b-34): 기록을 남겨 뒤로 가기로 돌아오지만
   * 화면을 떠나는 것이 아니라 떠나기 확인을 묻지 않는다
   */
  readonly stay?: boolean
}

export type Navigate = (route: Route, options?: NavigateOptions) => void

/**
 * 브라우저 뒤로·앞으로 가기(popstate)를 막을지: 참이면 화면을 바꾸지 않는다(주소는 이미 바뀐 채 — 앱이 떠날지 묻고,
 * "닫기"면 보던 주소를 다시 적고, "보내지 않고 떠나기"면 그 주소로 바꾼다, AC-S06-01·D-083)
 */
export type PopBlocker = (next: Route) => boolean

const currentRoute = (): Route => parseRoute(window.location.pathname, window.location.search)

function stateRecord(): Record<string, unknown> {
  const state: unknown = window.history.state
  return typeof state === 'object' && state !== null && !Array.isArray(state) ? (state as Record<string, unknown>) : {}
}

/**
 * 앱 안 기록의 깊이: 처음 연 기록(홈 화면 앱으로 연 첫 화면·새 탭)은 0, 앱이 쌓은 기록마다 하나씩 (history.state에 적는다).
 * 0이면 앱 안에서 뒤로 갈 기록이 없다 — 뒤로 가기가 앱을 떠난다 (D-103).
 */
export function historyDepth(): number {
  const depth = stateRecord().livejjimDepth
  return typeof depth === 'number' && Number.isInteger(depth) && depth >= 0 ? depth : 0
}

/** 지금 기록이 떠나기 확인용으로 더 쌓은 같은 주소의 기록인가 */
export function isGuardEntry(): boolean {
  return stateRecord().livejjimGuard === true
}

/**
 * 처음 연 화면에 보내기 전인 조치가 있을 때 같은 주소의 기록을 하나 더 쌓는다 (AC-S06b-43, D-103):
 * 뒤로 가기가 앱을 떠나지 않고 이 기록을 빼며(popstate) 앱이 떠날지 묻는다.
 */
export function pushGuardEntry(): void {
  window.history.pushState({ livejjimDepth: historyDepth(), livejjimGuard: true }, '', `${window.location.pathname}${window.location.search}`)
}

export function useRoute(blocker?: PopBlocker): readonly [Route, Navigate] {
  const [route, setRoute] = useState<Route>(currentRoute)
  const block = useRef(blocker)
  block.current = blocker
  useEffect(() => {
    const onPop = () => {
      const next = currentRoute()
      if (block.current?.(next) === true) return
      setRoute(next)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback<Navigate>((next, options = {}) => {
    const path = routePath(next)
    if (`${window.location.pathname}${window.location.search}` !== path) {
      if (options.replace === true) window.history.replaceState(window.history.state, '', path)
      else window.history.pushState({ livejjimDepth: historyDepth() + 1 }, '', path)
    }
    setRoute(next)
  }, [])
  return [route, navigate] as const
}
