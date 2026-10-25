// 설정의 "네이버 밴드" 칸 (SPEC §7 화면 8, PLT-04, D-BND1-11·15, AC-BND1-70) — 인스타그램 칸과 같은 모양.
// - 설정 없음이면 서버 문장만. 아니면 상태("연결됨 — {프로필 이름}"·"연결 안 됨"·서버의 다시 연결 문장), "밴드 연결하기"(다시 연결도 같은 단추 —
//   서버가 준 주소로 같은 탭 최상위 이동), "연결 끊기"(확인 창 — 같은 요청 번호로 다시 보내도 한 번).
// - 밴드에서 돌아온 결과(`?band=`)는 이 칸에서 한 번 보이고, 설정 화면이 주소에서 지운다(새로 고침해도 다시 나오지 않음).
// - 보조자에게는 이 칸이 없다(설정 화면이 그리지 않는다 — 경로도 403).
// - 실시간: SSE `band` ACCOUNT로 바로 바뀐다(다른 기기에서 연결·끊기). 다시 붙으면 설정 화면이 다시 받는다.
// 서버 문장은 고치지 않고 글자 그대로 보인다. 프로필 이름은 글자로만 보인다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { BandAccount } from '../api/types.ts'
import { BAND_CONNECT, BAND_DISCONNECT, BAND_DISCONNECT_HINT, BAND_DISCONNECT_QUESTION, bandAccountWords, bandCallbackMessage, bandCallbackSucceeded } from '../lib/band.ts'
import { goToGoogle } from '../lib/google-return.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

export type BandState = { readonly phase: 'loading' } | { readonly phase: 'error'; readonly error: ApiError } | { readonly phase: 'ready'; readonly account: BandAccount }

export interface BandHandle {
  readonly state: BandState
  readonly reload: () => Promise<void>
  readonly set: (account: BandAccount) => void
}

/** 밴드 계정 연결 (GET /api/band) */
export function useBandAccount(enabled = true): BandHandle {
  const [state, setState] = useState<BandState>({ phase: 'loading' })
  const version = useRef(0)
  const reload = useCallback(async () => {
    const mine = ++version.current
    try {
      const { band } = await get<{ band: BandAccount }>('/api/band')
      if (mine === version.current) setState({ phase: 'ready', account: band })
    } catch (error) {
      if (isApiError(error) && mine === version.current) setState({ phase: 'error', error })
    }
  }, [])
  const set = useCallback((account: BandAccount) => {
    version.current++
    setState({ phase: 'ready', account })
  }, [])
  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])
  return { state, reload, set }
}

/** 밴드에서 돌아온 결과 문장 (한 번 — 상태 영역) */
export function BandCallbackResult({ code }: { readonly code: string | null }) {
  if (code === null) return null
  return (
    <p className={bandCallbackSucceeded(code) ? 'notice' : 'warning'} role="status">
      {bandCallbackMessage(code)}
    </p>
  )
}

export function BandSettings({ handle }: { readonly handle: BandHandle }) {
  const { state } = handle
  if (state.phase === 'loading') return <p role="status">불러오는 중…</p>
  if (state.phase === 'error') return <ErrorNote error={state.error} onRetry={() => void handle.reload()} retryLabel="다시 불러오기" />
  return <BandReady account={state.account} onChanged={handle.set} />
}

function BandReady({ account, onChanged }: { readonly account: BandAccount; readonly onChanged: (account: BandAccount) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [asking, setAsking] = useState(false)
  // 끊기는 같은 요청 번호로 (응답을 못 받아 다시 눌러도 한 번)
  const pending = useRef<string | null>(null)

  if (account.status === 'NOT_CONFIGURED') return <p>{account.message ?? ''}</p>

  const connect = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { url } = await post<{ url: string }>('/api/band/connect', {})
      goToGoogle(url)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (busy) return
    pending.current ??= newRequestId()
    const requestId = pending.current
    setBusy(true)
    setError(null)
    try {
      const result = await withRetry(() => post<{ band: BandAccount }>('/api/band/disconnect', { requestId }))
      pending.current = null
      setAsking(false)
      onChanged(result.band)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.retryable) pending.current = null
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  const { status } = account
  return (
    <div className="stack band-settings">
      <p className={status === 'RECONNECT_NEEDED' ? 'warning' : undefined}>
        <strong>{bandAccountWords(account)}</strong>
      </p>
      <div className="row">
        {/* 설정 화면은 칸마다 버튼이 있어 주 버튼을 두지 않는다 (인스타그램 칸과 같은 기준) */}
        <button type="button" className="button" disabled={busy} onClick={() => void connect()}>
          {BAND_CONNECT}
        </button>
        {status !== 'NOT_CONNECTED' ? (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setError(null)
              setAsking(true)
            }}
          >
            {BAND_DISCONNECT}
          </button>
        ) : null}
      </div>
      {error !== null && !asking ? <ErrorNote error={error} /> : null}
      {asking ? (
        <Modal
          title="밴드 연결 끊기"
          onClose={() => {
            setAsking(false)
            setError(null)
          }}
          actions={
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void disconnect()}>
              끊기
            </button>
          }
        >
          <p>{BAND_DISCONNECT_QUESTION}</p>
          <p>{BAND_DISCONNECT_HINT}</p>
          {error !== null ? <ErrorNote error={error} /> : null}
        </Modal>
      ) : null}
    </div>
  )
}
