// 로그인 화면 (AC-S05-01, SYS-01). 계정은 운영자가 만든다 — 가입 화면·링크는 없다.
// 틀리면 서버 문장을 그대로 보이고 아이디는 남긴다. 세션이 끝나 돌아왔으면 "로그인이 풀렸어요"를 보인다.
// 로그인 제한(429 LOGIN_RATE_LIMITED·LOGIN_BUSY)도 서버 문장 그대로. 아래에 정책 초안 링크(AC-I3-77).
// L1 간편 로그인(AC-L1-20·21): 서버가 공급자를 켜 두었으면 로그인 칸 아래 "또는" 줄과 "카카오로 계속하기"·"네이버로 계속하기"·"구글로 계속하기"
// (켜진 것만, 이 순서). 누르면 버튼 셋이 잠기고 같은 탭에서 승인 주소로 간다. 돌아온 결과(`/?login=<코드>&provider=<p>`)는 정해진 문장을 한 번 보이고
// 주소에서 지운다. 가입 화면·링크는 여전히 없다(D-L1-01).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isApiError, post, type ApiError } from '../api/client.ts'
import type { Me } from '../api/types.ts'
import { continueLabel, fetchLoginProviders, movingLabel, parseLoginResult, resultMessage, safeAuthorizeUrl, startErrorMessage, START_FAILED, stripLoginParams, type LoginProvider, type LoginResult } from '../lib/social-login.ts'

export const SESSION_EXPIRED_MESSAGE = '로그인이 풀렸어요. 다시 로그인해 주세요.'

export function LoginPage({ expired, onLoggedIn }: { readonly expired: boolean; readonly onLoggedIn: (me: Me) => void }) {
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
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const me = await post<Me>('/api/login', { loginId, password })
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

  const message = result === null ? null : resultMessage(result)
  return (
    <main className="page">
      <h1>라이브찜</h1>
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
        <button type="submit" className="button button-primary" disabled={busy}>
          로그인
        </button>
      </form>
      <SocialLogin onStart={() => setResult(null)} />
      <nav className="row policy-links" aria-label="약관">
        <a href="/privacy">개인정보처리방침</a>
        <a href="/terms">이용약관</a>
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
    try {
      const { authorizeUrl } = await post<{ authorizeUrl?: unknown }>('/api/auth/start', { provider })
      const target = safeAuthorizeUrl(authorizeUrl)
      if (target === null) {
        setError(START_FAILED)
        setMoving(null)
        return
      }
      window.location.assign(target)
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
      {error !== null ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** "카카오로 계속하기"·"네이버로 계속하기"·"구글로 계속하기" (공급자 색 — 명암비 4.5:1 이상, 그림 파일 없음, D-L1-06) */
export function SocialButtons({ providers, moving, onPress }: { readonly providers: readonly LoginProvider[]; readonly moving: LoginProvider | null; readonly onPress: (provider: LoginProvider) => void }) {
  return (
    <div className="social-buttons">
      {providers.map((provider) => (
        <button key={provider} type="button" className={`button social-button social-${provider}`} disabled={moving !== null} onClick={() => onPress(provider)}>
          {provider === 'naver' ? (
            <span className="social-naver-mark" aria-hidden="true">
              N
            </span>
          ) : null}
          <span>{moving === provider ? movingLabel(provider) : continueLabel(provider)}</span>
        </button>
      ))}
    </div>
  )
}
