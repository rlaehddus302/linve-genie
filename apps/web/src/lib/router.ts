// 화면 주소 (AC-S05-01, AC-S06-01, D-094, AC-I3-44·50·77):
//   `/` 방송 목록(홈) · `/broadcasts/<방송 ID>` 그 방송의 콘솔 · `/sms` 문자찜 입력
//   `/buyers` 구매자 · `/settlements` 정산 — 고른 날짜·리허설·구매자는 검색값(`?date=2026-10-18&rehearsal=true&buyer=UC_A`)
//   `/settings` 설정 · `/settings/youtube` 설정의 유튜브 칸(구글에서 돌아오면 `?youtube=<결과>` — 화면이 보인 뒤 지운다)
//   `/start` 시작 마법사 · `/privacy` 개인정보처리방침(초안) · `/terms` 이용약관(초안) — 둘은 로그인 없이 열린다
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

export interface SettingsRoute {
  readonly name: 'settings'
  /** 열자마자 보이게 할 칸 */
  readonly section?: 'youtube'
  /** 구글에서 돌아온 결과 코드 (`?youtube=`) */
  readonly youtubeResult?: string
}

export interface StartRoute {
  readonly name: 'start'
  /** "시작 마법사 다시 하기": 상태와 상관없이 1단계부터 (주소에 적지 않는다) */
  readonly fresh?: boolean
  /** 마법사 4단계에서 구글로 갔다가 돌아온 결과 코드 (`?youtube=`) */
  readonly youtubeResult?: string
}

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'console'; readonly id: string }
  | { readonly name: 'sms' }
  | ScopeRoute
  | SettingsRoute
  | StartRoute
  | { readonly name: 'privacy' }
  | { readonly name: 'terms' }

/** 로그인 없이 여는 화면 (AC-I3-77) */
export const isPublicRoute = (route: Route): boolean => route.name === 'privacy' || route.name === 'terms'

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
  const youtube = new URLSearchParams(search).get('youtube')
  const result = youtube !== null && youtube !== '' ? { youtubeResult: youtube } : {}
  if (path === '/settings') return { name: 'settings', ...result }
  if (path === '/settings/youtube') return { name: 'settings', section: 'youtube', ...result }
  if (path === '/start') return { name: 'start', ...result }
  if (path === '/privacy') return { name: 'privacy' }
  if (path === '/terms') return { name: 'terms' }
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
    case 'settings': {
      const base = route.section === 'youtube' ? '/settings/youtube' : '/settings'
      return route.youtubeResult === undefined ? base : `${base}?${new URLSearchParams({ youtube: route.youtubeResult }).toString()}`
    }
    case 'start':
      return route.youtubeResult === undefined ? '/start' : `/start?${new URLSearchParams({ youtube: route.youtubeResult }).toString()}`
    case 'privacy':
      return '/privacy'
    case 'terms':
      return '/terms'
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

/** 메뉴 항목 (AC-S06-01, AC-I3-44): 지금 화면이 어느 메뉴에 속하는지 */
export type MenuKey = 'broadcasts' | 'sms' | 'buyers' | 'settlements' | 'settings'

/** 메뉴에 없는 화면(시작 마법사·정책 페이지)은 null */
export function menuOf(route: Route): MenuKey | null {
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
    case 'settings':
      return 'settings'
    case 'start':
    case 'privacy':
    case 'terms':
      return null
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
