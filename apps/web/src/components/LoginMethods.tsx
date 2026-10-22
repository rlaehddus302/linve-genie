// 설정 "로그인 방법" 칸 (L1 AC-L1-21·22·23, SPEC §7 화면 8, D-L1-03·D-L1-06) — 판매자에게만.
// - 첫 줄 "아이디 로그인 · 아이디 <아이디> · 늘 켜져 있어요"(끄는 버튼 없음), 그 아래 카카오·네이버·구글 순으로 연결 상태와 [연결하기]/[연결 끊기].
//   서버에서 꺼진 공급자에 남은 연결은 "지금은 쓸 수 없어요"와 [연결 끊기]만.
// - [연결하기]: 버튼이 잠기고 "카카오로 이동하는 중…", 같은 탭에서 승인 주소로 간다. 돌아오면 `/settings?login=<코드>&provider=<p>`의 결과 문장을 한 번 보인다.
// - [연결 끊기]: 확인 창(기본 포커스 "그만두기", Esc = 그만두기) → 끊으면 "카카오 연결을 끊었어요."와 새 목록. 지금 화면은 로그인된 채다.
// - 공급자가 하나도 켜져 있지 않은 서버는 목록 경로가 404 — 칸을 그리지 않는다(L1 전과 같다). 보조자는 목록을 부르지 않는다(403을 보지 않는다).
// - 다른 기기에서 연결·끊으면 실시간 알림(`login`)으로 목록을 다시 읽는다(설정 화면이 부른다).
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, post, type ApiError } from '../api/client.ts'
import {
  accountLabel,
  linkedDate,
  methodsOf,
  movingLabel,
  PROVIDER_NAMES,
  resultMessage,
  safeAuthorizeUrl,
  startErrorMessage,
  START_FAILED,
  unlinkedMessage,
  unlinkQuestion,
  type LoginMethodItem,
  type LoginMethods,
  type LoginProvider,
  type LoginResult,
} from '../lib/social-login.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

export type LoginMethodsState =
  | { readonly state: 'loading' }
  /** 간편 로그인이 꺼진 서버(404) 또는 보조자 — 칸이 없다 */
  | { readonly state: 'hidden' }
  | { readonly state: 'ready'; readonly methods: LoginMethods }
  | { readonly state: 'error'; readonly error: ApiError }

export interface LoginMethodsHandle {
  readonly current: LoginMethodsState
  readonly reload: () => Promise<void>
  readonly set: (methods: LoginMethods) => void
}

/** 로그인 방법 목록 (enabled가 거짓이면 부르지 않는다 — 보조자) */
export function useLoginMethods(enabled: boolean): LoginMethodsHandle {
  const [current, setCurrent] = useState<LoginMethodsState>(enabled ? { state: 'loading' } : { state: 'hidden' })
  const alive = useRef(true)
  const reload = useCallback(async () => {
    if (!enabled) return
    try {
      const methods = methodsOf(await get<unknown>('/api/auth/methods'))
      if (alive.current) setCurrent({ state: 'ready', methods })
    } catch (error) {
      if (!isApiError(error) || !alive.current) return
      // 404 = 간편 로그인이 꺼진 서버, 403 = 판매자 계정이 아님 — 칸이 없다
      if (error.status === 404 || error.status === 403) setCurrent({ state: 'hidden' })
      else if (error.status !== 401) setCurrent({ state: 'error', error })
    }
  }, [enabled])
  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
    }
  }, [reload])
  const set = useCallback((methods: LoginMethods) => setCurrent({ state: 'ready', methods }), [])
  return { current, reload, set }
}

/** 칸을 그릴지: 공급자 줄이 하나라도 있거나, 불러오지 못했거나, 돌아온 결과가 있을 때. 꺼진 서버·보조자(hidden)는 그리지 않는다 */
export function showLoginMethods(state: LoginMethodsState, result: LoginResult | null): boolean {
  switch (state.state) {
    case 'hidden':
      return false
    case 'loading':
      return result !== null
    case 'ready':
      return state.methods.providers.length > 0 || result !== null
    case 'error':
      return true
  }
}

type Notice = { readonly text: string; readonly tone: 'success' | 'error' }

