// 화면 주소: `/` 방송 목록(홈), `/broadcasts/<방송 ID>` 그 방송의 콘솔.
import { useCallback, useEffect, useState } from 'react'

export type Route = { readonly name: 'home' } | { readonly name: 'console'; readonly id: string }

export function parseRoute(pathname: string): Route {
  const m = /^\/broadcasts\/([^/]+)\/?$/.exec(pathname)
  if (m?.[1] !== undefined) {
    try {
      return { name: 'console', id: decodeURIComponent(m[1]) }
    } catch {
      return { name: 'home' }
    }
  }
  return { name: 'home' }
}

export function routePath(route: Route): string {
  return route.name === 'console' ? `/broadcasts/${encodeURIComponent(route.id)}` : '/'
}

export function useRoute(): readonly [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname))
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((next: Route) => {
    const path = routePath(next)
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
    setRoute(next)
  }, [])
  return [route, navigate] as const
}
