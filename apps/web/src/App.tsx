// 앱 (AC-S05-01·02, AC-S06-01, AC-S06b-42·43, AC-I1-20, AC-N4a-10, I2 AC-I2-02·35, AC-N3-40): 로그인 확인 → 메뉴(방송·문자찜 입력·구매자·정산·입금 확인·포장·라벨·설정)와 그 화면.
// 라벨 기능이 꺼져 있으면 메뉴 "라벨"이 숨고 라벨 화면은 안내만 보인다(N4a L-13 9).
// 로그인한 동안 출력 기록·이 기기의 프린터(PrintProvider)는 앱 전체에 하나다 — 화면을 옮겨도 출력 기기의 출력이 이어진다(AC-I1-23).
// 입금 확인 신호(DepositProvider — 메뉴의 확인 필요 수)도 앱 전체에 하나다(판매자 계정만 — 보조자는 입금 확인 API가 403).
// 설정에서 가게 이름을 저장하면 화면 위 가게 이름이 바로 바뀐다.
// 쓰는 중에 세션이 끝나면(어떤 API든 401) 로그인 화면으로 가고, 다시 로그인하면 보던 화면(주소·검색값 그대로)으로 돌아간다.
// 그때 화면이 닫히며 5초 대기 중이던 방송자 조치는 보내지 않는다(D-083).
// 5초 대기 중인 조치가 있으면 떠나기 전에 묻는다(AC-S06-01): 메뉴·링크·같은 화면 안의 이동, 브라우저 뒤로·앞으로(앱 창), 새로고침·탭 닫기(브라우저 확인).
// 묻는 동안은 대기 시계를 멈추고, "보내지 않고 떠나기"면 그 화면의 기다리던 조치를 보내지 않는다(화면이 내려가는지에 기대지 않는다).
// "닫기"면 멈췄던 조치마다 대기 시간 전체를 다시 기다린다. 새로고침·탭 닫기는 preventDefault와 returnValue를 함께 한다. 앱 안에서 뒤로 갈
// 기록이 없는 처음 연 화면(홈 화면 앱의 첫 화면·새 탭)에 보내기 전인 조치가 생기면 같은 주소의 기록을 하나 더 쌓아 뒤로 가기가 앱을 떠나지 않고
// 묻는다. 웹이 막을 수 없는 닫기(앱을 위로 밀어 닫기)로 떠나면 보내지 않는다 (D-103, AC-S06b-42·43).
// 인터넷이 끊긴 채 열면(서비스 워커가 저장한 껍데기) "인터넷 연결이 없어요. 연결되면 다시 불러와요." — 연결되면 저절로 다시 불러온다(D-093).
// 요금(N5, AC-N5-50): 로그인한 동안 요금 기능 설정을 한 번 받는다. 켜져 있으면 메뉴 "요금"과 /billing 화면, 꺼져 있으면 /billing은 없는 화면이다.
// T1: 메뉴 "택배"와 택배 접수 화면 `/parcels`(AC-T1-60·61) — 보조자는 다른 화면처럼 안내만.
// I3: 메뉴에 "설정"(AC-I3-44), 시작 마법사 `/start`(AC-I3-50), 정책 페이지 `/privacy`·`/terms`는 로그인 없이(AC-I3-77),
// N4b: 끝난 방송의 영수증 보내기 `/broadcasts/<ID>/receipts`(AC-N4b-30) — 보조자는 다른 화면처럼 안내만.
// 보조자 계정은 문자찜 입력만 — 로그인하면 `/sms`로, 다른 화면 주소는 안내만 보이고 그 화면의 데이터를 부르지 않는다(AC-I3-63).
// 저장하지 않은 설정 값이 있으면 같은 떠나기 창이 그 문장으로 묻는다(AC-I3-46).
// LND1(D-LND1-01·02): 로그아웃 상태의 `/`는 브라우저 탭에서 처음 열면 공개 소개 화면, 로그인 화면은 `/login`(로그인하면 `/`로 바꿔 간다 — 보조자는 `/sms`).
// `/?login=` 결과가 붙어 왔거나, 이 탭에서 로그아웃·풀린 뒤(새로고침 전까지), 홈 화면 앱으로 열었으면 `/`에서도 바로 로그인 화면. 그 밖의 앱 주소는 지금처럼 그 자리에 로그인 화면.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get, isApiError, onUnauthorized, post, type ApiError } from './api/client.ts'
import { isAssistant, type Me } from './api/types.ts'
import { BillingConfigProvider, useBillingConfigState } from './components/billing-context.tsx'
import { BillingPage } from './components/BillingPage.tsx'
import { BuyersPage } from './components/BuyersPage.tsx'
import { ConsolePage } from './components/ConsolePage.tsx'
import { DepositProvider } from './components/deposit-context.tsx'
import { DepositsPage } from './components/DepositsPage.tsx'
import { ErrorNote } from './components/ErrorNote.tsx'
import { HomePage } from './components/HomePage.tsx'
import { LabelsPage } from './components/LabelsPage.tsx'
import { RefusalReset } from './components/LabelsOff.tsx'
import { LandingPage } from './components/LandingPage.tsx'
import { LoginPage } from './components/LoginPage.tsx'
import { Modal } from './components/Modal.tsx'
import { PackingPage } from './components/PackingPage.tsx'
import { ParcelsPage } from './components/ParcelsPage.tsx'
import { ReviewsPage } from './components/ReviewsPage.tsx'
import { PrivacyPage, TermsPage } from './components/PolicyPages.tsx'
import { PrintProvider } from './components/print-context.tsx'
import { ReceiptsPage } from './components/ReceiptsPage.tsx'
import { SettingsPage } from './components/SettingsPage.tsx'
import { SettlementsPage } from './components/SettlementsPage.tsx'
import { SmsPage } from './components/SmsPage.tsx'
import { TopBar } from './components/TopBar.tsx'
import { WizardPage } from './components/WizardPage.tsx'
import { takeGoogleReturn } from './lib/google-return.ts'
import { hasLoginResultParam, shouldShowLanding } from './lib/landing.ts'
import { isStandalone } from './pwa/pwa.ts'
import { parseLoginResult, resultMessage, stripLoginParams, type LoginResult } from './lib/social-login.ts'
import { ExternalLeaveContext, LEAVE_QUESTION, LEAVE_TITLE, LeaveGuardContext, SAVE_AND_LEAVE, SAVE_AND_LEAVE_BUSY, type ExternalLeave, type LeaveGuard } from './lib/leave-guard.ts'
import { NavigateContext } from './components/AppLink.tsx'
import { historyDepth, isGuardEntry, isPublicRoute, pushGuardEntry, routePath, useRoute, type BillingRoute, type Navigate, type NavigateOptions, type Route } from './lib/router.ts'
import { SERVICE_NAME } from './brand.ts'

