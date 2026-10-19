// 화면 주소 (AC-S05-01, AC-S06-01, D-094):
//   `/` 방송 목록(홈) · `/broadcasts/<방송 ID>` 그 방송의 콘솔 · `/sms` 문자찜 입력
//   `/buyers` 구매자 · `/settlements` 정산 — 고른 날짜·리허설·구매자는 검색값(`?date=2026-10-18&rehearsal=true&buyer=UC_A`)
// 전화번호·메모·사유는 주소에 넣지 않는다(AC-S06-81). 새로고침·북마크해도 같은 화면이다.
import { useCallback, useEffect, useRef, useState } from 'react'

export type ScopeRouteName = 'buyers' | 'settlements'

export interface ScopeRoute {
  readonly name: ScopeRouteName
  /** 고른 날짜 (없으면 화면이 기본 날짜를 고른다) */
  readonly date?: string
  readonly rehearsal: boolean
  /** 자세히를 연 구매자 (지금의 구매자 ID) */
  readonly buyer?: string
}

export type Route = { readonly name: 'home' } | { readonly name: 'console'; readonly id: string } | { readonly name: 'sms' } | ScopeRoute

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function scopeRoute(name: ScopeRouteName, search: string): ScopeRoute {
  const params = new URLSearchParams(search)
  const date = params.get('date')
  const buyer = params.get('buyer')
  return {
    name,
    ...(date !== null && DATE_RE.test(date) ? { date } : {}),
    rehearsal: params.get('rehearsal') === 'true',
    ...(buyer !== null && buyer !== '' ? { buyer } : {}),
  }
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
    case 'buyers':
    case 'settlements': {
      const params = new URLSearchParams()
      if (route.date !== undefined) params.set('date', route.date)
      if (route.rehearsal) params.set('rehearsal', 'true')
      if (route.buyer !== undefined) params.set('buyer', route.buyer)
      const query = params.toString()
      return query === '' ? `/${route.name}` : `/${route.name}?${query}`
    }
  }
}

/** 메뉴 항목 (AC-S06-01): 지금 화면이 어느 메뉴에 속하는지 */
export type MenuKey = 'broadcasts' | 'sms' | 'buyers' | 'settlements'

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
  }
}

export interface NavigateOptions {
  /** 기록을 남기지 않고 지금 주소를 바꾼다 (기본 날짜를 주소에 적을 때) */
  readonly replace?: boolean
}

export type Navigate = (route: Route, options?: NavigateOptions) => void

/**
 * 브라우저 뒤로·앞으로 가기(popstate)를 막을지: 참이면 화면을 바꾸지 않는다(주소는 이미 바뀐 채 — 앱이 떠날지 묻고,
 * "닫기"면 보던 주소를 다시 적고, "보내지 않고 떠나기"면 그 주소로 바꾼다, AC-S06-01·D-083)
 */
export type PopBlocker = (next: Route) => boolean

const currentRoute = (): Route => parseRoute(window.location.pathname, window.location.search)

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
      if (options.replace === true) window.history.replaceState(null, '', path)
      else window.history.pushState(null, '', path)
    }
    setRoute(next)
  }, [])
  return [route, navigate] as const
}