export function LoginMethodsPanel({ handle, result }: { readonly handle: LoginMethodsHandle; readonly result: LoginResult | null }) {
  const [notice, setNotice] = useState<Notice | null>(() => (result === null ? null : resultMessage(result)))
  const [moving, setMoving] = useState<LoginProvider | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [asking, setAsking] = useState<LoginProvider | null>(null)
  const [unlinking, setUnlinking] = useState(false)
  const [unlinkError, setUnlinkError] = useState<ApiError | null>(null)

  // 공급자 화면에서 브라우저 "뒤로"로 돌아오면(페이지 캐시) 잠금을 푼다
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) setMoving(null)
    }
    window.addEventListener('pageshow', shown)
    return () => window.removeEventListener('pageshow', shown)
  }, [])

  const link = async (provider: LoginProvider) => {
    if (moving !== null || unlinking) return
    setMoving(provider)
    setActionError(null)
    setNotice(null)
    try {
      const { authorizeUrl } = await post<{ authorizeUrl?: unknown }>('/api/auth/link', { provider })
      const target = safeAuthorizeUrl(authorizeUrl)
      if (target === null) {
        setActionError(START_FAILED)
        setMoving(null)
        return
      }
      window.location.assign(target)
    } catch (caught) {
      setActionError(startErrorMessage(caught))
      setMoving(null)
    }
  }

  const unlink = async (provider: LoginProvider) => {
    if (unlinking) return
    setUnlinking(true)
    setUnlinkError(null)
    try {
      const methods = methodsOf(await post<unknown>('/api/auth/unlink', { provider }))
      handle.set(methods)
      setAsking(null)
      setActionError(null)
      setNotice({ tone: 'success', text: unlinkedMessage(provider) })
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (caught.status === 404) {
        // 이미 끊겼다(다른 기기) — 창을 닫고 목록을 새로 읽는다
        setAsking(null)
        setNotice({ tone: 'success', text: unlinkedMessage(provider) })
        void handle.reload()
      } else setUnlinkError(caught)
    } finally {
      setUnlinking(false)
    }
  }

  const state = handle.current
  return (
    <div className="stack login-methods">
      {notice !== null ? (
        <p className="notice" role={notice.tone === 'success' ? 'status' : 'alert'} data-tone={notice.tone === 'success' ? 'success' : 'warning'}>
          {notice.text}
        </p>
      ) : null}
      {state.state === 'loading' ? <p role="status">불러오는 중…</p> : null}
      {state.state === 'error' ? <ErrorNote error={state.error} onRetry={() => void handle.reload()} retryLabel="다시 불러오기" /> : null}
      {state.state === 'ready' ? (
        <ul className="plain-list login-method-list" aria-label="로그인 방법 목록">
          <li className="login-method">
            <p>아이디 로그인 · 아이디 {state.methods.loginId} · 늘 켜져 있어요</p>
          </li>
          {state.methods.providers.map((item) => (
            <MethodRow key={item.provider} item={item} moving={moving} locked={moving !== null || unlinking} onLink={() => void link(item.provider)} onUnlink={() => {
              setUnlinkError(null)
              setAsking(item.provider)
            }} />
          ))}
        </ul>
      ) : null}
      {actionError !== null ? (
        <p className="field-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {asking !== null ? (
        <Modal
          title={`${PROVIDER_NAMES[asking]} 연결 끊기`}
          closeLabel="그만두기"
          onClose={() => {
            if (!unlinking) setAsking(null)
          }}
          actions={
            <button type="button" className="button button-danger" disabled={unlinking} onClick={() => void unlink(asking)}>
              {unlinking ? '끊는 중…' : '연결 끊기'}
            </button>
          }
        >
          <p>{unlinkQuestion(asking)}</p>
          {unlinkError !== null ? <ErrorNote error={unlinkError} /> : null}
        </Modal>
      ) : null}
    </div>
  )
}

function MethodRow({ item, moving, locked, onLink, onUnlink }: { readonly item: LoginMethodItem; readonly moving: LoginProvider | null; readonly locked: boolean; readonly onLink: () => void; readonly onUnlink: () => void }) {
  const name = PROVIDER_NAMES[item.provider]
  const label = item.label.trim() === '' ? accountLabel(item.provider) : item.label
  const date = linkedDate(item.linkedAt)
  return (
    <li className="login-method row">
      <p className="login-method-text">
        <strong>{name}</strong>
        {' · '}
        {!item.linked ? '연결 안 됨' : item.enabled ? (date === '' ? label : `${label} · ${date}`) : `${label} · 지금은 쓸 수 없어요`}
      </p>
      {item.linked ? (
        <button type="button" className="button" aria-label={`${name} 연결 끊기`} disabled={locked} onClick={onUnlink}>
          연결 끊기
        </button>
      ) : item.enabled ? (
        <button type="button" className="button button-primary" {...(moving === item.provider ? {} : { 'aria-label': `${name} 연결하기` })} disabled={locked} onClick={onLink}>
          {moving === item.provider ? movingLabel(item.provider) : '연결하기'}
        </button>
      ) : null}
    </li>
  )
}
