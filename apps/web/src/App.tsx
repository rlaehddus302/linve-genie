// 앱 (AC-S05-01·02): 로그인 확인 → 방송 목록(홈) / 그 방송의 라이브 콘솔.
// 쓰는 중에 세션이 끝나면(어떤 API든 401) 로그인 화면으로 가고, 다시 로그인하면 보던 화면(주소 그대로)으로 돌아간다.
// 그때 콘솔이 닫히며 5초 대기 중이던 방송자 조치는 보내지 않는다(D-083).
import { useCallback, useEffect, useState } from 'react'
import { get, isApiError, onUnauthorized, post, type ApiError } from './api/client.ts'
import type { Me } from './api/types.ts'
import { ConsolePage } from './components/ConsolePage.tsx'
import { ErrorNote } from './components/ErrorNote.tsx'
import { HomePage } from './components/HomePage.tsx'
import { LoginPage } from './components/LoginPage.tsx'
import { useRoute } from './lib/router.ts'

type Session = { readonly state: 'checking' } | { readonly state: 'out'; readonly expired: boolean } | { readonly state: 'in'; readonly me: Me }

export function App() {
  const [route, navigate] = useRoute()
  const [session, setSession] = useState<Session>({ state: 'checking' })
  const [checkError, setCheckError] = useState<ApiError | null>(null)
  const [logoutError, setLogoutError] = useState<ApiError | null>(null)

  const check = useCallback(async () => {
    setCheckError(null)
    try {
      setSession({ state: 'in', me: await get<Me>('/api/me') })
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.status === 401) setSession({ state: 'out', expired: false })
      else setCheckError(error)
    }
  }, [])

  useEffect(() => {
    // 처음 확인(/api/me)의 401은 아직 로그인하지 않은 것 — 그 뒤의 401은 세션이 끝난 것
    let ready = false
    onUnauthorized(() => {
      if (ready) setSession({ state: 'out', expired: true })
    })
    void check().finally(() => {
      ready = true
    })
    return () => onUnauthorized(null)
  }, [check])

  const logout = useCallback(async () => {
    setLogoutError(null)
    try {
      await post('/api/logout', {})
      setSession({ state: 'out', expired: false })
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.status === 401) setSession({ state: 'out', expired: false })
      else setLogoutError(error)
    }
  }, [])

  if (session.state === 'checking') {
    return (
      <main className="page">
        <h1>라이브찜</h1>
        {checkError === null ? <p>불러오는 중…</p> : <ErrorNote error={checkError} onRetry={() => void check()} retryLabel="다시 시도" />}
      </main>
    )
  }
  if (session.state === 'out') {
    return <LoginPage expired={session.expired} onLoggedIn={(me) => setSession({ state: 'in', me })} />
  }
  const shopName = session.me.seller.name
  return (
    <>
      {logoutError !== null ? <ErrorNote error={logoutError} /> : null}
      {route.name === 'console' ? (
        <ConsolePage key={route.id} broadcastId={route.id} shopName={shopName} onLogout={() => void logout()} navigate={navigate} />
      ) : (
        <HomePage shopName={shopName} onLogout={() => void logout()} navigate={navigate} />
      )}
    </>
  )
}
