// 콘솔의 유튜브 (YT-02·03·06·08, D-I3-04~07, AC-I3-20~27·30~35·38).
// - 유튜브 칸(스크롤 영역): 잇기(내 라이브 목록·주소 붙여넣기)·잇기 해제·수집 상태·다시 받기·사용량 안내·시청자 알림·"감사 메시지" 버튼.
// - 고정 영역: 수집 멈춤 경고 한 줄(다시 연결하는 중은 10초 넘게 이어질 때만), 사용량 모드가 바뀌면 한 번 띄우는 알림 문장.
// - 알림 띠 "감사 실패 n"(판매자가 할 일이 있는 실패만)과 감사 메시지 목록(다시 보내기·확인하지 못한 감사·올라가 있어요·알림에서 빼기).
// - 실시간: 범위 저장소의 같은 연결로 SSE `youtube`를 받는다(연결·수집·발송함·사용량·알림). 끊겼다 이어지면 모두 다시 받는다.
// - 리허설 방송은 유튜브 요청을 보내지 않는다. 준비 안 된 서버(503)면 안내 한 줄만 보이고 다른 유튜브 요청을 보내지 않는다.
// 서버 문장(수집 상태·사유·오류)은 고치지 않고 그대로 보인다. 채널 이름·방송 제목·시청자 이름·글은 글자로만 보인다.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { LinkView, LiveBroadcastItem, OutboxRow, QuotaView, YoutubeConnection, YoutubeNotice } from '../api/types.ts'
import type { ConsoleStore } from '../lib/console-store.ts'
import { goToGoogle } from '../lib/google-return.ts'
import { kstClockWords, kstDateTimeWords } from '../lib/kst.ts'
import { groupDigits } from '../lib/money.ts'
import { routePath, type Navigate } from '../lib/router.ts'
import {
  CONSOLE_NOT_CONNECTED,
  NOT_CONFIGURED_MESSAGE,
  NOT_MY_CHANNEL_HINT,
  NOT_MY_CHANNEL_MESSAGE,
  NO_PERMISSION_DIALOG,
  QUOTA_MODE_SENTENCE,
  RECONNECT_NEEDED_MESSAGE,
  REHEARSAL_OUTBOX,
  REHEARSAL_YOUTUBE,
  RETRYING_WARN_MS,
  SEALED_READ_ONLY,
  TARGET_WORD,
  collectorWarning,
  hasChannel,
  needsAttention,
  outboxGroups,
  productNo,
  quotaChangeNotice,
  thanksFailedCount,
  unconfirmedWarning,
} from '../lib/youtube.ts'
import { openBlockAction } from './actions.ts'
import { useConsoleApi } from './console-context.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import type { ConnectionState } from './YoutubeConnection.tsx'
import { SERVICE_NAME } from '../brand.ts'

/** 사용량 모드 알림을 보이는 시간 */
const TOAST_MS = 10_000
/** 새 채팅이 들어오면 받은 수를 다시 받기까지 (모아서 한 번) */
const LINK_REFRESH_MS = 700
/** 발송함 알림이 몰리면 모아서 한 번 */
const OUTBOX_REFRESH_MS = 250

export const LIVE_LIST_EMPTY = '진행 중이거나 예정인 라이브가 없어요. 유튜브 스튜디오에서 라이브를 먼저 만들어 주세요.'
export const OTHER_BROADCAST = '다른 방송에 이어져 있어요'
export const UNLINK_QUESTION = '끊으면 이 방송의 채팅을 더 받지 않아요. 이미 받은 찜은 그대로예요.'
export const CHAT_ENDED_NOTE = '유튜브 채팅이 끝났어요.'

export interface ConsoleYoutubeInput {
  readonly store: ConsoleStore
  readonly broadcastId: string
  readonly date: string
  readonly rehearsal: boolean
  /** 그 방송의 마지막 메시지 seq (새 채팅이 오면 받은 수를 다시 받는다) */
  readonly lastMessageSeq: number
}

export interface ResendOutcome {
  /** 글쓰기 권한을 받으러 갈 승인 주소 (409 NO_PERMISSION) */
  readonly authorizeUrl?: string
}

export interface ConsoleYoutube {
  readonly enabled: boolean
  readonly connection: ConnectionState
  readonly link: LinkView | null
  readonly linkError: ApiError | null
  readonly quota: QuotaView | null
  readonly notices: readonly YoutubeNotice[]
  readonly outbox: readonly OutboxRow[]
  readonly thanksFailed: number
  readonly toast: string | null
  readonly retryingLong: boolean
  /** 감사 메시지 줄마다 보내는 중·오류 */
  readonly rowBusy: ReadonlySet<number>
  readonly rowErrors: ReadonlyMap<number, ApiError>
  setLink(view: LinkView): void
  reloadLink(): Promise<void>
  reloadOutbox(): Promise<void>
  resend(row: OutboxRow): Promise<ResendOutcome>
  confirmPosted(row: OutboxRow): Promise<void>
  dismiss(row: OutboxRow): Promise<void>
  unlink(): Promise<void>
  restart(): Promise<void>
}

