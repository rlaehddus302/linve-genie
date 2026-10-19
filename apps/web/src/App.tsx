// 앱 (AC-S05-01·02, AC-S06-01): 로그인 확인 → 메뉴(방송·문자찜 입력·구매자·정산)와 그 화면.
// 쓰는 중에 세션이 끝나면(어떤 API든 401) 로그인 화면으로 가고, 다시 로그인하면 보던 화면(주소·검색값 그대로)으로 돌아간다.
// 그때 화면이 닫히며 5초 대기 중이던 방송자 조치는 보내지 않는다(D-083).
// 5초 대기 중인 조치가 있으면 떠나기 전에 묻는다(AC-S06-01): 메뉴·링크·같은 화면 안의 이동, 브라우저 뒤로·앞으로(앱 창), 새로고침·탭 닫기(브라우저 확인).
// 묻는 동안은 대기 시계를 멈추고, "보내지 않고 떠나기"면 그 화면의 기다리던 조치를 보내지 않는다(화면이 내려가는지에 기대지 않는다).
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
import { LEAVE_QUESTION, LeaveGuardContext, type LeaveGuard } from './lib/leave-guard.ts'
import { useRoute, type Navigate, type NavigateOptions, type Route } from './lib/router.ts'

type Session = { readonly state: 'checking' } | { readonly state: 'out'; readonly expired: boolean } | { readonly state: 'in'; readonly me: Me }

export const OFFLINE_MESSAGE = '인터넷 연결이 없어요. 연결되면 다시 불러와요.'
/** 인터넷이 없을 때 다시 확인하는 간격 */
const OFFLINE_RETRY_MS = 5000

/** 떠날지 묻는 이동: 갈 화면, 그 이동의 선택, 브라우저 뒤로·앞으로였는지(주소는 이미 바뀌었다) */
interface Leaving {
  readonly route: Route
  readonly options: NavigateOptions
  readonly fromPop: boolean
}

export function App() {
  const guards = useRef(new Set<LeaveGuard>())
  const [leaving, setLeaving] = useState<Leaving | null>(null)
  const pending = useCallback(() => [...guards.current].some((guard) => guard.pending()), [])
  /** 묻기 시작: 대기 시계를 멈춘다 — 창이 열린 동안 보내지 않는다 */
  const ask = useCallback((next: Leaving) => {
    for (const guard of guards.current) guard.hold()
    setLeaving(next)
  }, [])
  const [route, go] = useRoute((next) => {
    if (!pending()) return false
    ask({ route: next, options: {}, fromPop: true })
    return true
  })
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
      if (!ready) return
      setSession({ state: 'out', expired: true })
      setLeaving(null)
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

  const register = useCallback((guard: LeaveGuard) => {
    guards.current.add(guard)
    return () => {
      guards.current.delete(guard)
    }
  }, [])

  // 새로고침·탭 닫기·앱 닫기: 기다리는 조치가 있으면 브라우저가 묻는다 (떠나면 보내지 않는다, D-083)
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending()) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [pending])

  /** 메뉴·링크·화면 안의 이동: 5초 대기 중인 조치가 있으면 먼저 묻는다 (D-083) */
  const navigate = useCallback<Navigate>(
    (next, options = {}) => {
      if (options.replace !== true && pending()) {
        ask({ route: next, options, fromPop: false })
        return
      }
      go(next, options)
    },
    [ask, go, pending],
  )

  /** "닫기": 보던 화면에 남는다 — 시계가 다시 흐르고, 브라우저 뒤로·앞으로였으면 보던 주소를 다시 적는다 */
  const stay = () => {
    const target = leaving
    setLeaving(null)
    for (const guard of guards.current) guard.release()
    if (target?.fromPop === true) go(route)
  }

  /** "보내지 않고 떠나기": 기다리던 조치를 보내지 않고 간다 (같은 화면 안의 이동이어도) */
  const leave = () => {
    const target = leaving
    setLeaving(null)
    for (const guard of guards.current) guard.discard()
    if (target === null) return
    // 브라우저 뒤로·앞으로는 주소가 이미 그곳이다 (기록을 더하지 않는다)
    go(target.route, target.fromPop ? { replace: true } : target.options)
  }

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
          onClose={stay}
          actions={
            <button type="button" className="button button-danger" onClick={leave}>
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
