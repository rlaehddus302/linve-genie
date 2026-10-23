// 크롬 확장 연결 (X1 YT-10 AC4·AC7·AC8, D-X1-07·08·11·12).
// - 설정의 "크롬 확장" 칸(판매자만): "확장 연결" → 8자리 일회용 코드(10분, 한 번만). 연결되면 "다시 만들기"(앞 연결을 바로 끊고 새 코드)·"끊기".
// - 콘솔: 경고 한 줄(오지 않음·숨은 탭·읽지 못함 + "주문은 손으로 넣어 주세요" + 문자찜 입력으로 가는 버튼)과 유튜브 칸의 받는 경로 한 줄.
// - 상태는 SSE `extension`으로 바로 바뀌고, 끊겼다 다시 붙으면 다시 읽는다. 서버 상태 값(영어)은 보이지 않고 서버 문장만 보인다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, post, type ApiError } from '../api/client.ts'
import type { CollectorView, ExtensionCode, ExtensionView } from '../api/types.ts'
import {
  EXTENSION_CODE_EXPIRED,
  EXTENSION_CODE_HELP,
  EXTENSION_DISCONNECT_QUESTION,
  EXTENSION_DROPPED,
  EXTENSION_INTRO,
  EXTENSION_RENEW_QUESTION,
  codeWords,
  extensionOnBroadcast,
  extensionWarning,
  routeWords,
} from '../lib/extension.ts'
import { kstClockWords, kstDateTimeWords } from '../lib/kst.ts'
import { useLiveEvents } from '../lib/live-events.ts'
import { routePath, type Navigate } from '../lib/router.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

export interface ExtensionHandle {
  readonly view: ExtensionView | null
  readonly error: ApiError | null
  readonly reload: () => Promise<void>
  readonly set: (view: ExtensionView) => void
}

/** 확장 상태 (GET /api/extension + SSE `extension`). 보조자(403)면 조용히 비운다 */
export function useExtension(enabled = true): ExtensionHandle {
  const [view, setView] = useState<ExtensionView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const version = useRef(0)
  const reload = useCallback(async () => {
    const mine = ++version.current
    try {
      const { extension } = await get<{ extension: ExtensionView }>('/api/extension')
      if (mine !== version.current) return
      setView(extension)
      setError(null)
    } catch (caught) {
      if (!isApiError(caught) || mine !== version.current) return
      if (caught.status === 403 || caught.status === 404) setView(null)
      else setError(caught)
    }
  }, [])
  const set = useCallback((next: ExtensionView) => {
    version.current++
    setView(next)
    setError(null)
  }, [])
  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])
  useLiveEvents({ onExtension: set, onReconnect: () => void reload() }, enabled)
  return { view, error, reload, set }
}

// ── 설정 ────────────────────────────────────────────────────────────────

type Ask = 'renew' | 'disconnect' | null

