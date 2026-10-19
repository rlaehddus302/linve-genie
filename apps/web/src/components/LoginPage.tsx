// 로그인 화면 (AC-S05-01, SYS-01). 계정은 운영자가 만든다 — 가입 화면·링크는 없다.
// 틀리면 서버 문장을 그대로 보이고 아이디는 남긴다. 세션이 끝나 돌아왔으면 "로그인이 풀렸어요"를 보인다.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isApiError, post, type ApiError } from '../api/client.ts'
import type { Me } from '../api/types.ts'

export const SESSION_EXPIRED_MESSAGE = '로그인이 풀렸어요. 다시 로그인해 주세요.'

export function LoginPage({ expired, onLoggedIn }: { readonly expired: boolean; readonly onLoggedIn: (me: Me) => void }) {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordField = useRef<HTMLInputElement>(null)
  const idField = useRef<HTMLInputElement>(null)

  // 로그인 화면을 열면 "아이디" 칸에 커서 (AC-S06-66 015)
  useEffect(() => {
    idField.current?.focus()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
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

  return (
    <main className="page">
      <h1>라이브찜</h1>
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
    </main>
  )
}
