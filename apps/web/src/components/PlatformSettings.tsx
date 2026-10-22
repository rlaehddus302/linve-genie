// 설정의 인스타그램·틱톡 칸 (SPEC §7 화면 8, PLT-01·02, D-904, D-N2b-2-04·13, AC-N2b-2-20·25·67).
// - 인스타그램: 설정 없음이면 서버 문장만. 아니면 연결 상태("연결됨 — @이름"), "인스타그램 연결하기"(서버가 준 주소로 같은 탭 최상위 이동 —
//   다시 연결도 같다), 돌아온 결과 문장, "연결 끊기"(확인 창), 감사 DM 자동 발송(켜기는 설명 창의 "동의해요", 끄기는 바로 — 메시지 권한이 없으면
//   서버가 준 주소로 이동).
// - 틱톡 라이브(베타): 운영자 스위치가 꺼져 있으면 "지금은 틱톡 연결을 쓸 수 없어요."만. 켜기 전에는 위험 고지 전문 + 체크 상자 + "켜기"
//   (체크 전에는 누를 수 없음). 켠 뒤에는 "켜져 있어요 (YYYY년 M월 D일 켬)", "내 틱톡 아이디" 칸(저장 — 실패 문장은 칸 아래), "끄기"(확인 창).
// - 보조자는 설정 화면을 열 수 없다(앱이 막는다) — 이 칸들도 보이지 않는다.
// 서버 문장(고지·오류)은 고치지 않고 글자 그대로 보인다. 아이디·계정 이름은 글자로만 보인다.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { get, isApiError, newRequestId, post, put, withRetry, type ApiError } from '../api/client.ts'
import type { InstagramConnection, TikTokSettings } from '../api/types.ts'
import { goToGoogle } from '../lib/google-return.ts'
import { dateYear, kstDate } from '../lib/kst.ts'
import {
  INSTAGRAM_CONSENT_EXPLAIN,
  INSTAGRAM_DISCONNECT_QUESTION,
  INSTAGRAM_NOT_CONFIGURED,
  INSTAGRAM_RECONNECT,
  TIKTOK_OFF_QUESTION,
  instagramCallbackMessage,
  instagramCallbackSucceeded,
  tiktokConsentOn,
} from '../lib/platforms.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

// ── 인스타그램 ───────────────────────────────────────────────────────

export type InstagramState = { readonly phase: 'loading' } | { readonly phase: 'error'; readonly error: ApiError } | { readonly phase: 'ready'; readonly connection: InstagramConnection }

export interface InstagramHandle {
  readonly state: InstagramState
  readonly reload: () => Promise<void>
  readonly set: (connection: InstagramConnection) => void
}

/** 인스타그램 연결 상태 (GET /api/instagram) */
export function useInstagramConnection(enabled = true): InstagramHandle {
  const [state, setState] = useState<InstagramState>({ phase: 'loading' })
  const version = useRef(0)
  const reload = useCallback(async () => {
    const mine = ++version.current
    try {
      const { connection } = await get<{ connection: InstagramConnection }>('/api/instagram')
      if (mine === version.current) setState({ phase: 'ready', connection })
    } catch (error) {
      if (isApiError(error) && mine === version.current) setState({ phase: 'error', error })
    }
  }, [])
  const set = useCallback((connection: InstagramConnection) => {
    version.current++
    setState({ phase: 'ready', connection })
  }, [])
  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])
  return { state, reload, set }
}

/** 인스타그램에서 돌아온 결과 문장 (한 번 — 상태 영역) */
export function InstagramCallbackResult({ code }: { readonly code: string | null }) {
  if (code === null) return null
  return (
    <p className={instagramCallbackSucceeded(code) ? 'notice' : 'warning'} role="status">
      {instagramCallbackMessage(code)}
    </p>
  )
}

export function InstagramSettings({ handle }: { readonly handle: InstagramHandle }) {
  const { state } = handle
  if (state.phase === 'loading') return <p role="status">불러오는 중…</p>
  if (state.phase === 'error') return <ErrorNote error={state.error} onRetry={() => void handle.reload()} retryLabel="다시 불러오기" />
  return <InstagramReady connection={state.connection} onChanged={handle.set} />
}