type Session = { readonly state: 'checking' } | { readonly state: 'out'; readonly expired: boolean } | { readonly state: 'in'; readonly me: Me }

export const OFFLINE_MESSAGE = '인터넷 연결이 없어요. 연결되면 다시 불러와요.'
/** 인터넷이 없을 때 다시 확인하는 간격 */
const OFFLINE_RETRY_MS = 5000

/** 떠날지 묻는 이동: 갈 화면, 그 이동의 선택, 브라우저 뒤로·앞으로였는지(주소는 이미 바뀌었다), 처음 연 화면의 뒤로 가기였는지 */
interface Leaving {
  readonly route: Route
  readonly options: NavigateOptions
  readonly fromPop: boolean
  /** 묻는 문장·떠나기 버튼 (기다리는 화면의 것) */
  readonly question?: string
  readonly leaveLabel?: string
  /** 떠나기 확인용으로 더 쌓은 기록을 뒤로 가기가 뺐다 — 앱 안에서 뒤로 갈 곳이 없다 (D-103) */
  readonly guard: boolean
  /** 앱 밖으로 떠나기(간편 로그인 공급자 등, FB1 D-FB1-08)의 답 — 있으면 화면을 옮기지 않고 답만 준다 */
  readonly external?: (leave: boolean) => void
  /** "저장하고 떠나기" (설정 화면 저장 막대, FB1 D-FB1-18 (e)) */
  readonly save?: () => Promise<boolean>
}

