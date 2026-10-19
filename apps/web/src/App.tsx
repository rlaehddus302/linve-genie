// 앱 (AC-S05-01·02, AC-S06-01): 로그인 확인 → 메뉴(방송·문자찜 입력·구매자·정산)와 그 화면.
// 쓰는 중에 세션이 끝나면(어떤 API든 401) 로그인 화면으로 가고, 다시 로그인하면 보던 화면(주소·검색값 그대로)으로 돌아간다.
// 그때 화면이 닫히며 5초 대기 중이던 방송자 조치는 보내지 않는다(D-083). 메뉴로 다른 화면에 갈 때 대기 중인 조치가 있으면 먼저 묻는다.
// 인터넷이 끊긴 채 열면(서비스 워커가 저장한 껍데기) "인터넷 연결이 없어요. 연결되면 다시 불러와요." — 연결되면 저절로 다시 불러온다(D-093).
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, onUnauthorized, post, type ApiError } from './api/client.ts'
import type { Me } from './api/types.ts'
import { BuyersPage } from './components/BuyersPage.tsx'
import { ConsolePage } from './components/ConsolePage.tsx'
import { ErrorNote } from './components/ErrorNote.tsx'
import { HomePage } from './components/HomePage.tsx'
import { LoginPage } from './components/LoginPage.tsx'
import { Modal } from './components/Modal.tsx'
import { SettlementsPage } from './components/SettlementsPage.tsx'
import { SmsPage } from './components/SmsPage.tsx'
import { TopBar } from './components/TopBar.tsx'
import { LEAVE_QUESTION, LeaveGuardContext, type LeaveCheck } from './lib/leave-guard.ts'
import { useRoute, type Navigate, type NavigateOptions, type Route } from './lib/router.ts'

type Session = { readonly state: 'checking' } | { readonly state: 'out'; readonly expired: boolean } | { readonly state: 'in'; readonly me: Me }

export const OFFLINE_MESSAGE = '인터넷 연결이 없어요. 연결되면 다시 불러와요.'
/** 인터넷이 없을 때 다시 확인하는 간격 */
const OFFLINE_RETRY_MS = 5000

export function App() {
  const [route, go] = useRoute()
  const [session, setSession] = useState<Session>({ state: 'checking' })
  const [checkError, setCheckError] = useState<ApiError | null>(null)
  const [logoutError, setLogoutError] = useState<ApiError | null>(null)
  const guard = useRef<LeaveCheck | null>(null)
  const [leaving, setLeaving] = useState<{ route: Route; options: NavigateOptions } | null>(null)

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

  // 인터넷이 끊겨 확인하지 못했으면 연결되는 대로 다시 확인한다 (브라우저의 online 알림, 그리고 5초마다)
  useEffect(() => {
    if (checkError === null || !checkError.network) return
    const online = () => void check()
    window.addEventListener('online', online)
    const timer = setInterval(online, OFFLINE_RETRY_MS)
    return () => {
      window.removeEventListener('online', online)
      clearInterval(timer)
    }
  }, [checkError, check])

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

  const register = useCallback((next: LeaveCheck | null) => {
    guard.current = next
  }, [])

  /** 메뉴·링크로 화면 이동: 5초 대기 중인 조치가 있으면 먼저 묻는다 (D-083) */
  const navigate = useCallback<Navigate>(
    (next, options = {}) => {
      if (guard.current?.() === true && options.replace !== true) {
        setLeaving({ route: next, options })
        return
      }
      go(next, options)
    },
    [go],
  )

  if (session.state === 'checking') {
    return (
      <main className="page">
        <h1>라이브찜</h1>
        {checkError === null ? (
          <p>불러오는 중…</p>
        ) : checkError.network ? (
          <div className="notice stack-tight" role="alert">
            <p>{OFFLINE_MESSAGE}</p>
            <button type="button" className="button" onClick={() => void check()}>
              다시 시도
            </button>
          </div>
        ) : (
          <ErrorNote error={checkError} onRetry={() => void check()} retryLabel="다시 시도" />
        )}
      </main>
    )
  }
  if (session.state === 'out') {
    return <LoginPage expired={session.expired} onLoggedIn={(me) => setSession({ state: 'in', me })} />
  }
  const shopName = session.me.seller.name
  return (
    <LeaveGuardContext.Provider value={register}>
      <TopBar shopName={shopName} onLogout={() => void logout()} route={route} navigate={navigate} />
      {logoutError !== null ? <ErrorNote error={logoutError} /> : null}
      <Screen route={route} navigate={navigate} />
      {leaving !== null ? (
        <Modal
          title="다른 화면으로 갈까요?"
          onClose={() => setLeaving(null)}
          actions={
            <button
              type="button"
              className="button button-danger"
              onClick={() => {
                const target = leaving
                setLeaving(null)
                guard.current = null
                go(target.route, target.options)
              }}
            >
              보내지 않고 떠나기
            </button>
          }
        >
          <p>{LEAVE_QUESTION}</p>
        </Modal>
      ) : null}
    </LeaveGuardContext.Provider>
  )
}

function Screen({ route, navigate }: { readonly route: Route; readonly navigate: Navigate }) {
  switch (route.name) {
    case 'console':
      return <ConsolePage key={route.id} broadcastId={route.id} navigate={navigate} />
    case 'sms':
      return <SmsPage navigate={navigate} />
    case 'buyers':
      return <BuyersPage route={route} navigate={navigate} />
    case 'settlements':
      return <SettlementsPage route={route} navigate={navigate} />
    case 'home':
      return <HomePage navigate={navigate} />
  }
}