function InstagramReady({ connection, onChanged }: { readonly connection: InstagramConnection; readonly onChanged: (connection: InstagramConnection) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [asking, setAsking] = useState<'disconnect' | 'consent' | null>(null)

  if (!connection.configured) return <p>{INSTAGRAM_NOT_CONFIGURED}</p>

  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  const connect = () =>
    run(async () => {
      const { url } = await post<{ url: string }>('/api/instagram/connect', {})
      goToGoogle(url)
    })

  const disconnect = () =>
    run(async () => {
      const result = await withRetry(() => post<{ connection: InstagramConnection }>('/api/instagram/disconnect', {}))
      onChanged(result.connection)
      setAsking(null)
    })

  const consent = (on: boolean) =>
    run(async () => {
      const result = await withRetry(() => post<{ permissionRequired: boolean; url?: string; connection: InstagramConnection }>('/api/instagram/consent', { on }))
      onChanged(result.connection)
      setAsking(null)
      if (result.permissionRequired && typeof result.url === 'string') goToGoogle(result.url)
    })

  const { status, account } = connection
  return (
    <div className="stack">
      {status === 'CONNECTED' ? <p>{account === null ? '연결됨' : `연결됨 — @${account.username}`}</p> : null}
      {status === 'NOT_CONNECTED' ? <p>연결된 인스타그램 계정이 없어요.</p> : null}
      {status === 'RECONNECT_NEEDED' ? <p className="warning">{INSTAGRAM_RECONNECT}</p> : null}
      <div className="row">
        {/* 설정 화면은 칸마다 버튼이 있어 주 버튼을 두지 않는다 (UX-01·D-102, N4a 합친 뒤 71b5d2d와 같은 기준) */}
        <button type="button" className="button" disabled={busy} onClick={() => void connect()}>
          {status === 'NOT_CONNECTED' ? '인스타그램 연결하기' : '인스타그램 다시 연결하기'}
        </button>
        {status !== 'NOT_CONNECTED' ? (
          <button type="button" className="button" disabled={busy} onClick={() => setAsking('disconnect')}>
            연결 끊기
          </button>
        ) : null}
      </div>
      {status === 'CONNECTED' ? (
        <div className="stack-tight" role="group" aria-label="감사 DM 자동 발송">
          <p>
            <strong>감사 DM 자동 발송</strong> {connection.consent.on ? '켜져 있어요' : '꺼져 있어요'}
          </p>
          <div className="row">
            {connection.consent.on ? (
              <button type="button" className="button" disabled={busy} onClick={() => void consent(false)}>
                감사 DM 자동 발송 끄기
              </button>
            ) : (
              <button type="button" className="button" disabled={busy} onClick={() => setAsking('consent')}>
                감사 DM 자동 발송 켜기
              </button>
            )}
          </div>
        </div>
      ) : null}
      {error !== null && asking === null ? <ErrorNote error={error} /> : null}
      {asking === 'disconnect' ? (
        <Modal
          title="인스타그램 연결 끊기"
          onClose={() => setAsking(null)}
          actions={
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void disconnect()}>
              끊기
            </button>
          }
        >
          <p>{INSTAGRAM_DISCONNECT_QUESTION}</p>
          {error !== null ? <ErrorNote error={error} /> : null}
        </Modal>
      ) : null}
      {asking === 'consent' ? (
        <Modal
          title="감사 DM 자동 발송"
          onClose={() => setAsking(null)}
          actions={
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void consent(true)}>
              동의해요
            </button>
          }
        >
          <p>{INSTAGRAM_CONSENT_EXPLAIN}</p>
          {error !== null ? <ErrorNote error={error} /> : null}
        </Modal>
      ) : null}
    </div>
  )
}

// ── 틱톡 라이브(베타) ─────────────────────────────────────────────────

export type TikTokState = { readonly phase: 'loading' } | { readonly phase: 'error'; readonly error: ApiError } | { readonly phase: 'ready'; readonly settings: TikTokSettings }

export interface TikTokHandle {
  readonly state: TikTokState
  readonly reload: () => Promise<void>
  readonly set: (settings: TikTokSettings) => void
}

/** 틱톡 설정 (GET /api/tiktok) */
export function useTikTokSettings(enabled = true): TikTokHandle {
  const [state, setState] = useState<TikTokState>({ phase: 'loading' })
  const version = useRef(0)
  const reload = useCallback(async () => {
    const mine = ++version.current
    try {
      const { tiktok } = await get<{ tiktok: TikTokSettings }>('/api/tiktok')
      if (mine === version.current) setState({ phase: 'ready', settings: tiktok })
    } catch (error) {
      if (isApiError(error) && mine === version.current) setState({ phase: 'error', error })
    }
  }, [])
  const set = useCallback((settings: TikTokSettings) => {
    version.current++
    setState({ phase: 'ready', settings })
  }, [])
  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])
  return { state, reload, set }
}

/** 켠 날 "2026년 10월 21일" (KST) */
export function consentDateWords(at: string): string {
  return dateYear(kstDate(at))
}

export function TikTokSettingsSection({ handle }: { readonly handle: TikTokHandle }) {
  const { state } = handle
  if (state.phase === 'loading') return <p role="status">불러오는 중…</p>
  if (state.phase === 'error') return <ErrorNote error={state.error} onRetry={() => void handle.reload()} retryLabel="다시 불러오기" />
  const { settings } = state
  if (!settings.operator) return <p>{settings.operatorMessage ?? '지금은 틱톡 연결을 쓸 수 없어요.'}</p>
  return tiktokConsentOn(settings) ? <TikTokOn settings={settings} onChanged={handle.set} onReload={() => void handle.reload()} /> : <TikTokOff settings={settings} onChanged={handle.set} onReload={() => void handle.reload()} />
}