/** 보조자 계정이 쓸 수 없는 화면 (AC-I3-63) */
export const ASSISTANT_BLOCKED = '보조자 계정으로는 쓸 수 없는 화면이에요.'

export function App() {
  const guards = useRef(new Set<LeaveGuard>())
  const [leaving, setLeaving] = useState<Leaving | null>(null)
  const pending = useCallback(() => [...guards.current].some((guard) => guard.pending()), [])
  /** 묻기 시작: 대기 시계를 멈춘다 — 창이 열린 동안 보내지 않는다 */
  /** 떠날지 묻는 중 (그동안은 묻는 기록을 새로 쌓지 않는다 — 창이 결정한다) */
  const asking = useRef(false)
  const ask = useCallback((next: Leaving) => {
    const waiting = [...guards.current].find((guard) => guard.pending())
    const saver = [...guards.current].find((guard) => guard.save !== undefined && guard.pending())?.save
    asking.current = true
    for (const guard of guards.current) guard.hold()
    setLeaving({
      ...next,
      ...(waiting?.question === undefined ? {} : { question: waiting.question }),
      ...(waiting?.leaveLabel === undefined ? {} : { leaveLabel: waiting.leaveLabel }),
      ...(saver === undefined ? {} : { save: saver }),
    })
  }, [])
  /** 지금 기록이 떠나기 확인용으로 더 쌓은 기록인가 (AC-S06b-43) */
  const guardEntry = useRef(isGuardEntry())
  /** 처음 연 화면에 보내기 전인 조치가 생기면 같은 주소의 기록을 하나 더 쌓는다 — 뒤로 가기가 앱을 떠나지 않고 묻는다 */
  const keepGuard = useCallback(() => {
    if (asking.current || guardEntry.current || historyDepth() > 0 || !pending()) return
    pushGuardEntry()
    guardEntry.current = true
  }, [pending])
  const [route, go] = useRoute((next) => {
    const fromGuard = guardEntry.current && !isGuardEntry()
    guardEntry.current = isGuardEntry()
    if (!pending()) return false
    ask({ route: next, options: {}, fromPop: true, guard: fromGuard })
    return true
  })
  const [session, setSession] = useState<Session>({ state: 'checking' })
  const [checkError, setCheckError] = useState<ApiError | null>(null)
  const [logoutError, setLogoutError] = useState<ApiError | null>(null)
  // 소개 화면을 건너뛸 까닭 (D-LND1-02): 처음 연 주소의 간편 로그인 결과·홈 화면 앱은 연 때 한 번 본다. 로그아웃·풀림은 이 탭에서 새로고침 전까지
  const [loginParam] = useState(() => hasLoginResultParam(window.location.search))
  const [standalone] = useState(isStandalone)
  const [leftInTab, setLeftInTab] = useState(false)

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

  // 로그인한 화면을 보던 중인가 — 이때의 401만 '로그인이 풀렸어요'다 (TE-LND1-001)
  const sessionLive = useRef(false)
  useEffect(() => {
    sessionLive.current = session.state === 'in'
  }, [session.state])

  useEffect(() => {
    // 로그인 확인(/api/me)의 401은 처음이든 끊김·503 뒤 다시 확인이든 아직 로그인하지 않은 것 — check()가 처리한다.
    // 로그인한 화면을 보던 중의 401만 세션이 끝난 것
    onUnauthorized(() => {
      if (!sessionLive.current) return
      sessionLive.current = false
      setLeftInTab(true)
      setSession({ state: 'out', expired: true })
      setLeaving(null)
      asking.current = false
    })
    void check()
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
      setLeftInTab(true)
      setSession({ state: 'out', expired: false })
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.status === 401) {
        setLeftInTab(true)
        setSession({ state: 'out', expired: false })
      }
      else setLogoutError(error)
    }
  }, [])

  const register = useCallback(
    (guard: LeaveGuard) => {
      guards.current.add(guard)
      const unsubscribe = guard.subscribe?.(keepGuard)
      keepGuard()
      return () => {
        unsubscribe?.()
        guards.current.delete(guard)
      }
    },
    [keepGuard],
  )

  /** 앱이 이미 물었고 앱 밖으로 가는 중 — 브라우저가 다시 묻지 않는다 (FB1 D-FB1-08) */
  const unloadAllowed = useRef(0)
  // 새로고침·탭 닫기·앱 닫기: 기다리는 조치가 있으면 브라우저가 묻는다 (떠나면 보내지 않는다, D-083).
  // preventDefault와 returnValue를 함께 — 사파리 등 returnValue가 있어야 묻는 브라우저도 묻게 (D-103)
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (unloadAllowed.current > 0 || !pending()) return
      event.preventDefault()
      event.returnValue = LEAVE_QUESTION
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [pending])

  /** 앱 밖으로 떠나기 전 확인 (FB1 D-FB1-08): 남은 값이 없으면 묻지 않는다 */
  const external = useMemo<ExternalLeave>(
    () => ({
      confirm: () =>
        new Promise<boolean>((resolve) => {
          if (asking.current || !pending()) {
            resolve(!asking.current)
            return
          }
          ask({ route, options: {}, fromPop: false, guard: false, external: resolve })
        }),
      allowUnload: () => {
        unloadAllowed.current++
        let done = false
        return () => {
          if (done) return
          done = true
          unloadAllowed.current--
        }
      },
    }),
    [ask, pending, route],
  )

  /** 메뉴·링크·화면 안의 이동: 5초 대기 중인 조치가 있으면 먼저 묻는다 (D-083) */
  const navigate = useCallback<Navigate>(
    (next, options = {}) => {
      if (options.replace !== true && options.stay !== true && pending()) {
        ask({ route: next, options, fromPop: false, guard: false })
        return
      }
      go(next, options)
    },
    [ask, go, pending],
  )

  /**
   * "닫기": 보던 화면에 남는다 — 멈췄던 조치는 대기 시간 전체를 다시 기다리고(D-103), 브라우저 뒤로·앞으로였으면 보던 주소를 다시 적는다.
   * 처음 연 화면의 뒤로 가기였으면 묻는 기록을 다시 쌓는다(다음 뒤로 가기도 묻는다).
   */
  const stay = (from: Leaving | null = leaving) => {
    if (from === leaving && leaveSavingRef.current) return
    const target = from
    setLeaving(null)
    asking.current = false
    // 묻는 기록을 먼저 다시 쌓는다 (시계가 다시 흐를 때 한 번만 쌓이게)
    if (target?.guard === true) {
      pushGuardEntry()
      guardEntry.current = true
    }
    for (const guard of guards.current) guard.release()
    if (target?.external !== undefined) {
      target.external(false)
      return
    }
    if (target?.guard !== true && target?.fromPop === true) go(route)
  }

  /**
   * "저장하고 떠나기" (FB1 D-FB1-18 (e)): 저장 막대와 같은 요청 차례. 보내는 동안 세 단추 잠김(두 번 눌러도 한 번, Esc도 기다린다).
   * 모두 성공 → 가려던 곳으로("저장하지 않고 떠나기"와 같은 길). 하나라도 실패 → 창을 닫고 남는다(막대에 실패 문장·첫 빨간 칸에 포커스는 막대가)
   */
  const [leaveSaving, setLeaveSaving] = useState(false)
  const leaveSavingRef = useRef(false)
  const saveAndLeave = async () => {
    const target = leaving
    if (target?.save === undefined || leaveSavingRef.current) return
    leaveSavingRef.current = true
    setLeaveSaving(true)
    let ok: boolean
    try {
      ok = await target.save()
    } finally {
      leaveSavingRef.current = false
      setLeaveSaving(false)
    }
    if (ok) leave(target)
    else stay(target)
  }

  /** "보내지 않고 떠나기": 기다리던 조치를 보내지 않고 간다 (같은 화면 안의 이동이어도) */
  const leave = (from: Leaving | null = leaving) => {
    const target = from
    setLeaving(null)
    asking.current = false
    for (const guard of guards.current) guard.discard()
    if (target === null) return
    // 앱 밖으로: 화면은 그대로 두고 부른 쪽이 이동한다
    if (target.external !== undefined) {
      target.external(true)
      return
    }
    // 처음 연 화면의 뒤로 가기: 보내지 않고 앱 밖(이전 기록)으로
    if (target.guard) {
      window.history.back()
      return
    }
    // 브라우저 뒤로·앞으로는 주소가 이미 그곳이다 (기록을 더하지 않는다)
    go(target.route, target.fromPop ? { replace: true } : target.options)
  }

  // 로그인한 채 홈 주소에 간편 로그인 결과(`/?login=`)가 붙어 왔으면 지운다 (L1 AC-L1-21).
  // 연결하다 돌아온 SESSION_GONE·RATE_LIMITED는 로그인된 채(다른 탭에서 다시 로그인함 등)여도 위 알림으로 같은 문장을 보인다 (TE-L1-001).
  // 그 밖의 로그인 화면 문장(취소·만료·연결 없음)은 로그인 화면에서만 보인다
  const signedIn = session.state === 'in'
  const [homeNotice, setHomeNotice] = useState<LoginResult | null>(null)
  useEffect(() => {
    if (!signedIn) return
    if (route.name !== 'home') {
      setHomeNotice(null)
      return
    }
    const result = parseLoginResult(window.location.pathname, window.location.search, 'login')
    if (result !== null && (result.code === 'SESSION_GONE' || result.code === 'RATE_LIMITED')) setHomeNotice(result)
    stripLoginParams()
  }, [signedIn, route.name])

  /** 로그인: 보조자 계정은 문자찜 입력으로 (AC-I3-63). `/login`에서 로그인하면 방송 목록으로 바꿔 간다 — 뒤로 가기가 로그인 화면으로 가지 않는다 (D-LND1-01) */
  const loggedIn = (me: Me) => {
    setSession({ state: 'in', me })
    if (isAssistant(me) && route.name !== 'sms') go({ name: 'sms' }, { replace: true })
    else if (route.name === 'login') go({ name: 'home' }, { replace: true })
  }

  // 로그인한 채 `/login`을 열면 로그인 화면 없이 방송 목록으로(보조자는 문자찜 입력) — 기록을 쌓지 않는다 (D-LND1-01 (3))
  const assistantSignedIn = session.state === 'in' && isAssistant(session.me)
  useEffect(() => {
    if (signedIn && route.name === 'login') go(assistantSignedIn ? { name: 'sms' } : { name: 'home' }, { replace: true })
  }, [signedIn, assistantSignedIn, route.name, go])

  /** 가게 이름을 바꾸면 이 기기의 위 줄이 바로 바뀐다 (AC-I3-47) */
  const renamed = useCallback((name: string) => {
    setSession((current) => (current.state === 'in' ? { state: 'in', me: { ...current.me, seller: { name } } } : current))
  }, [])

  // 정책 페이지는 로그인 없이 연다 (세션이 없어도 로그인 화면으로 바꾸지 않는다, AC-I3-77).
  // "로그인 화면으로"는 `/login`으로, 확인 중의 "처음 화면으로"는 `/` (D-LND1-08)
  if (isPublicRoute(route) && route.name !== 'login' && session.state !== 'in') {
    const back: Route = session.state === 'checking' ? { name: 'home' } : { name: 'login' }
    return (
      <>
        <header className="topbar">
          <p className="shop-name">{SERVICE_NAME}</p>
          <a
            className="button"
            href={routePath(back)}
            onClick={(event) => {
              event.preventDefault()
              go(back)
            }}
          >
            {session.state === 'checking' ? '처음 화면으로' : '로그인 화면으로'}
          </a>
        </header>
        {route.name === 'privacy' ? <PrivacyPage /> : <TermsPage />}
      </>
    )
  }

  if (session.state === 'checking') {
    return (
      <main className="page">
        <h1>{SERVICE_NAME}</h1>
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
    if (shouldShowLanding({ signedOut: true, route, loginParam, leftInTab, standalone })) return <LandingPage onLogin={() => go({ name: 'login' })} />
    return <LoginPage expired={session.expired} onLoggedIn={loggedIn} onHome={route.name === 'login' ? () => go({ name: 'home' }) : undefined} />
  }
  const me = session.me
  const assistant = isAssistant(me)
  const shell = (
    <>
      <TopBar shopName={me.seller.name} assistant={assistant} onLogout={() => void logout()} route={route} navigate={navigate} />
      {assistant ? null : <RefusalReset screen={routePath(route)} />}
      {logoutError !== null ? <ErrorNote error={logoutError} /> : null}
      {homeNotice !== null ? (
        <div className="notice row login-result-notice">
          <p role="alert">{resultMessage(homeNotice).text}</p>
          <button type="button" className="button" onClick={() => setHomeNotice(null)}>
            닫기
          </button>
        </div>
      ) : null}
      {assistant && route.name !== 'sms' && !isPublicRoute(route) ? <AssistantBlocked navigate={navigate} /> : <Screen route={route} navigate={navigate} me={me} onRenamed={renamed} />}
      {leaving !== null ? (
        <Modal
          title={LEAVE_TITLE}
          onClose={() => stay()}
          closeLast={leaving.save !== undefined}
          closeDisabled={leaveSaving}
          actions={
            <>
              {leaving.save !== undefined ? (
                <button type="button" className="button button-primary" disabled={leaveSaving} onClick={() => void saveAndLeave()}>
                  {leaveSaving ? SAVE_AND_LEAVE_BUSY : SAVE_AND_LEAVE}
                </button>
              ) : null}
              <button type="button" className="button button-danger" disabled={leaveSaving} onClick={() => leave()}>
                {leaving.leaveLabel ?? '보내지 않고 떠나기'}
              </button>
            </>
          }
        >
          <p>{leaving.question ?? LEAVE_QUESTION}</p>
        </Modal>
      ) : null}
    </>
  )
  return (
    <LeaveGuardContext.Provider value={register}>
      <ExternalLeaveContext.Provider value={external}>
      <NavigateContext.Provider value={navigate}>
        {/* 출력 기록·이 기기의 프린터(PrintProvider)·입금 확인 신호(DepositProvider)·요금 기능 설정(BillingConfigProvider)은 판매자 계정만 —
            보조자는 출력·입금 확인·요금을 쓰지 않는다(그 API는 403, SYS-04). 보조자 화면은 다른 화면의 데이터를 부르지 않는다(AC-I3-63) */}
        {assistant ? (
          shell
        ) : (
          <BillingConfigProvider>
            <PrintProvider>
              <DepositProvider>{shell}</DepositProvider>
            </PrintProvider>
          </BillingConfigProvider>
        )}
      </NavigateContext.Provider>
      </ExternalLeaveContext.Provider>
    </LeaveGuardContext.Provider>
  )
}

