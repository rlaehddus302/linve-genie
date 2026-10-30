// 설정 "휴대폰 알림 받기" (SMS3 ORD-13 C-02, D-SMS3-04·14, AC-SMS3-28) — 판매자만(보조자는 칸이 없다).
// - 꺼짐: "켜고 토큰 만들기". 켜짐: 마지막으로 받은 시각·기기 이름, "토큰 다시 만들기"(확인 창), "끄기"(확인 창).
// - 토큰은 만든 응답에서만 한 번 보인다 — "복사하기". 화면을 떠나면 다시 볼 수 없다(서버는 해시만 둔다). 저장소·주소에 남기지 않는다.
// - 아이폰 단축어 만들기 안내는 접는 칸(링크 모양 단추)으로.
// - 상태는 SSE `inbox`(settings·received)와 다시 붙음에 다시 읽는다.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { isApiError, type ApiError } from '../api/client.ts'
import type { InboxSettingsView } from '../api/inbox-types.ts'
import {
  INBOX_ANDROID_HINT,
  INBOX_COPIED,
  INBOX_COPY,
  INBOX_COPY_ADDRESS,
  INBOX_COPY_FAILED,
  INBOX_COPY_FAILED_ANY,
  INBOX_COPY_HEADER,
  INBOX_COPIED_ADDRESS,
  INBOX_COPIED_HEADER,
  INBOX_INSTANT,
  INBOX_INTRO,
  INBOX_IPHONE_FIRST,
  INBOX_IPHONE_HINT,
  INBOX_VALUE_NOTE,
  INBOX_OFF,
  INBOX_OFF_NEW,
  INBOX_OFF_CONFIRM,
  INBOX_OFF_QUESTION,
  INBOX_ON,
  INBOX_RENEW,
  INBOX_RENEW_CONFIRM,
  INBOX_RENEW_QUESTION,
  INBOX_SHORTCUT_LINK,
  INBOX_SHORTCUT_STEPS,
  shortcutStepParts,
  INBOX_TOKEN_ONCE,
  INBOX_TURN_OFF,
  INBOX_TURN_ON,
  INBOX_TURN_ON_AGAIN,
  createInboxToken,
  setInboxEnabled,
  fetchInboxSettings,
  lastReceivedWords,
  readStaleNotice,
} from '../lib/inbox.ts'
import { useLiveEvents } from '../lib/live-events.ts'
import { copyText } from '../lib/receipt-links.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import { DetailToggle } from './RuleFields.tsx'
import { InboxStaleBar } from './SmsInbox.tsx'

/** 단축어가 보낼 받는 주소 */
export function inboxAddress(origin: string = typeof location === 'undefined' ? '' : location.origin): string {
  return `${origin}/api/inbox/messages`
}

export interface InboxSettingsHandle {
  readonly view: InboxSettingsView | null
  readonly error: ApiError | null
  /** 서버에 이 칸이 없다(옛 서버 404·보조자 403) — 칸을 그리지 않는다 */
  readonly missing: boolean
  readonly reload: () => Promise<void>
  readonly set: (view: InboxSettingsView) => void
}

export function useInboxSettings(enabled = true): InboxSettingsHandle {
  const [view, setView] = useState<InboxSettingsView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [missing, setMissing] = useState(false)
  const version = useRef(0)
  const reload = useCallback(async () => {
    const mine = ++version.current
    try {
      const next = await fetchInboxSettings()
      if (mine !== version.current) return
      setView(next)
      setError(null)
      setMissing(false)
    } catch (caught) {
      if (!isApiError(caught) || mine !== version.current) return
      if (caught.status === 403 || caught.status === 404) setMissing(true)
      else setError(caught)
    }
  }, [])
  const set = useCallback((next: InboxSettingsView) => {
    version.current++
    setView(next)
    setError(null)
  }, [])
  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])
  useLiveEvents(
    {
      onInbox: (event) => {
        if (event.kind === 'settings') void reload()
        else if (event.kind === 'received') {
          // 무엇이든 받으면 마지막으로 받은 시각·기기만 바꾼다(다시 묻지 않는다)
          version.current++
          setView((current) => (current === null ? current : { ...current, lastReceivedAt: event.lastReceivedAt ?? current.lastReceivedAt, lastDevice: event.lastDevice ?? current.lastDevice }))
        }
      },
      onReconnect: () => void reload(),
    },
    enabled,
  )
  return { view, error, missing, reload, set }
}

type Ask = 'renew' | 'off' | null
/** 무엇을 복사했나 — 토큰·받는 주소·헤더 값("Bearer " + 토큰) */
type Copied = { readonly what: 'token' | 'address' | 'header'; readonly ok: boolean }

const COPIED_WORDS: Readonly<Record<Copied['what'], string>> = { token: INBOX_COPIED, address: INBOX_COPIED_ADDRESS, header: INBOX_COPIED_HEADER }