interface TikTokPartProps {
  readonly settings: TikTokSettings
  readonly onChanged: (settings: TikTokSettings) => void
  readonly onReload: () => void
}

/** 켜기 전: 위험 고지 전문 + 체크 상자 + "켜기" */
function TikTokOff({ settings, onChanged, onReload }: TikTokPartProps) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const pending = useRef<string | null>(null)
  const checkId = useId()
  const { notice } = settings
  const turnOn = async () => {
    if (busy || !agreed) return
    pending.current ??= newRequestId()
    const requestId = pending.current
    setBusy(true)
    setError(null)
    try {
      const result = await withRetry(() => post<{ tiktok: TikTokSettings }>('/api/tiktok/consent', { requestId, on: true, version: notice.version }))
      pending.current = null
      onChanged(result.tiktok)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.retryable) pending.current = null
      setError(caught)
      // 안내가 바뀌었으면 새 안내를 받는다 (체크는 다시)
      if (caught.code === 'NOTICE_CHANGED') {
        setAgreed(false)
        onReload()
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack tiktok-notice">
      <h3>{notice.title}</h3>
      <ol className="tiktok-notice-lines">
        {notice.lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ol>
      <label className="choice" htmlFor={checkId}>
        <input id={checkId} type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        <span>{notice.checkbox}</span>
      </label>
      <div className="row">
        <button type="button" className="button" disabled={!agreed || busy} onClick={() => void turnOn()}>
          {notice.button}
        </button>
      </div>
      {error !== null ? <ErrorNote error={error} /> : null}
    </div>
  )
}

/** 켠 뒤: 켠 날·틱톡 아이디·끄기 */
function TikTokOn({ settings, onChanged }: TikTokPartProps) {
  const [value, setValue] = useState(settings.tiktokId === null ? '' : `@${settings.tiktokId}`)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<ApiError | null>(null)
  const [saved, setSaved] = useState(false)
  const [asking, setAsking] = useState(false)
  const [offBusy, setOffBusy] = useState(false)
  const [offError, setOffError] = useState<ApiError | null>(null)
  const offRequest = useRef<string | null>(null)
  const fieldId = useId()
  const at = settings.consent?.at ?? null

  const save = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const text = value.trim()
      const result = await withRetry(() => put<{ tiktok: TikTokSettings }>('/api/tiktok/account', { tiktokId: text === '' ? null : text }))
      onChanged(result.tiktok)
      setValue(result.tiktok.tiktokId === null ? '' : `@${result.tiktok.tiktokId}`)
      setSaved(true)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setSaveError(caught)
    } finally {
      setSaving(false)
    }
  }

  const turnOff = async () => {
    if (offBusy) return
    offRequest.current ??= newRequestId()
    const requestId = offRequest.current
    setOffBusy(true)
    setOffError(null)
    try {
      const result = await withRetry(() => post<{ tiktok: TikTokSettings }>('/api/tiktok/consent', { requestId, on: false }))
      offRequest.current = null
      setAsking(false)
      onChanged(result.tiktok)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.retryable) offRequest.current = null
      setOffError(caught)
    } finally {
      setOffBusy(false)
    }
  }

  const fieldProblem = saveError === null ? null : (saveError.problemFor('tiktokId')?.message ?? saveError.message)
  return (
    <div className="stack">
      <p>
        <strong>{at === null ? '켜져 있어요' : `켜져 있어요 (${consentDateWords(at)} 켬)`}</strong>
      </p>
      <form
        className="stack-tight"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="field" htmlFor={fieldId}>
          <span>내 틱톡 아이디</span>
        </label>
        <input
          id={fieldId}
          className="input"
          autoComplete="off"
          spellCheck={false}
          placeholder="@아이디 또는 방송 주소"
          value={value}
          aria-invalid={fieldProblem !== null}
          aria-describedby={fieldProblem !== null ? `${fieldId}-error` : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setSaved(false)
          }}
        />
        {fieldProblem !== null ? (
          <p className="field-error" role="alert" id={`${fieldId}-error`}>
            {fieldProblem}
          </p>
        ) : null}
        <div className="row">
          <button type="submit" className="button" disabled={saving}>
            저장
          </button>
        </div>
        {saved ? (
          <p className="notice" role="status">
            저장했어요.
          </p>
        ) : null}
      </form>
      <div className="row">
        <button type="button" className="button" onClick={() => setAsking(true)}>
          끄기
        </button>
      </div>
      {asking ? (
        <Modal
          title="틱톡 연결 끄기"
          onClose={() => setAsking(false)}
          actions={
            <button type="button" className="button button-danger" disabled={offBusy} onClick={() => void turnOff()}>
              끄기
            </button>
          }
        >
          <p>{TIKTOK_OFF_QUESTION}</p>
          {offError !== null ? <ErrorNote error={offError} /> : null}
        </Modal>
      ) : null}
    </div>
  )
}
