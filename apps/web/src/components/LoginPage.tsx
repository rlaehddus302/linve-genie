// 로그인 화면 (AC-S05-01, SYS-01). 계정은 운영자가 만든다 — 가입 화면·링크는 없다.
// 틀리면 서버 문장을 그대로 보이고 아이디는 남긴다. 세션이 끝나 돌아왔으면 "로그인이 풀렸어요"를 보인다.
// 로그인 제한(429 LOGIN_RATE_LIMITED·LOGIN_BUSY)도 서버 문장 그대로. 아래에 정책 초안 링크(AC-I3-77).
// L1 간편 로그인(AC-L1-20·21): 서버가 공급자를 켜 두었으면 로그인 칸 아래 "또는" 줄과 "카카오로 로그인"·"네이버로 로그인"·"구글로 로그인"
// (켜진 것만, 이 순서 — 이름은 D-UX3-29). 누르면 같은 탭에서 승인 주소로 간다(누른 단추만 진해지고 다른 단추는 흐려지지 않으며 겹쳐 누르기는 무시). 돌아온 결과(`/?login=<코드>&provider=<p>`)는 정해진 문장을 한 번 보이고
// 주소에서 지운다.
// D-UX3-28·29: 연결 안 된 공급자 계정이면 `/?login=SIGNUP` — 동의 판 없이 바로 가입한다(단추 아래 안내 한 줄과 이용약관·개인정보처리방침 링크를 보고 누른 것이 동의).
// 단추는 공식 로고를 왼쪽에 둔 긴 단추이고, 이 브라우저에서 마지막으로 로그인한 방법에 "최근 로그인" 표시(사용자 지시 2026-11-05).
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { isApiError, post, type ApiError } from '../api/client.ts'
import type { Me } from '../api/types.ts'
import { goTopLevel } from '../lib/google-return.ts'
import {
  commitPendingLogin,
  continueLabel,
  dropPendingLogin,
  fetchLoginProviders,
  markPendingLogin,
  movingLabel,
  parseLoginResult,
  readLastLogin,
  RECENT_LOGIN,
  rememberLastLogin,
  resultMessage,
  safeAuthorizeUrl,
  SIGNUP_MAKING,
  SOCIAL_TERMS_NOTE,
  startErrorMessage,
  START_FAILED,
  stripLoginParams,
  type LastLogin,
  type LoginProvider,
  type LoginResult,
} from '../lib/social-login.ts'
import { SOCIAL_LOGOS } from '../lib/social-logos.ts'
import { SERVICE_NAME } from '../brand.ts'
import { isAppTab } from '../lib/app-tab.ts'

export const SESSION_EXPIRED_MESSAGE = '로그인이 풀렸어요. 다시 로그인해 주세요.'
/** 주소가 `/login`일 때만 로그인 칸 아래 (D-LND1-10 (2)) */
export const LOGIN_ACCOUNT_NOTE = '처음이면 카카오·네이버·구글로 바로 시작할 수 있어요. 아이디·비밀번호를 잊었으면 운영자에게 물어봐 주세요.'
export const LOGIN_BACK_HOME = '처음 화면으로'
/** 아이디·비밀번호가 틀렸을 때(LOGIN_FAILED) 서버 문장 바로 아래, alert 밖 — 모든 로그인 화면 (D-LND1-10 (3)) */
export const LOGIN_FAILED_HINT = '아이디·비밀번호를 잊었으면 운영자에게 물어봐 주세요.'

const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

export function LoginPage({
  expired,
  onLoggedIn,
  onHome,
}: {
  readonly expired: boolean
  readonly onLoggedIn: (me: Me) => void
  /** 주소가 `/login`일 때만 준다 — 계정 안내·"처음 화면으로"(`/`)를 그린다. 그 자리 로그인 화면엔 없음 */
  readonly onHome?: () => void
}) {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordField = useRef<HTMLInputElement>(null)
  const idField = useRef<HTMLInputElement>(null)
  // 공급자에서 돌아온 결과 (주소에서 한 번 읽는다 — 지우는 것은 아래 효과에서)
  const [result, setResult] = useState<LoginResult | null>(() => parseLoginResult(window.location.pathname, window.location.search, 'login'))

  // 로그인 화면을 열면 "아이디" 칸에 커서 (AC-S06-66 015 — NOT_LINKED·SESSION_GONE으로 돌아와도 같다, AC-L1-21)
  useEffect(() => {
    idField.current?.focus()
  }, [])

  // 돌아온 결과 매개변수는 주소에서 지운다 (새로 고침하면 다시 나오지 않게 — 모르는 값이어도 지운다)
  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, '')
    if (path === '') stripLoginParams()
    // 공급자에서 로그인되지 않고 돌아왔다 — "최근 로그인"으로 옮기지 않는다 (가입 판은 가입하면 옮긴다)
    if (result !== null && result.code !== 'SIGNUP') dropPendingLogin()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const me = await post<Me>('/api/login', { loginId, password })
      if (me.role !== 'ASSISTANT') rememberLastLogin('id')
      onLoggedIn(me)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      setPassword('')
      passwordField.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const signup = result !== null && result.code === 'SIGNUP' ? result.provider : null
  const message = result === null || signup !== null ? null : resultMessage(result)
  return (
    <main className="page">
      <h1>{SERVICE_NAME}</h1>
      {signup !== null ? (
        <SignupNow
          onDone={(me) => {
            commitPendingLogin()
            onLoggedIn(me)
          }}
          onFail={() => dropPendingLogin()}
        />
      ) : null}
      {message !== null ? (
        <p className="notice" role={message.tone === 'success' ? 'status' : 'alert'} data-tone={message.tone === 'success' ? 'success' : 'warning'}>
          {message.text}
        </p>
      ) : null}
      {expired ? (
        <p className="notice" role="status">
          {SESSION_EXPIRED_MESSAGE}
        </p>
      ) : null}
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>아이디</span>
          <input ref={idField} className="input" name="loginId" autoComplete="username" value={loginId} onChange={(event) => setLoginId(event.target.value)} />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input
            ref={passwordField}
            className="input"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error !== null ? (
          <p className="field-error" role="alert">
            {error.message}
          </p>
        ) : null}
        {error !== null && error.code === 'LOGIN_FAILED' ? <p className="field-hint">{LOGIN_FAILED_HINT}</p> : null}
        <button type="submit" className="button button-primary" disabled={busy}>
          로그인
        </button>
      </form>
      <SocialLogin onStart={() => setResult(null)} />
      {onHome !== undefined ? (
        <div className="stack-tight login-help">
          <p>{LOGIN_ACCOUNT_NOTE}</p>
          <p>
            <a
              className="text-link"
              href="/"
              onClick={(event) => {
                if (!plainClick(event)) return
                event.preventDefault()
                onHome()
              }}
            >
              {LOGIN_BACK_HOME}
            </a>
          </p>
        </div>
      ) : null}
      <nav className="row policy-links" aria-label="약관">
        <a href="/privacy">개인정보처리방침</a>
        <a href="/terms">이용약관</a>
        {/* 공개 요금 안내 (PAY2 §7 화면 18) — 앱에서 연 탭에서는 없다 (BL-11 3) */}
        {isAppTab() ? null : <a href="/pricing">요금 안내</a>}
      </nav>
    </main>
  )
}