/** 보조자 계정이 다른 화면 주소를 열었다: 안내만 (그 화면의 데이터 요청을 보내지 않는다) */
function AssistantBlocked({ navigate }: { readonly navigate: Navigate }) {
  return (
    <main className="page">
      <h1>문자찜 입력만 쓸 수 있어요</h1>
      <p className="notice" role="status">
        {ASSISTANT_BLOCKED}
      </p>
      <p>
        <a
          className="button button-primary"
          href={routePath({ name: 'sms' })}
          onClick={(event) => {
            event.preventDefault()
            navigate({ name: 'sms' })
          }}
        >
          문자찜 입력으로 가기
        </a>
      </p>
    </main>
  )
}

interface ScreenProps {
  readonly route: Route
  readonly navigate: Navigate
  readonly me: Me
  readonly onRenamed: (name: string) => void
}

function Screen({ route, navigate, me, onRenamed }: ScreenProps) {
  switch (route.name) {
    case 'console':
      return <ConsolePage key={route.id} broadcastId={route.id} navigate={navigate} />
    case 'receipts':
      return <ReceiptsPage key={route.id} broadcastId={route.id} navigate={navigate} shopName={me.seller.name} />
    case 'sms':
      return <SmsPage navigate={navigate} assistant={isAssistant(me)} />
    case 'buyers':
      return <BuyersPage route={route} navigate={navigate} />
    case 'settlements':
      return <SettlementsPage route={route} navigate={navigate} />
    case 'packing':
      return <PackingPage route={route} navigate={navigate} />
    case 'parcels':
      return <ParcelsPage route={route} navigate={navigate} />
    case 'reviews':
      return <ReviewsPage route={route} navigate={navigate} />
    case 'labels':
      return <LabelsPage navigate={navigate} shopName={me.seller.name} />
    case 'billing':
      return <BillingScreen route={route} navigate={navigate} />
    case 'settings':
      return <SettingsRoute route={route} navigate={navigate} me={me} onRenamed={onRenamed} />
    case 'start':
      return <WizardPage route={route} navigate={navigate} shopName={me.seller.name} onRenamed={onRenamed} />
    case 'privacy':
      return <PrivacyPage />
    case 'terms':
      return <TermsPage />
    case 'deposits':
      return <DepositsPage route={route} navigate={navigate} />
    case 'home':
      return <HomePage navigate={navigate} />
    case 'login':
      // 로그인한 채 연 `/login`: 효과가 곧 방송 목록(보조자는 문자찜 입력)으로 바꿔 간다
      return null
  }
}