export const YoutubeContext = createContext<ConsoleYoutube | null>(null)

export function useYoutube(): ConsoleYoutube {
  const value = useContext(YoutubeContext)
  if (value === null) throw new Error('콘솔 밖에서 쓸 수 없다')
  return value
}

const byId = (rows: readonly OutboxRow[]) => new Map(rows.map((row) => [row.id, row]))

export function useConsoleYoutube({ store, broadcastId, date, rehearsal, lastMessageSeq }: ConsoleYoutubeInput): ConsoleYoutube {
  const enabled = !rehearsal
  const [connection, setConnection] = useState<ConnectionState>({ phase: 'loading' })
  const [link, setLinkState] = useState<LinkView | null>(null)
  const [linkError, setLinkError] = useState<ApiError | null>(null)
  const [quota, setQuota] = useState<QuotaView | null>(null)
  const [notices, setNotices] = useState<readonly YoutubeNotice[]>([])
  const [outbox, setOutbox] = useState<readonly OutboxRow[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [retryingLong, setRetryingLong] = useState(false)
  const [rowBusy, setRowBusy] = useState<ReadonlySet<number>>(new Set())
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<number, ApiError>>(new Map())
  const alive = useRef(true)
  const mode = useRef<QuotaView['mode'] | null>(null)
  const configured = useRef(false)
  const outboxTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const linkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const resendIds = useRef(new Map<number, string>())
  const confirmIds = useRef(new Map<number, string>())
  const linkVersion = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(outboxTimer.current)
      clearTimeout(linkTimer.current)
      clearTimeout(toastTimer.current)
    }
  }, [])

  const setLink = useCallback((view: LinkView) => {
    linkVersion.current++
    setLinkState(view)
    setLinkError(null)
  }, [])

  const reloadLink = useCallback(async () => {
    const version = ++linkVersion.current
    try {
      const view = await get<LinkView>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/youtube`)
      if (alive.current && version === linkVersion.current) {
        setLinkState(view)
        setLinkError(null)
      }
    } catch (error) {
      if (alive.current && isApiError(error) && version === linkVersion.current) setLinkError(error)
    }
  }, [broadcastId])

  const reloadQuota = useCallback(async () => {
    try {
      const { quota: view } = await get<{ quota: QuotaView }>('/api/youtube/quota')
      if (!alive.current) return
      if (mode.current === null) mode.current = view.mode
      setQuota(view)
    } catch {
      // 사용량을 받지 못하면 숨긴다
    }
  }, [])

  const reloadOutbox = useCallback(async () => {
    try {
      const { rows } = await get<{ rows: OutboxRow[] }>(`/api/days/${date}/outbox`)
      if (alive.current) setOutbox(rows)
    } catch {
      // 다음 알림·다시 붙을 때 다시 받는다
    }
  }, [date])

  const reloadNotices = useCallback(async () => {
    try {
      const { notices: list } = await get<{ notices: YoutubeNotice[] }>(`/api/days/${date}/youtube-notices`)
      if (alive.current) setNotices(list)
    } catch {
      // 다음 알림·다시 붙을 때 다시 받는다
    }
  }, [date])

  /** 연결 → (준비된 서버면) 잇기 상태·발송함·알림·사용량 */
  const loadAll = useCallback(async () => {
    let current: YoutubeConnection
    try {
      const result = await get<{ connection: YoutubeConnection }>('/api/youtube/connection')
      current = result.connection
      if (!alive.current) return
      configured.current = true
      setConnection({ phase: 'ready', connection: current })
    } catch (error) {
      if (!alive.current || !isApiError(error)) return
      if (error.code === 'YOUTUBE_NOT_CONFIGURED') {
        configured.current = false
        setConnection({ phase: 'notConfigured' })
        return
      }
      setConnection({ phase: 'error', error })
      return
    }
    await Promise.all([reloadLink(), reloadOutbox(), reloadNotices(), hasChannel(current) ? reloadQuota() : Promise.resolve()])
  }, [reloadLink, reloadNotices, reloadOutbox, reloadQuota])

  useEffect(() => {
    if (enabled) void loadAll()
  }, [enabled, loadAll])

  const scheduleOutbox = useCallback(() => {
    clearTimeout(outboxTimer.current)
    outboxTimer.current = setTimeout(() => void reloadOutbox(), OUTBOX_REFRESH_MS)
  }, [reloadOutbox])

  // 실시간 알림 (같은 연결) — 다른 기기에서 바꾼 것도 1초 안에
  useEffect(() => {
    if (!enabled) return
    const offYoutube = store.onYoutube((event) => {
      switch (event.kind) {
        case 'connection': {
          configured.current = true
          setConnection({ phase: 'ready', connection: event.connection })
          if (hasChannel(event.connection)) void reloadQuota()
          return
        }
        case 'collector':
          if (event.broadcast !== broadcastId) return
          linkVersion.current++
          setLinkState((current) => (current === null ? current : { ...current, collector: event.collector }))
          // 잇기 자체가 바뀌었을 수 있다(다른 기기에서 끊기 등) — 잇기 상태도 다시 받는다
          void reloadLink()
          return
        case 'outbox':
          if (event.date === date) scheduleOutbox()
          return
        case 'quota': {
          const notice = quotaChangeNotice(mode.current, event.mode)
          mode.current = event.mode
          setQuota((current) => (current === null ? current : { ...current, mode: event.mode }))
          void reloadQuota()
          if (notice !== null) {
            setToast(notice)
            clearTimeout(toastTimer.current)
            toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
          }
          return
        }
        case 'notice':
          if (event.date !== date) return
          setNotices((list) => (list.some((item) => item.id === event.notice.id) ? list : [...list, event.notice]))
          return
        case 'sealed':
          if (event.date === date) scheduleOutbox()
          return
      }
    })
    const offReconnect = store.onReconnect(() => void loadAll())
    return () => {
      offYoutube()
      offReconnect()
    }
  }, [store, enabled, broadcastId, date, loadAll, reloadLink, reloadQuota, scheduleOutbox])

  // 새 채팅이 들어오면 받은 수·마지막 채팅을 다시 받는다 (모아서 한 번 — 받는 사이에 또 오면 끝난 뒤 한 번 더)
  const hasLink = link?.link !== null && link?.link !== undefined
  const linkAgain = useRef(false)
  useEffect(() => {
    if (!enabled || !hasLink || lastMessageSeq === 0) return
    if (linkTimer.current !== undefined) {
      linkAgain.current = true
      return
    }
    const fire = () => {
      linkTimer.current = setTimeout(() => {
        linkAgain.current = false
        void reloadLink().finally(() => {
          if (linkAgain.current && alive.current) fire()
          else linkTimer.current = undefined
        })
      }, LINK_REFRESH_MS)
    }
    fire()
  }, [enabled, hasLink, lastMessageSeq, reloadLink])

  // "다시 연결하는 중"이 10초 넘게 이어지면 경고 (그 안에 받는 중이 되면 띄우지 않는다)
  const collectorStatus = link?.collector?.status ?? null
  useEffect(() => {
    if (collectorStatus !== 'RETRYING') {
      setRetryingLong(false)
      return
    }
    const timer = setTimeout(() => setRetryingLong(true), RETRYING_WARN_MS)
    return () => clearTimeout(timer)
  }, [collectorStatus])

  const updateRows = useCallback((rows: readonly OutboxRow[]) => {
    const changed = byId(rows)
    setOutbox((current) => current.map((row) => changed.get(row.id) ?? row))
  }, [])

  const busy = (id: number, on: boolean) =>
    setRowBusy((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const failRow = (id: number, error: ApiError | null) =>
    setRowErrors((current) => {
      const next = new Map(current)
      if (error === null) next.delete(id)
      else next.set(id, error)
      return next
    })

  const resend = useCallback(
    async (row: OutboxRow): Promise<ResendOutcome> => {
      const requestId = resendIds.current.get(row.id) ?? newRequestId()
      resendIds.current.set(row.id, requestId)
      busy(row.id, true)
      failRow(row.id, null)
      try {
        const result = await withRetry(() => post<{ row: OutboxRow }>(`/api/outbox/${String(row.id)}/resend`, { requestId }))
        resendIds.current.delete(row.id)
        updateRows([result.row])
        return {}
      } catch (error) {
        if (!isApiError(error)) throw error
        if (!error.retryable) resendIds.current.delete(row.id)
        const changed = error.details.row
        if (typeof changed === 'object' && changed !== null) updateRows([changed as OutboxRow])
        const url = error.details.authorizeUrl
        if (error.code === 'NO_PERMISSION' && typeof url === 'string') return { authorizeUrl: url }
        failRow(row.id, error)
        return {}
      } finally {
        busy(row.id, false)
        scheduleOutbox()
      }
    },
    [scheduleOutbox, updateRows],
  )

  const confirmPosted = useCallback(
    async (row: OutboxRow): Promise<void> => {
      const requestId = confirmIds.current.get(row.id) ?? newRequestId()
      confirmIds.current.set(row.id, requestId)
      busy(row.id, true)
      failRow(row.id, null)
      try {
        const result = await withRetry(() => post<{ rows: OutboxRow[] }>(`/api/outbox/${String(row.id)}/confirm-posted`, { requestId }))
        confirmIds.current.delete(row.id)
        updateRows(result.rows)
      } catch (error) {
        if (!isApiError(error)) throw error
        if (!error.retryable) confirmIds.current.delete(row.id)
        failRow(row.id, error)
      } finally {
        busy(row.id, false)
        scheduleOutbox()
      }
    },
    [scheduleOutbox, updateRows],
  )

  const dismiss = useCallback(
    async (row: OutboxRow): Promise<void> => {
      busy(row.id, true)
      failRow(row.id, null)
      try {
        const result = await withRetry(() => post<{ row: OutboxRow }>(`/api/outbox/${String(row.id)}/dismiss`, {}))
        updateRows([result.row])
      } catch (error) {
        if (!isApiError(error)) throw error
        failRow(row.id, error)
      } finally {
        busy(row.id, false)
        scheduleOutbox()
      }
    },
    [scheduleOutbox, updateRows],
  )

  const unlink = useCallback(async () => {
    const view = await withRetry(() => post<LinkView>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/youtube/unlink`, {}))
    setLink(view)
  }, [broadcastId, setLink])

  const restart = useCallback(async () => {
    const view = await withRetry(() => post<LinkView>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/youtube/collector/restart`, {}))
    setLink(view)
  }, [broadcastId, setLink])

  const thanksFailed = useMemo(() => (enabled ? thanksFailedCount(outbox) : 0), [enabled, outbox])

  return {
    enabled,
    connection,
    link,
    linkError,
    quota,
    notices,
    outbox,
    thanksFailed,
    toast,
    retryingLong,
    rowBusy,
    rowErrors,
    setLink,
    reloadLink,
    reloadOutbox,
    resend,
    confirmPosted,
    dismiss,
    unlink,
    restart,
  }
}

// ── 고정 영역 ──────────────────────────────────────────────────────────

/** 수집 멈춤 경고 한 줄 (AC-I3-25) — 빠른 입력칸의 포커스를 빼앗지 않는다 */
export function CollectorWarningBar({ navigate, ended }: { readonly navigate: Navigate; readonly ended: boolean }) {
  const yt = useYoutube()
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const warning = !yt.enabled || ended ? null : collectorWarning(yt.link?.collector ?? null, yt.retryingLong)
  useEffect(() => {
    if (warning === null) setError(null)
  }, [warning])
  if (warning === null) return null
  const restart = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await yt.restart()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="connection-banner collector-warning" role="alert">
      <span>{warning.message}</span>
      {warning.reconnect ? (
        <a
          className="button"
          href={routePath({ name: 'settings', section: 'youtube' })}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey) return
            event.preventDefault()
            navigate({ name: 'settings', section: 'youtube' })
          }}
        >
          다시 연결하기
        </a>
      ) : null}
      {warning.restartable ? (
        <button type="button" className="button" disabled={busy} onClick={() => void restart()}>
          채팅 다시 받기
        </button>
      ) : null}
      {error !== null ? <span className="field-error">{error.message}</span> : null}
    </div>
  )
}

/** 사용량 모드가 바뀌면 한 번 띄우는 알림 (AC-I3-38) — 화면 낭독기 status, 포커스를 빼앗지 않는다 */
export function QuotaToast() {
  const yt = useYoutube()
  if (yt.toast === null) return null
  return (
    <p className="notice quota-toast" role="status">
      {yt.toast}
    </p>
  )
}

// ── 유튜브 칸 ──────────────────────────────────────────────────────────

export interface YoutubePanelProps {
  readonly navigate: Navigate
  readonly ended: boolean
  readonly sealed: boolean
  readonly onOpenOutbox: () => void
  readonly onUnlink: () => void
}

function SettingsLink({ navigate, children }: { readonly navigate: Navigate; readonly children: string }) {
  return (
    <a
      className="text-link"
      href={routePath({ name: 'settings', section: 'youtube' })}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey) return
        event.preventDefault()
        navigate({ name: 'settings', section: 'youtube' })
      }}
    >
      {children}
    </a>
  )
}

export function YoutubePanel({ navigate, ended, sealed, onOpenOutbox, onUnlink }: YoutubePanelProps) {
  const yt = useYoutube()
  if (!yt.enabled) {
    return (
      <section className="card youtube-panel stack-tight" aria-label="유튜브">
        <h2 className="section-title">유튜브</h2>
        <p>{REHEARSAL_YOUTUBE}</p>
        <div className="row">
          <button type="button" className="button" onClick={onOpenOutbox}>
            감사 메시지
          </button>
        </div>
      </section>
    )
  }
  const { connection } = yt
  return (
    <section className="card youtube-panel stack" aria-label="유튜브">
      <h2 className="section-title">유튜브</h2>
      {connection.phase === 'loading' ? <p role="status">불러오는 중…</p> : null}
      {connection.phase === 'notConfigured' ? <p>{NOT_CONFIGURED_MESSAGE}</p> : null}
      {connection.phase === 'error' ? <ErrorNote error={connection.error} onRetry={() => window.location.reload()} retryLabel="다시 열기" /> : null}
      {connection.phase === 'ready' ? <ReadyPanel connection={connection.connection} navigate={navigate} ended={ended} sealed={sealed} onOpenOutbox={onOpenOutbox} onUnlink={onUnlink} /> : null}
    </section>
  )
}

function ReadyPanel({ connection, navigate, ended, sealed, onOpenOutbox, onUnlink }: Omit<YoutubePanelProps, 'navigate'> & { readonly connection: YoutubeConnection; readonly navigate: Navigate }) {
  const yt = useYoutube()
  const linked = yt.link?.link ?? null
  const writable = !ended && !sealed
  return (
    <>
      {connection.status === 'NOT_CONNECTED' ? (
        <p className="notice">
          {CONSOLE_NOT_CONNECTED} <SettingsLink navigate={navigate}>유튜브 연결하러 가기</SettingsLink>
        </p>
      ) : null}
      {connection.status === 'RECONNECT_NEEDED' ? (
        <p className="warning">
          {RECONNECT_NEEDED_MESSAGE} <SettingsLink navigate={navigate}>유튜브 연결하러 가기</SettingsLink>
        </p>
      ) : null}
      {yt.linkError !== null ? <ErrorNote error={yt.linkError} onRetry={() => void yt.reloadLink()} retryLabel="다시 불러오기" /> : null}
      {yt.link === null && yt.linkError === null ? <p role="status">불러오는 중…</p> : null}
      {yt.link !== null && linked === null ? (
        writable && connection.status === 'CONNECTED' ? <LinkPicker /> : <p>이은 유튜브 방송이 없어요.</p>
      ) : null}
      {linked !== null ? <CollectorStatus writable={writable} onUnlink={onUnlink} /> : null}
      {yt.quota !== null && yt.quota.mode !== 'NORMAL' && hasChannel(connection) ? (
        <p className="warning" role="note">
          {QUOTA_MODE_SENTENCE[yt.quota.mode]}
        </p>
      ) : null}
      <div className="row">
        <button type="button" className="button" onClick={onOpenOutbox}>
          감사 메시지
        </button>
      </div>
      <ViewerNotices sealed={sealed} />
    </>
  )
}

/** 수집 상태 (AC-I3-24) — 서버 문장 그대로, 받는 방식은 보이지 않는다 */
function CollectorStatus({ writable, onUnlink }: { readonly writable: boolean; readonly onUnlink: () => void }) {
  const yt = useYoutube()
  const collector = yt.link?.collector ?? null
  const link = yt.link?.link ?? null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const restart = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await yt.restart()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack-tight collector-status" role="group" aria-label="채팅 수집">
      {link !== null ? <p>이은 유튜브 방송: 영상 {link.videoId}</p> : null}
      {collector === null ? null : (
        <>
          <p>
            <strong>{collector.status === 'CHAT_ENDED' ? CHAT_ENDED_NOTE : collector.statusMessage}</strong>
            {collector.reasonMessage !== null && collector.reasonMessage !== collector.statusMessage ? ` — ${collector.reasonMessage}` : ''}
          </p>
          <p>받은 채팅 {groupDigits(collector.recorded)}개</p>
          {collector.lastMessageAt !== null ? <p>마지막 채팅 {kstClockWords(collector.lastMessageAt)}</p> : null}
          {collector.skippedBeforeLink > 0 ? <p>잇기 전에 올라온 채팅 {groupDigits(collector.skippedBeforeLink)}개는 받지 않았어요.</p> : null}
          {collector.gap && collector.gapMessage !== null ? <p className="warning">{collector.gapMessage}</p> : null}
        </>
      )}
      {writable ? (
        <div className="row">
          {collector?.restartable === true && collector.reason !== 'RECONNECT' && collector.reason !== 'NOT_CONNECTED' ? (
            <button type="button" className="button" disabled={busy} onClick={() => void restart()}>
              채팅 다시 받기
            </button>
          ) : null}
          <button type="button" className="button" onClick={onUnlink}>
            유튜브 방송 연결 끊기
          </button>
        </div>
      ) : null}
      {error !== null ? <ErrorNote error={error} /> : null}
    </div>
  )
}

/** 방송 잇기: 내 라이브 목록에서 고르기 · 주소 붙여넣기 (AC-I3-21·22·23) */
function LinkPicker() {
  const api = useConsoleApi()
  const yt = useYoutube()
  const [list, setList] = useState<readonly LiveBroadcastItem[] | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [listError, setListError] = useState<ApiError | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const [parsed, setParsed] = useState<string | null>(null)
  const [parseProblem, setParseProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [linkError, setLinkError] = useState<ApiError | null>(null)
  const pending = useRef<{ video: string; requestId: string } | null>(null)
  const addressId = useId()

  const loadList = async () => {
    setListOpen(true)
    setListError(null)
    try {
      const { broadcasts } = await get<{ broadcasts: LiveBroadcastItem[] }>('/api/youtube/live-broadcasts')
      setList(broadcasts)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setList(null)
      setListError(caught)
    }
  }

  const check = async (text: string) => {
    setParsed(null)
    setParseProblem(null)
    if (text.trim() === '') return
    try {
      const { videoId } = await post<{ videoId: string }>('/api/youtube/parse-video', { video: text })
      setParsed(videoId)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setParseProblem(caught.problemFor('video')?.message ?? caught.message)
    }
  }

  const link = async (video: string) => {
    if (busy) return
    if (pending.current?.video !== video) pending.current = { video, requestId: newRequestId() }
    const { requestId } = pending.current
    setBusy(true)
    setLinkError(null)
    try {
      const view = await withRetry(() => post<LinkView>(`/api/broadcasts/${encodeURIComponent(api.b)}/youtube`, { requestId, video }))
      pending.current = null
      yt.setLink(view)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      // 다시 보내도 되는 실패(네트워크)만 같은 요청 번호를 남긴다
      if (!caught.retryable) pending.current = null
      setLinkError(caught)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack link-picker">
      <p>이 방송에 유튜브 라이브를 이으면 그 채팅으로 찜을 받아요.</p>
      <div className="stack-tight">
        <div className="row">
          <button type="button" className="button" aria-expanded={listOpen} onClick={() => void loadList()}>
            내 라이브 목록에서 고르기
          </button>
        </div>
        {listOpen && listError !== null ? <ErrorNote error={listError} onRetry={() => void loadList()} retryLabel="다시 불러오기" /> : null}
        {listOpen && list === null && listError === null ? <p role="status">불러오는 중…</p> : null}
        {listOpen && list !== null && list.length === 0 ? <p>{LIVE_LIST_EMPTY}</p> : null}
        {listOpen && list !== null && list.length > 0 ? (
          <fieldset className="stack-tight">
            <legend>내 라이브</legend>
            <div className="choice-list">
              {list.map((item) => {
                const other = item.linkedBroadcast !== null && item.linkedBroadcast !== api.b
                return (
                  <label key={item.videoId} className="choice">
                    <input type="radio" name="live-broadcast" value={item.videoId} checked={chosen === item.videoId} disabled={other} onChange={() => setChosen(item.videoId)} />
                    <span>
                      <strong>{item.title}</strong> {item.status === 'LIVE' ? '방송 중' : `예정 ${item.scheduledStartTime === null ? '' : kstDateTimeWords(item.scheduledStartTime)}`}
                      {other ? ` · ${OTHER_BROADCAST}` : ''}
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="row">
              <button type="button" className="button button-primary" disabled={busy || chosen === null} onClick={() => chosen !== null && void link(chosen)}>
                이 방송에 잇기
              </button>
            </div>
          </fieldset>
        ) : null}
      </div>
      <div className="stack-tight">
        <label htmlFor={addressId}>주소 붙여넣기</label>
        <input
          id={addressId}
          className="input"
          autoComplete="off"
          inputMode="url"
          placeholder="유튜브 방송 주소"
          value={address}
          aria-invalid={parseProblem !== null}
          aria-describedby={parseProblem !== null ? `${addressId}-problem` : undefined}
          onChange={(event) => {
            setAddress(event.target.value)
            setParsed(null)
            setParseProblem(null)
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text')
            if (text !== '') void check(text)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void check(address)
            }
          }}
        />
        {parseProblem !== null ? (
          <p className="field-error" role="alert" id={`${addressId}-problem`}>
            {parseProblem}
          </p>
        ) : null}
        {parsed !== null ? <p>읽은 영상: {parsed}</p> : null}
        <div className="row">
          <button type="button" className="button" onClick={() => void check(address)}>
            주소 확인
          </button>
          <button type="button" className="button button-primary" disabled={busy || parsed === null} onClick={() => parsed !== null && void link(parsed)}>
            이 방송에 잇기
          </button>
        </div>
      </div>
      {busy ? <p role="status">잇는 중…</p> : null}
      {linkError !== null ? <ErrorNote error={linkError} /> : null}
    </div>
  )
}

/** 시청자 알림 (AC-I3-27): 지운 메시지·유튜브 차단 — 판정·찜은 바뀌지 않는다 */
function ViewerNotices({ sealed }: { readonly sealed: boolean }) {
  const yt = useYoutube()
  const api = useConsoleApi()
  const list = useMemo(() => [...yt.notices].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id)), [yt.notices])
  return (
    <section className="stack-tight viewer-notices" aria-label="시청자 알림">
      <h3 className="sub-title">시청자 알림 {list.length}</h3>
      {list.length === 0 ? null : (
        <ul className="plain-list stack-tight notice-list">
          {list.map((notice) => {
            const blocked = api.data.buyers.get(notice.channel)?.blocked === true
            return (
              <li key={notice.id} className="claim-row">
                <p>
                  <time dateTime={notice.at}>{kstClockWords(notice.at)}</time> <strong className="chat-nick">{notice.nick}</strong> {notice.message}
                </p>
                {notice.wasOrder ? <p className="tag">주문이었던 메시지예요</p> : null}
                {notice.wasCancel ? <p className="tag">취소 메시지였어요</p> : null}
                {notice.kind === 'BANNED' ? (
                  blocked ? (
                    <p className="tag tag-alert">차단함</p>
                  ) : (
                    <div className="row">
                      <button type="button" className="button" disabled={sealed} onClick={() => openBlockAction(api, notice.channel, true)}>
                        {SERVICE_NAME}에서도 차단
                      </button>
                    </div>
                  )
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── 창 ─────────────────────────────────────────────────────────────────

/** 유튜브 방송 연결 끊기 확인 (AC-I3-26) — 처음 포커스 "그대로 두기" */
export function UnlinkDialog({ onClose }: { readonly onClose: () => void }) {
  const yt = useYoutube()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const unlink = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await yt.unlink()
      onClose()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      setBusy(false)
    }
  }
  return (
    <Modal
      title="유튜브 방송 연결 끊기"
      onClose={onClose}
      closeLabel="그대로 두기"
      actions={
        <button type="button" className="button button-danger" disabled={busy} onClick={() => void unlink()}>
          연결 끊기
        </button>
      }
    >
      <p>{UNLINK_QUESTION}</p>
      {error !== null ? <ErrorNote error={error} /> : null}
    </Modal>
  )
}

/** 글쓰기 권한 받으러 구글로 (AC-I3-34) — 돌아온 뒤 자동으로 보내지 않는다 */
export function AuthorizeDialog({ url, onClose }: { readonly url: string; readonly onClose: () => void }) {
  return (
    <Modal
      title="글쓰기 권한 받기"
      onClose={onClose}
      actions={
        <button type="button" className="button button-primary" onClick={() => goToGoogle(url)}>
          구글로 가기
        </button>
      }
    >
      <p>{NO_PERMISSION_DIALOG}</p>
    </Modal>
  )
}

/** 감사 메시지 목록 (AC-I3-31~35) */
export function OutboxDialog({ onClose }: { readonly onClose: () => void }) {
  const yt = useYoutube()
  const api = useConsoleApi()
  const [sentOpen, setSentOpen] = useState(false)
  const groups = useMemo(() => outboxGroups(yt.outbox), [yt.outbox])

  // 열면 지금 목록을 다시 받는다 (다른 기기에서 다시 보낸 결과도)
  useEffect(() => {
    if (yt.enabled) void yt.reloadOutbox()
  }, [])

  if (!yt.enabled) {
    return (
      <Modal title="감사 메시지" onClose={onClose} wide unlocked>
        <p>{REHEARSAL_OUTBOX}</p>
      </Modal>
    )
  }

  const askResend = (row: OutboxRow) => {
    api.openDialog({
      kind: 'confirm',
      spec: {
        title: '유튜브에 이 글이 없는 걸 확인했나요?',
        message: '이미 있으면 다시 보내지 마세요.',
        confirmLabel: '없어요, 다시 보내기',
        closeLabel: '그만두기',
        tone: 'primary',
        onConfirm: async () => {
          const outcome = await yt.resend(row)
          api.closeTop()
          if (outcome.authorizeUrl !== undefined) api.openDialog({ kind: 'youtubeAuthorize', url: outcome.authorizeUrl })
        },
      },
    })
  }

  const askPosted = (row: OutboxRow) => {
    api.openDialog({
      kind: 'confirm',
      spec: {
        title: '유튜브에 이 글이 올라가 있는 걸 확인했나요?',
        message: row.text,
        confirmLabel: '올라가 있어요',
        closeLabel: '그만두기',
        tone: 'primary',
        onConfirm: async () => {
          await yt.confirmPosted(row)
          api.closeTop()
        },
      },
    })
  }

  const resendNow = async (row: OutboxRow) => {
    const outcome = await yt.resend(row)
    if (outcome.authorizeUrl !== undefined) api.openDialog({ kind: 'youtubeAuthorize', url: outcome.authorizeUrl })
  }

  const rows = (list: readonly OutboxRow[]) => (
    <ul className="plain-list stack-tight outbox-list">
      {list.map((row) => (
        <OutboxItem key={row.id} row={row} onResend={() => (row.reason === 'UNCONFIRMED' ? askResend(row) : void resendNow(row))} onPosted={() => askPosted(row)} onDismiss={() => void yt.dismiss(row)} />
      ))}
    </ul>
  )

  const empty = yt.outbox.length === 0
  return (
    <Modal title="감사 메시지" onClose={onClose} wide unlocked>
      {api.sealed ? (
        <p className="warning" role="note">
          {SEALED_READ_ONLY}
        </p>
      ) : null}
      {empty ? <p>이 날짜에 만든 감사 메시지가 없어요.</p> : null}
      {groups.attention.length > 0 ? (
        <section className="stack-tight" aria-label="확인이 필요한 감사">
          <h3 className="sub-title">확인이 필요한 감사 {groups.attention.length}</h3>
          {rows(groups.attention)}
        </section>
      ) : null}
      {groups.notSent.length > 0 ? (
        <section className="stack-tight" aria-label="자동으로 보내지 않은 감사">
          <h3 className="sub-title">자동으로 보내지 않은 감사 {groups.notSent.length}</h3>
          {rows(groups.notSent)}
        </section>
      ) : null}
      {groups.pending.length > 0 ? (
        <section className="stack-tight" aria-label="기다리는 중·보내는 중">
          <h3 className="sub-title">기다리는 중·보내는 중 {groups.pending.length}</h3>
          {rows(groups.pending)}
        </section>
      ) : null}
      {groups.sent.length > 0 ? (
        <section className="stack-tight" aria-label="보냄">
          <h3 className="sub-title">보냄 {groups.sent.length}</h3>
          <div className="row">
            <button type="button" className="button" aria-expanded={sentOpen} onClick={() => setSentOpen((open) => !open)}>
              {sentOpen ? '접기' : '펼치기'}
            </button>
          </div>
          {sentOpen ? rows(groups.sent) : null}
        </section>
      ) : null}
    </Modal>
  )
}

function OutboxItem({ row, onResend, onPosted, onDismiss }: { readonly row: OutboxRow; readonly onResend: () => void; readonly onPosted: () => void; readonly onDismiss: () => void }) {
  const yt = useYoutube()
  const api = useConsoleApi()
  const busy = yt.rowBusy.has(row.id)
  const error = yt.rowErrors.get(row.id) ?? null
  const locked = api.sealed || busy
  const title = row.broadcast === null ? '' : (api.data.broadcasts.get(row.broadcast)?.title ?? '')
  const no = productNo(row.product)
  const failed = row.state === 'FAILED'
  const unconfirmed = failed && row.reason === 'UNCONFIRMED'
  const sentByHand = row.state === 'SENT' && row.confirmedBySeller === true
  return (
    <li className="claim-row outbox-row stack-tight">
      <p>
        {title !== '' ? <span>{title} </span> : null}
        {no !== null ? <strong>{no}번 </strong> : null}
        {row.buyer !== null ? <span className="buyer-name">{api.names.name(row.buyer)} </span> : null}
        <span className="tag">{TARGET_WORD[row.target]}</span>
        {row.groupWith.length > 0 ? <span className="tag">같은 메시지 {row.groupWith.length + 1}개</span> : null}
        {row.dismissed === true ? <span className="tag">알림에서 뺌</span> : null}
      </p>
      <p className="quote">{row.text}</p>
      <p>
        {sentByHand ? '보냄 — 판매자가 확인함' : row.stateMessage}
        {row.reasonMessage !== null ? ` — ${row.reasonMessage}` : ''}
        {row.state === 'SENT' && row.postedAt !== null ? ` · 보낸 때 ${kstClockWords(row.postedAt)}` : ''}
      </p>
      {failed && row.reason === 'NOT_MY_CHANNEL' ? <p>{NOT_MY_CHANNEL_HINT}</p> : null}
      {failed ? (
        <div className="row">
          <button type="button" className="button button-primary" disabled={locked} onClick={onResend}>
            다시 보내기
          </button>
          {unconfirmed ? <span className="warning">{unconfirmedWarning(row.target)}</span> : null}
          {unconfirmed ? (
            <button type="button" className="button" disabled={locked} onClick={onPosted}>
              유튜브에 올라가 있어요
            </button>
          ) : null}
          {needsAttention(row) && !unconfirmed ? (
            <button type="button" className="button" disabled={locked} onClick={onDismiss}>
              알림에서 빼기
            </button>
          ) : null}
        </div>
      ) : null}
      {busy ? <p role="status">보내는 중…</p> : null}
      {error !== null ? <RowError error={error} /> : null}
    </li>
  )
}

/** 줄의 오류: 서버 문장 그대로 (다른 채널이면 할 일 문장을 함께) */
function RowError({ error }: { readonly error: ApiError }) {
  if (error.code === 'NOT_MY_CHANNEL') {
    return (
      <div className="error-note" role="alert">
        <p>{NOT_MY_CHANNEL_MESSAGE}</p>
        <p>{NOT_MY_CHANNEL_HINT}</p>
      </div>
    )
  }
  return <ErrorNote error={error} />
}