export function ExtensionSettings({ handle }: { readonly handle: ExtensionHandle }) {
  const { view } = handle
  const [code, setCode] = useState<ExtensionCode | null>(null)
  const [expired, setExpired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const [justConnected, setJustConnected] = useState(false)
  const wasConnected = useRef<boolean | null>(null)

  // 코드를 띄운 동안 확장이 연결되면 코드를 내리고 알린다
  useEffect(() => {
    if (view === null) return
    if (wasConnected.current === false && view.connected && code !== null) {
      setCode(null)
      setJustConnected(true)
    }
    wasConnected.current = view.connected
  }, [view, code])

  // 10분이 지나면 코드를 흐리게 하고 새로 받으라고
  useEffect(() => {
    if (code === null) return
    setExpired(false)
    const left = Date.parse(code.expiresAt) - Date.now()
    if (!Number.isFinite(left)) return
    const timer = setTimeout(() => setExpired(true), Math.max(0, left))
    return () => clearTimeout(timer)
  }, [code])

  const issue = async (path: '/api/extension/code' | '/api/extension/renew') => {
    if (busy) return
    setBusy(true)
    setError(null)
    setJustConnected(false)
    try {
      const next = await post<ExtensionCode>(path, {})
      setCode(next)
      if (path === '/api/extension/renew') {
        wasConnected.current = false
        void handle.reload()
      }
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
      setAsk(null)
    }
  }

  const disconnect = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { extension } = await post<{ extension: ExtensionView }>('/api/extension/disconnect', {})
      handle.set(extension)
      setCode(null)
      setJustConnected(false)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
      setAsk(null)
    }
  }

  if (view === null) {
    if (handle.error !== null) return <ErrorNote error={handle.error} onRetry={() => void handle.reload()} retryLabel="다시 불러오기" />
    return <p role="status">불러오는 중…</p>
  }

  return (
    <div className="stack-tight extension-settings">
      <p>{EXTENSION_INTRO}</p>
      {view.connected ? (
        <div className="stack-tight" role="group" aria-label="확장 연결 상태">
          <p>
            <strong className="state-ok">● 확장이 연결돼 있어요</strong>
            {view.connectedAt !== null ? ` (${kstDateTimeWords(view.connectedAt)}에 연결)` : ''}
          </p>
          {view.message !== null ? <p className={extensionWarning(view) ? 'warning' : undefined}>{extensionWarning(view) ? `! ${view.message}` : view.message}</p> : null}
          {view.lastChatAt !== null ? <p>마지막으로 받은 채팅 {kstClockWords(view.lastChatAt)}</p> : null}
          {view.dropped > 0 ? <p className="warning">! {EXTENSION_DROPPED}</p> : null}
        </div>
      ) : (
        <p>
          <strong>연결된 확장이 없어요.</strong>
        </p>
      )}
      {justConnected ? (
        <p className="notice" role="status">
          확장이 연결됐어요.
        </p>
      ) : null}
      {code !== null ? (
        <div className="extension-code stack-tight" role="group" aria-label="연결 코드">
          <p className={expired ? 'extension-code-value expired' : 'extension-code-value'} aria-label={`연결 코드 ${code.code.split('').join(' ')}`}>
            {codeWords(code.code)}
          </p>
          {expired ? (
            <p className="warning" role="status">
              ! {EXTENSION_CODE_EXPIRED}
            </p>
          ) : (
            <p role="status">
              {EXTENSION_CODE_HELP} ({kstClockWords(code.expiresAt)}까지)
            </p>
          )}
        </div>
      ) : null}
      {error !== null ? <ErrorNote error={error} /> : null}
      <div className="row">
        {view.connected ? (
          <>
            <button type="button" className="button" disabled={busy} onClick={() => setAsk('renew')}>
              다시 만들기
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => setAsk('disconnect')}>
              끊기
            </button>
          </>
        ) : (
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void issue('/api/extension/code')}>
            {code === null ? '확장 연결' : '새 코드 받기'}
          </button>
        )}
      </div>
      {ask === 'renew' ? (
        <Modal
          title="확장 연결을 다시 만들까요?"
          onClose={() => setAsk(null)}
          closeLabel="그대로 두기"
          actions={
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void issue('/api/extension/renew')}>
              다시 만들기
            </button>
          }
        >
          <p>{EXTENSION_RENEW_QUESTION}</p>
        </Modal>
      ) : null}
      {ask === 'disconnect' ? (
        <Modal
          title="확장 연결을 끊을까요?"
          onClose={() => setAsk(null)}
          closeLabel="그대로 두기"
          actions={
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void disconnect()}>
              끊기
            </button>
          }
        >
          <p>{EXTENSION_DISCONNECT_QUESTION}</p>
        </Modal>
      ) : null}
    </div>
  )
}

// ── 콘솔 ────────────────────────────────────────────────────────────────

/** 콘솔 고정 영역의 확장 경고 한 줄 (AC7·AC8) — 이 방송에 이어진 확장이 경고 상태일 때만. 포커스를 빼앗지 않는다 */
export function ExtensionWarningBar({ view, broadcastId, ended, navigate }: { readonly view: ExtensionView | null; readonly broadcastId: string; readonly ended: boolean; readonly navigate: Navigate }) {
  if (ended || !extensionWarning(view) || !extensionOnBroadcast(view, broadcastId) || view === null) return null
  return (
    <div className="connection-banner collector-warning extension-warning" role="alert">
      <span>
        ! {view.message} — {view.manual}
      </span>
      <a
        className="button"
        href={routePath({ name: 'sms' })}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey) return
          event.preventDefault()
          navigate({ name: 'sms' })
        }}
      >
        손으로 넣기
      </a>
    </div>
  )
}

/** 유튜브 칸의 받는 경로 한 줄 (AC8): 공식 연결로 / 확장으로 / 둘 다로 받는 중 */
export function ExtensionRouteLine({ collector, view, broadcastId }: { readonly collector: CollectorView | null; readonly view: ExtensionView | null; readonly broadcastId: string }) {
  const words = routeWords(collector, view, broadcastId)
  const warning = extensionOnBroadcast(view, broadcastId) && extensionWarning(view)
  if (words === null && !warning) return null
  return (
    <div className="stack-tight extension-route" role="group" aria-label="채팅 받는 길">
      {words !== null ? (
        <p>
          <strong className="state-ok">● {words}</strong>
        </p>
      ) : null}
      {warning && view !== null ? (
        <p className="warning">
          ! {view.message} — {view.manual}
        </p>
      ) : null}
      {view !== null && extensionOnBroadcast(view, broadcastId) && view.dropped > 0 ? <p className="warning">! {EXTENSION_DROPPED}</p> : null}
    </div>
  )
}