/** 없는 화면 (요금 기능이 꺼진 서버의 /billing — AC-N5-50) */
export const NOT_FOUND_MESSAGE = '찾을 수 없는 화면이에요.'

function NotFound({ navigate }: { readonly navigate: Navigate }) {
  return (
    <main className="page stack">
      <h1>{NOT_FOUND_MESSAGE}</h1>
      <p>주소를 확인하거나 방송 목록으로 가 주세요.</p>
      <div className="row">
        <a
          className="button"
          href={routePath({ name: 'home' })}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            navigate({ name: 'home' })
          }}
        >
          방송 목록으로
        </a>
      </div>
    </main>
  )
}

/** 요금 화면: 요금 기능 설정을 받은 뒤 — 켜져 있으면 요금 화면, 꺼져 있으면 없는 화면 */
function BillingScreen({ route, navigate }: { readonly route: BillingRoute; readonly navigate: Navigate }) {
  const state = useBillingConfigState()
  if (state.state === 'loading') {
    return (
      <main className="page">
        <p>불러오는 중…</p>
      </main>
    )
  }
  if (state.state === 'error') {
    return (
      <main className="page">
        <ErrorNote error={state.error} onRetry={state.retry} retryLabel="다시 불러오기" />
      </main>
    )
  }
  if (!state.config.enabled) return <NotFound navigate={navigate} />
  return <BillingPage config={state.config} route={route} navigate={navigate} />
}

/** 구글에서 돌아온 주소(`/settings/youtube?youtube=`)인데 시작 마법사 3단계에서 떠났으면 마법사로 돌려보낸다 (AC-I3-02·54) */
function SettingsRoute({ route, navigate, me, onRenamed }: ScreenProps & { readonly route: Extract<Route, { name: 'settings' }> }) {
  const [toWizard] = useState(() => route.youtubeResult !== undefined && takeGoogleReturn() === 'wizard')
  useEffect(() => {
    if (toWizard && route.youtubeResult !== undefined) navigate({ name: 'start', youtubeResult: route.youtubeResult }, { replace: true })
  }, [toWizard, route.youtubeResult, navigate])
  if (toWizard) return null
  return <SettingsPage route={route} navigate={navigate} shopName={me.seller.name} onRenamed={onRenamed} assistant={isAssistant(me)} />
}