/** 간편 로그인 버튼 (켜진 공급자만 — 하나도 없으면 아무것도 그리지 않는다, AC-L1-20) */
function SocialLogin({ onStart }: { readonly onStart: () => void }) {
  const [providers, setProviders] = useState<readonly LoginProvider[]>([])
  const [moving, setMoving] = useState<LoginProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetchLoginProviders(controller.signal).then((list) => {
      if (!controller.signal.aborted) setProviders(list)
    })
    return () => controller.abort()
  }, [])

  // 공급자 화면에서 브라우저 "뒤로"로 돌아오면(페이지 캐시) 잠금을 푼다
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) setMoving(null)
    }
    window.addEventListener('pageshow', shown)
    return () => window.removeEventListener('pageshow', shown)
  }, [])

  const start = async (provider: LoginProvider) => {
    if (moving !== null) return
    setMoving(provider)
    setError(null)
    onStart()
    markPendingLogin(provider)
    try {
      const { authorizeUrl } = await post<{ authorizeUrl?: unknown }>('/api/auth/start', { provider })
      const target = safeAuthorizeUrl(authorizeUrl)
      if (target === null) {
        setError(START_FAILED)
        setMoving(null)
        return
      }
      goTopLevel(target)
    } catch (caught) {
      setError(startErrorMessage(caught))
      setMoving(null)
    }
  }

  if (providers.length === 0) return null
  return (
    <div className="social-login stack-tight">
      <p className="or-line">
        <span>또는</span>
      </p>
      <SocialButtons providers={providers} moving={moving} onPress={(provider) => void start(provider)} />
      {/* 이용약관·개인정보처리방침 링크는 바로 아래 꼬리 줄에 있다 */}
      <p className="social-terms">{SOCIAL_TERMS_NOTE}</p>
      {error !== null ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** 처음 계정 (D-UX3-29): 돌아오자마자 한 번 가입한다. 표가 오래됐으면 서버 문장 */
function SignupNow({ onDone, onFail }: { readonly onDone: (me: Me) => void; readonly onFail: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    post<Me>('/api/auth/signup', { agree: true }).then(onDone, (caught: unknown) => {
      onFail()
      setError(isApiError(caught) ? caught.message : START_FAILED)
    })
  }, [])
  return error === null ? (
    <p className="notice" role="status">
      {SIGNUP_MAKING}
    </p>
  ) : (
    <p className="notice" role="alert" data-tone="warning">
      {error}
    </p>
  )
}

/** 공급자 공식 로고 (그림 파일 없이 SVG 경로) */
export function SocialLogo({ provider }: { readonly provider: LoginProvider }) {
  const logo = SOCIAL_LOGOS[provider]
  return (
    <svg className="social-logo" viewBox={logo.viewBox} width="22" height="22" aria-hidden="true" focusable="false">
      {logo.paths.map((path) => (
        <path key={path.d} d={path.d} fill={path.fill} />
      ))}
    </svg>
  )
}

/**
 * "카카오로 로그인"·"네이버로 로그인"·"구글로 로그인"(D-UX3-29): 폭 가득한 긴 단추, 왼쪽에 공식 로고, 가운데 글 (공급자 안내서 색 — D-UX3-28).
 * last = 이 브라우저에서 마지막으로 로그인한 방법 — 그 단추에 "최근 로그인" 말풍선
 */
export function SocialButtons({
  providers,
  moving,
  onPress,
  last = readLastLogin(),
}: {
  readonly providers: readonly LoginProvider[]
  readonly moving: LoginProvider | null
  readonly onPress: (provider: LoginProvider) => void
  readonly last?: LastLogin | null
}) {
  return (
    <div className="social-buttons">
      {providers.map((provider) => (
        <button key={provider} type="button" className={`button social-button social-${provider}`} aria-busy={moving === provider} data-busy={moving === provider ? 'true' : undefined} onClick={() => onPress(provider)}>
          <SocialLogo provider={provider} />
          <span className="social-label">{moving === provider ? movingLabel(provider) : continueLabel(provider)}</span>
          {last === provider ? <span className="recent-login">{RECENT_LOGIN}</span> : null}
        </button>
      ))}
    </div>
  )
}