export function PhoneInboxSettings({ handle }: { readonly handle: InboxSettingsHandle }) {
  const { view } = handle
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const [copied, setCopied] = useState<Copied | null>(null)
  const [guide, setGuide] = useState(false)
  const guideId = useId()
  const tokenId = useId()

  const issue = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setCopied(null)
    try {
      const result = await createInboxToken()
      setToken(result.token)
      handle.set(result.inbox)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
      setAsk(null)
    }
  }

  const toggle = async (enabled: boolean) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      handle.set(await setInboxEnabled(enabled))
      if (!enabled) {
        setToken(null)
        setCopied(null)
      }
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
      setAsk(null)
    }
  }

  const copy = async (what: Copied['what']) => {
    const text = what === 'address' ? inboxAddress() : token === null ? null : what === 'header' ? `Bearer ${token}` : token
    if (text === null) return
    setCopied({ what, ok: await copyText(text) })
  }
  const copiedNote =
    copied === null ? null : (
      <p role="status" className={copied.ok ? undefined : 'warning'}>
        {copied.ok ? COPIED_WORDS[copied.what] : copied.what === 'token' ? INBOX_COPY_FAILED : INBOX_COPY_FAILED_ANY}
      </p>
    )

  if (view === null) {
    if (handle.error !== null) return <ErrorNote error={handle.error} onRetry={() => void handle.reload()} retryLabel="다시 불러오기" />
    return <p role="status">불러오는 중…</p>
  }

  return (
    <div className="stack-tight inbox-settings">
      <p>{INBOX_INTRO}</p>
      {/* 이 칸은 누르면 바로 바뀐다 — 설정 아래 고정 "저장" 줄과 헷갈리지 않게 (UX-SMS3-011) */}
      <p className="hint">{INBOX_INSTANT}</p>
      <div className="stack-tight" role="group" aria-label="휴대폰 알림 받기 상태">
        <p>
          {view.enabled ? <strong className="state-ok">● {INBOX_ON}</strong> : <strong>○ {view.hasToken ? INBOX_OFF : INBOX_OFF_NEW}</strong>}
        </p>
        {view.enabled || view.lastReceivedAt !== null ? <p>{lastReceivedWords(view)}</p> : null}
        <InboxStaleBar stale={readStaleNotice(view.staleBroadcast)} banner={false} onClosed={(next) => (next === null ? void handle.reload() : handle.set(next))} />
      </div>
      {token !== null ? (
        <div className="inbox-token stack-tight" role="group" aria-label="새로 만든 받기 토큰">
          <label htmlFor={tokenId}>받기 토큰</label>
          {/* 여러 줄 칸 — 375px에서도 43자가 잘리지 않고 줄을 바꿔 다 보인다 (UX-SMS3-002) */}
          <textarea
            id={tokenId}
            className="input inbox-token-value"
            readOnly
            rows={2}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={token}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="warning">! {INBOX_TOKEN_ONCE}</p>
          <div className="row">
            <button type="button" className="button button-primary" onClick={() => void copy('token')}>
              {INBOX_COPY}
            </button>
            {/* 아이폰 단축어 헤더 값 — "Bearer " + 토큰을 한 번에 (띄어쓰기 실수 없이) */}
            <button type="button" className="button" onClick={() => void copy('header')}>
              {INBOX_COPY_HEADER}
            </button>
          </div>
          {copied?.what === 'address' ? null : copiedNote}
        </div>
      ) : null}
      {error !== null ? <ErrorNote error={error} /> : null}
      <div className="row">
        {view.enabled ? (
          <>
            <button type="button" className="button" disabled={busy} onClick={() => setAsk('renew')}>
              {INBOX_RENEW}
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => setAsk('off')}>
              {INBOX_TURN_OFF}
            </button>
          </>
        ) : view.hasToken ? (
          <>
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void toggle(true)}>
              {INBOX_TURN_ON_AGAIN}
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => setAsk('renew')}>
              {INBOX_RENEW}
            </button>
          </>
        ) : (
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void issue()}>
            {INBOX_TURN_ON}
          </button>
        )}
      </div>
      <p className="hint">{INBOX_ANDROID_HINT}</p>
      <p className="hint">{INBOX_IPHONE_HINT}</p>
      <div>
        <DetailToggle label={INBOX_SHORTCUT_LINK} open={guide} controls={guideId} onToggle={() => setGuide(!guide)} />
      </div>
      <div id={guideId} className="stack-tight inbox-shortcut" hidden={!guide}>
        <p>
          <strong>{INBOX_IPHONE_FIRST}</strong>
        </p>
        <div className="stack-tight">
          <p>
            받는 주소: <code className="inbox-address">{inboxAddress()}</code>
          </p>
          <div className="row">
            <button type="button" className="button" onClick={() => void copy('address')}>
              {INBOX_COPY_ADDRESS}
            </button>
          </div>
          {copied?.what === 'address' ? copiedNote : null}
        </div>
        <p className="hint">{INBOX_VALUE_NOTE}</p>
        <ol>
          {INBOX_SHORTCUT_STEPS.map((step) => (
            <li key={step}>
              {shortcutStepParts(step).map((part, index) => (part.value ? <code key={index}>{part.text}</code> : <span key={index}>{part.text}</span>))}
            </li>
          ))}
        </ol>
      </div>
      {ask === 'renew' ? (
        <Modal
          title="토큰을 다시 만들까요?"
          onClose={() => setAsk(null)}
          closeLabel="그대로 두기"
          actions={
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void issue()}>
              {INBOX_RENEW_CONFIRM}
            </button>
          }
        >
          <p>{INBOX_RENEW_QUESTION}</p>
        </Modal>
      ) : null}
      {ask === 'off' ? (
        <Modal
          title="휴대폰 알림 받기를 끌까요?"
          onClose={() => setAsk(null)}
          closeLabel="그대로 두기"
          actions={
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void toggle(false)}>
              {INBOX_OFF_CONFIRM}
            </button>
          }
        >
          <p>{INBOX_OFF_QUESTION}</p>
        </Modal>
      ) : null}
    </div>
  )
}
