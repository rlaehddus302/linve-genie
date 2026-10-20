// 콘솔의 인스타그램·틱톡 칸과 여러 플랫폼 안내 (SPEC §7 화면 2, PLT-01·02·03, D-N2b-2-02·13, AC-N2b-2-60~64).
// - 플랫폼 칸은 스크롤 영역(고정 영역 밖)에 둔다: 유튜브(지금 칸 그대로) · 인스타그램 · 틱톡. 둘 이상 이으면 칸 위에 도착순 안내.
//   리허설 회차는 인스타그램·틱톡 칸 대신 "리허설 방송에는 라이브를 이을 수 없어요." 한 줄이고 인스타그램·틱톡 요청을 보내지 않는다.
// - 고정 영역에는 한 줄만: 틱톡 댓글이 들어오지 않을 때의 알림 줄(누르면 붙여넣기 창), 인스타그램 알림(LIVE_MOVED 등 — 문장 그대로, "닫기").
// - 실시간: 범위 저장소의 같은 연결로 SSE `instagram`·`tiktok`을 받는다(새로 고침 없이). 끊겼다 이어지면 모두 다시 받는다.
//   댓글 수는 알림마다 오지 않으므로 새 채팅이 들어오면 모아서 한 번 다시 받는다.
// 서버 문장(수집 상태·오류·알림)은 고치지 않고 그대로 보인다. 아이디·라이브 ID는 글자로만 보인다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, newRequestId, post, withRetry, withQuery, type ApiError } from '../api/client.ts'
import type { BroadcastLive, InstagramConnection, InstagramDmRow, InstagramLinkView, InstagramLive, PlatformCapability, TikTokLinkView, TikTokSettings } from '../api/types.ts'
import type { ConsoleStore } from '../lib/console-store.ts'
import { kstClockWords } from '../lib/kst.ts'
import { groupDigits } from '../lib/money.ts'
import {
  INSTAGRAM_LIVES_EMPTY,
  INSTAGRAM_NOT_CONFIGURED,
  INSTAGRAM_NOT_CONNECTED,
  INSTAGRAM_RECONNECT,
  INSTAGRAM_UNLINK_QUESTION,
  MULTI_PLATFORM_NOTICE,
  REHEARSAL_LIVE,
  TIKTOK_PASTE_ALERT,
  TIKTOK_UNLINK_QUESTION,
  failedDmCount,
  failedDmMessage,
  tiktokBlocker,
  tiktokNeedsPaste,
  tiktokReconnectable,
} from '../lib/platforms.ts'
import { routePath, type Navigate, type SettingsSection } from '../lib/router.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

/** 새 채팅이 들어오면 댓글 수를 다시 받기까지 (모아서 한 번) */
const REFRESH_MS = 700
/** 감사 DM 알림이 몰리면 모아서 한 번 */
const DM_REFRESH_MS = 250
/** 고정 영역의 인스타그램 알림은 최근 것 몇 개만 둔다 */
const NOTICE_KEEP = 5

export interface PlatformNotice {
  readonly id: number
  readonly message: string
}

export interface ConsolePlatformsInput {
  readonly store: ConsoleStore
  readonly broadcastId: string
  readonly date: string
  readonly rehearsal: boolean
  /** 그 방송의 마지막 메시지 seq (새 채팅이 오면 수를 다시 받는다) */
  readonly lastMessageSeq: number
}

export interface ConsolePlatforms {
  readonly enabled: boolean
  readonly platforms: readonly PlatformCapability[] | null
  readonly instagram: InstagramConnection | null
  readonly instagramError: ApiError | null
  readonly igLink: InstagramLinkView | null
  readonly tiktok: TikTokSettings | null
  readonly tiktokError: ApiError | null
  readonly ttLink: TikTokLinkView | null
  readonly dmFailed: number
  readonly notices: readonly PlatformNotice[]
  /** 인스타그램·틱톡이 이어져 있다 (채팅 줄 플랫폼 글자) */
  readonly otherLinked: boolean
  /** 이어진 인스타그램·틱톡 수 (유튜브는 콘솔이 더한다) */
  readonly linkedCount: number
  setIgLink(view: InstagramLinkView): void
  setTtLink(view: TikTokLinkView): void
  dismissNotice(id: number): void
  reload(): Promise<void>
}

export function useConsolePlatforms({ store, broadcastId, date, rehearsal, lastMessageSeq }: ConsolePlatformsInput): ConsolePlatforms {
  const enabled = !rehearsal
  const [platforms, setPlatforms] = useState<readonly PlatformCapability[] | null>(null)
  const [instagram, setInstagram] = useState<InstagramConnection | null>(null)
  const [instagramError, setInstagramError] = useState<ApiError | null>(null)
  const [igLink, setIgLinkState] = useState<InstagramLinkView | null>(null)
  const [tiktok, setTiktok] = useState<TikTokSettings | null>(null)
  const [tiktokError, setTiktokError] = useState<ApiError | null>(null)
  const [ttLink, setTtLinkState] = useState<TikTokLinkView | null>(null)
  const [dms, setDms] = useState<readonly InstagramDmRow[]>([])
  const [notices, setNotices] = useState<readonly PlatformNotice[]>([])
  const alive = useRef(true)
  const noticeId = useRef(1)
  const igVersion = useRef(0)
  const ttVersion = useRef(0)
  const dmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const countTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}`

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(dmTimer.current)
      clearTimeout(countTimer.current)
    }
  }, [])

  const setIgLink = useCallback((view: InstagramLinkView) => {
    igVersion.current++
    setIgLinkState(view)
  }, [])
  const setTtLink = useCallback((view: TikTokLinkView) => {
    ttVersion.current++
    setTtLinkState(view)
  }, [])

  const reloadIgLink = useCallback(async () => {
    const mine = ++igVersion.current
    try {
      const { link } = await get<BroadcastLive>(`${base}/live`)
      if (alive.current && mine === igVersion.current) setIgLinkState(link)
    } catch {
      // 다음 알림·다시 붙을 때 다시 받는다
    }
  }, [base])

  const reloadTtLink = useCallback(async () => {
    const mine = ++ttVersion.current
    try {
      const { link } = await get<{ link: TikTokLinkView }>(`${base}/tiktok`)
      if (alive.current && mine === ttVersion.current) setTtLinkState(link)
    } catch {
      // 다음 알림·다시 붙을 때 다시 받는다
    }
  }, [base])

  const reloadDms = useCallback(async () => {
    try {
      const { rows } = await get<{ rows: InstagramDmRow[] }>(withQuery('/api/instagram/dms', { date }))
      if (alive.current) setDms(rows)
    } catch {
      // 보내지 못한 DM 수는 다음 알림에 다시 받는다
    }
  }, [date])

  const reload = useCallback(async () => {
    const loadInstagram = async () => {
      try {
        const { connection } = await get<{ connection: InstagramConnection }>('/api/instagram')
        if (!alive.current) return
        setInstagram(connection)
        setInstagramError(null)
      } catch (error) {
        if (alive.current && isApiError(error)) setInstagramError(error)
      }
    }
    const loadTiktok = async () => {
      try {
        const { tiktok: settings } = await get<{ tiktok: TikTokSettings }>('/api/tiktok')
        if (!alive.current) return
        setTiktok(settings)
        setTiktokError(null)
      } catch (error) {
        if (alive.current && isApiError(error)) setTiktokError(error)
      }
    }
    const loadPlatforms = async () => {
      try {
        const { platforms: list } = await get<{ platforms: PlatformCapability[] }>('/api/platforms')
        if (alive.current) setPlatforms(list)
      } catch {
        // 이유 문장이 없으면 화면의 기본 문장을 쓴다
      }
    }
    await Promise.all([loadPlatforms(), loadInstagram(), loadTiktok(), reloadIgLink(), reloadTtLink(), reloadDms()])
  }, [reloadDms, reloadIgLink, reloadTtLink])

  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])

  // 실시간 알림 (같은 연결)
  useEffect(() => {
    if (!enabled) return
    const off = store.onPlatform((data) => {
      if (data.type === 'tiktok') {
        if (data.event.kind === 'LINK' && data.event.broadcast === broadcastId) setTtLink(data.event.link)
        return
      }
      const event = data.event
      switch (event.kind) {
        case 'CONNECTION':
          setInstagram(event.connection)
          setInstagramError(null)
          return
        case 'LINK':
        case 'COLLECTION':
          if (event.broadcast === broadcastId) setIgLink(event.link)
          return
        case 'NOTICE': {
          if (event.broadcast !== undefined && event.broadcast !== broadcastId) return
          const id = noticeId.current++
          setNotices((list) => [...list.filter((item) => item.message !== event.message), { id, message: event.message }].slice(-NOTICE_KEEP))
          return
        }
        case 'DM':
          if (event.date !== date) return
          clearTimeout(dmTimer.current)
          dmTimer.current = setTimeout(() => void reloadDms(), DM_REFRESH_MS)
          return
      }
    })
    const offReconnect = store.onReconnect(() => void reload())
    return () => {
      off()
      offReconnect()
    }
  }, [store, enabled, broadcastId, date, reload, reloadDms, setIgLink, setTtLink])

  const igOpen = igLink !== null && igLink.state !== 'NONE'
  const ttOpen = ttLink !== null && ttLink.state === 'LINKED'

  // 새 채팅이 들어오면 받은 댓글 수를 다시 받는다 (모아서 한 번)
  useEffect(() => {
    if (!enabled || (!igOpen && !ttOpen) || lastMessageSeq === 0) return
    clearTimeout(countTimer.current)
    countTimer.current = setTimeout(() => {
      if (igOpen) void reloadIgLink()
      if (ttOpen) void reloadTtLink()
    }, REFRESH_MS)
  }, [enabled, igOpen, ttOpen, lastMessageSeq, reloadIgLink, reloadTtLink])

  const dismissNotice = useCallback((id: number) => setNotices((list) => list.filter((item) => item.id !== id)), [])

  return {
    enabled,
    platforms,
    instagram,
    instagramError,
    igLink,
    tiktok,
    tiktokError,
    ttLink,
    dmFailed: enabled ? failedDmCount(dms, broadcastId) : 0,
    notices: enabled ? notices : [],
    otherLinked: enabled && (igOpen || ttOpen),
    linkedCount: enabled ? (igOpen ? 1 : 0) + (ttOpen ? 1 : 0) : 0,
    setIgLink,
    setTtLink,
    dismissNotice,
    reload,
  }
}

/** 틱톡 댓글이 들어오지 않는다 (알림 줄·주 단추) */
export function tiktokTrouble(live: ConsolePlatforms): boolean {
  return live.enabled && live.ttLink?.state === 'LINKED' && tiktokNeedsPaste(live.ttLink.collection)
}

// ── 고정 영역: 한 줄 알림 ─────────────────────────────────────────────

export function PlatformAlerts({ live, sealed, onPaste, pasteNote }: { readonly live: ConsolePlatforms; readonly sealed: boolean; readonly onPaste: () => void; readonly pasteNote: string | null }) {
  const notice = live.notices.at(-1)
  const trouble = !sealed && tiktokTrouble(live)
  if (!trouble && notice === undefined && pasteNote === null) return null
  return (
    <div className="platform-alerts stack-tight">
      {trouble ? (
        <button type="button" className="connection-banner platform-alert-line" onClick={onPaste}>
          {TIKTOK_PASTE_ALERT}
        </button>
      ) : null}
      {notice !== undefined ? (
        <div className="notice platform-notice" role="status">
          <span>{notice.message}</span>
          <button type="button" className="button button-small" aria-label="인스타그램 알림 닫기" onClick={() => live.dismissNotice(notice.id)}>
            닫기
          </button>
        </div>
      ) : null}
      {pasteNote !== null ? (
        <p className="notice platform-notice" role="status">
          {pasteNote}
        </p>
      ) : null}
    </div>
  )
}

// ── 스크롤 영역: 플랫폼 칸 ────────────────────────────────────────────

/** 플랫폼 칸 위 도착순 안내 (그 회차에 둘 이상 이어져 있을 때) */
export function MultiPlatformNotice({ count }: { readonly count: number }) {
  if (count < 2) return null
  return (
    <p className="notice multi-platform-notice" role="note">
      {MULTI_PLATFORM_NOTICE}
    </p>
  )
}

function SettingsButton({ navigate, section }: { readonly navigate: Navigate; readonly section: SettingsSection }) {
  return (
    <a
      className="button"
      href={routePath({ name: 'settings', section })}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey) return
        event.preventDefault()
        navigate({ name: 'settings', section })
      }}
    >
      설정으로
    </a>
  )
}

/** 칸 상태를 받지 못함 — 방송 중 급한 일이 아니라 경고 영역(alert)으로 띄우지 않는다. 서버 문장 + 다시 불러오기 */
function LoadFailed({ error, onRetry }: { readonly error: ApiError; readonly onRetry: () => void }) {
  return (
    <div className="stack-tight">
      <p className="warning">{error.message}</p>
      <div className="row">
        <button type="button" className="button" onClick={onRetry}>
          다시 불러오기
        </button>
      </div>
    </div>
  )
}

export interface PlatformPanelsProps {
  readonly live: ConsolePlatforms
  readonly broadcastId: string
  readonly navigate: Navigate
  readonly ended: boolean
  readonly sealed: boolean
  readonly onPaste: () => void
}

/** 인스타그램·틱톡 칸 (리허설은 안내 한 줄) */
export function PlatformPanels(props: PlatformPanelsProps) {
  if (!props.live.enabled) {
    return (
      <section className="card stack-tight platform-panel" aria-label="인스타그램·틱톡">
        <h2 className="section-title">인스타그램·틱톡</h2>
        <p>{REHEARSAL_LIVE}</p>
      </section>
    )
  }
  return (
    <>
      <InstagramPanel {...props} />
      <TikTokPanel {...props} />
    </>
  )
}

/** 보내기 하나의 진행 (잠금·오류·다시 보내도 같은 요청 번호) */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const run = useCallback(async (work: () => Promise<void>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await work()
      return true
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      return false
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, setError, run }
}

/** 같은 조치를 다시 누르면 같은 요청 번호 (다시 보내도 되는 실패만 남긴다) */
function useRequestIds() {
  const ids = useRef(new Map<string, string>())
  const take = (key: string): string => {
    const known = ids.current.get(key)
    if (known !== undefined) return known
    const id = newRequestId()
    ids.current.set(key, id)
    return id
  }
  const settle = (key: string, error: unknown) => {
    if (error === null || !isApiError(error) || !error.retryable) ids.current.delete(key)
  }
  return { take, settle }
}

async function send<T>(ids: ReturnType<typeof useRequestIds>, key: string, path: string, body: (requestId: string) => Record<string, unknown>): Promise<T> {
  const requestId = ids.take(key)
  try {
    const result = await withRetry(() => post<T>(path, body(requestId)))
    ids.settle(key, null)
    return result
  } catch (error) {
    ids.settle(key, error)
    throw error
  }
}

// ── 인스타그램 칸 (AC-N2b-2-63) ───────────────────────────────────────

function InstagramPanel({ live, broadcastId, navigate, ended, sealed }: PlatformPanelsProps) {
  const { instagram, igLink } = live
  const action = useAction()
  const ids = useRequestIds()
  const [lives, setLives] = useState<readonly InstagramLive[] | null>(null)
  const [livesOpen, setLivesOpen] = useState(false)
  const [livesError, setLivesError] = useState<ApiError | null>(null)
  const [asking, setAsking] = useState(false)
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}/live`
  const writable = !ended && !sealed
  const reason = live.platforms?.find((item) => item.platform === 'INSTAGRAM')?.reasons.ready

  const loadLives = async () => {
    setLivesOpen(true)
    setLivesError(null)
    setLives(null)
    try {
      const { lives: list } = await get<{ lives: InstagramLive[] }>('/api/instagram/lives')
      setLives(list)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setLivesError(caught)
    }
  }

  const wait = () => action.run(async () => live.setIgLink((await send<{ link: InstagramLinkView }>(ids, 'wait', `${base}/wait`, (requestId) => ({ requestId, platform: 'INSTAGRAM' }))).link))
  const link = (liveId: string) =>
    action.run(async () => {
      live.setIgLink((await send<{ link: InstagramLinkView }>(ids, `link:${liveId}`, `${base}/link`, (requestId) => ({ requestId, platform: 'INSTAGRAM', liveId }))).link)
      setLivesOpen(false)
    })
  const unlink = () =>
    action.run(async () => {
      live.setIgLink((await send<{ link: InstagramLinkView }>(ids, 'unlink', `${base}/unlink`, (requestId) => ({ requestId, platform: 'INSTAGRAM' }))).link)
      setAsking(false)
    })

  const open = igLink !== null && igLink.state !== 'NONE'
  const collection = igLink?.collection ?? null
  return (
    <section className="card stack platform-panel instagram-panel" aria-label="인스타그램">
      <h2 className="section-title">인스타그램</h2>
      {instagram === null && live.instagramError !== null ? <LoadFailed error={live.instagramError} onRetry={() => void live.reload()} /> : null}
      {instagram === null && live.instagramError === null ? <p role="status">불러오는 중…</p> : null}
      {instagram !== null && !instagram.configured ? (
        <div className="stack-tight">
          <p>{reason ?? INSTAGRAM_NOT_CONFIGURED}</p>
          <div className="row">
            <SettingsButton navigate={navigate} section="instagram" />
          </div>
        </div>
      ) : null}
      {instagram !== null && instagram.configured && instagram.status !== 'CONNECTED' ? (
        <div className="stack-tight">
          <p className={instagram.status === 'RECONNECT_NEEDED' ? 'warning' : undefined}>{instagram.status === 'RECONNECT_NEEDED' ? INSTAGRAM_RECONNECT : INSTAGRAM_NOT_CONNECTED}</p>
          <div className="row">
            <SettingsButton navigate={navigate} section="instagram" />
          </div>
        </div>
      ) : null}
      {open && collection !== null ? (
        <div className="stack-tight" role="group" aria-label="인스타그램 댓글 받기">
          <p>
            <strong>{collection.message}</strong>
          </p>
          {igLink.state === 'LINKED' ? <p>받은 댓글 {groupDigits(collection.comments)}개</p> : null}
          {collection.late > 0 ? <p>늦게 받은 댓글 {groupDigits(collection.late)}개</p> : null}
          {collection.lastCommentAt !== null ? <p>마지막 댓글 {kstClockWords(collection.lastCommentAt)}</p> : null}
        </div>
      ) : null}
      {open && igLink.moved !== null ? <p className="warning">{igLink.moved.message}</p> : null}
      {open && !sealed ? (
        <div className="row">
          <button type="button" className="button" disabled={action.busy} onClick={() => setAsking(true)}>
            끊기
          </button>
        </div>
      ) : null}
      {!open && instagram?.configured === true && instagram.status === 'CONNECTED' ? (
        writable ? (
          <div className="stack-tight">
            <div className="row">
              <button type="button" className="button" disabled={action.busy} onClick={() => void wait()}>
                인스타그램 기다리기
              </button>
              <button type="button" className="button" aria-expanded={livesOpen} disabled={action.busy} onClick={() => void loadLives()}>
                진행 중인 라이브 고르기
              </button>
            </div>
            <p className="hint">라이브를 켜기 전이면 "인스타그램 기다리기"를 눌러 두세요. 라이브를 시작하면 첫 댓글부터 받아요.</p>
            {livesOpen && livesError !== null ? <ErrorNote error={livesError} onRetry={() => void loadLives()} retryLabel="다시 불러오기" /> : null}
            {livesOpen && lives === null && livesError === null ? <p role="status">불러오는 중…</p> : null}
            {livesOpen && lives !== null && lives.length === 0 ? <p>{INSTAGRAM_LIVES_EMPTY}</p> : null}
            {livesOpen && lives !== null && lives.length > 0 ? (
              <ul className="plain-list stack-tight" aria-label="진행 중인 인스타그램 라이브">
                {lives.map((item) => {
                  const other = item.broadcast !== null && item.broadcast !== broadcastId
                  return (
                    <li key={item.id} className="row">
                      <span>
                        라이브 {item.startedAt === null ? item.id : `${kstClockWords(item.startedAt)} 시작`}
                        {other ? ' — 다른 방송에 이어져 있어요' : ''}
                      </span>
                      <button type="button" className="button" disabled={action.busy || other} onClick={() => void link(item.id)}>
                        이 라이브 잇기
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        ) : (
          <p>이은 인스타그램 라이브가 없어요.</p>
        )
      ) : null}
      {live.dmFailed > 0 ? <p className="warning">{failedDmMessage(live.dmFailed)}</p> : null}
      {live.notices.length > 0 ? (
        <ul className="plain-list stack-tight" aria-label="인스타그램 알림">
          {live.notices.map((notice) => (
            <li key={notice.id}>{notice.message}</li>
          ))}
        </ul>
      ) : null}
      {action.error !== null && !asking ? <ErrorNote error={action.error} /> : null}
      {asking ? (
        <Modal
          title="인스타그램 연결 끊기"
          onClose={() => {
            setAsking(false)
            action.setError(null)
          }}
          actions={
            <button type="button" className="button button-danger" disabled={action.busy} onClick={() => void unlink()}>
              끊기
            </button>
          }
        >
          <p>{INSTAGRAM_UNLINK_QUESTION}</p>
          {action.error !== null ? <ErrorNote error={action.error} /> : null}
        </Modal>
      ) : null}
    </section>
  )
}

// ── 틱톡 칸 (AC-N2b-2-62) ─────────────────────────────────────────────

function TikTokPanel({ live, broadcastId, navigate, ended, sealed, onPaste }: PlatformPanelsProps) {
  const { tiktok, ttLink } = live
  const action = useAction()
  const ids = useRequestIds()
  const [asking, setAsking] = useState(false)
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}`
  const writable = !ended && !sealed
  const linked = ttLink !== null && ttLink.state === 'LINKED'
  const collection = ttLink?.collection ?? null
  const reason = live.platforms?.find((item) => item.platform === 'TIKTOK')?.reasons.ready

  const link = () => action.run(async () => live.setTtLink((await send<{ link: TikTokLinkView }>(ids, 'link', `${base}/live/link`, (requestId) => ({ requestId, platform: 'TIKTOK' }))).link))
  const unlink = () =>
    action.run(async () => {
      live.setTtLink((await send<{ link: TikTokLinkView }>(ids, 'unlink', `${base}/live/unlink`, (requestId) => ({ requestId, platform: 'TIKTOK' }))).link)
      setAsking(false)
    })
  const reconnect = () => action.run(async () => live.setTtLink((await withRetry(() => post<{ link: TikTokLinkView }>(`${base}/tiktok/reconnect`, {}))).link))

  const trouble = tiktokTrouble(live)
  const blocker = tiktok === null ? null : tiktokBlocker(tiktok, reason)
  return (
    <section className="card stack platform-panel tiktok-panel" aria-label="틱톡">
      <h2 className="section-title">틱톡</h2>
      {tiktok === null && live.tiktokError !== null ? <LoadFailed error={live.tiktokError} onRetry={() => void live.reload()} /> : null}
      {tiktok === null && live.tiktokError === null ? <p role="status">불러오는 중…</p> : null}
      {linked ? (
        <div className="stack-tight" role="group" aria-label="틱톡 댓글 받기">
          {ttLink.tiktokId !== null ? <p>이은 틱톡 아이디: @{ttLink.tiktokId}</p> : null}
          {collection !== null ? (
            <>
              <p>
                <strong>{collection.message}</strong>
              </p>
              {collection.missed && collection.missedMessage !== null ? <p className="warning">{collection.missedMessage}</p> : null}
              <p>받은 댓글 {groupDigits(collection.comments)}개</p>
              {collection.lastCommentAt !== null ? <p>마지막 댓글 {kstClockWords(collection.lastCommentAt)}</p> : null}
            </>
          ) : null}
          {!sealed ? (
            <div className="row">
              {trouble ? (
                <button type="button" className="button button-primary" onClick={onPaste}>
                  댓글 붙여넣기
                </button>
              ) : null}
              {writable && tiktokReconnectable(collection) ? (
                <button type="button" className="button" disabled={action.busy} onClick={() => void reconnect()}>
                  다시 연결
                </button>
              ) : null}
              <button type="button" className="button" disabled={action.busy} onClick={() => setAsking(true)}>
                끊기
              </button>
              {!trouble ? (
                <button type="button" className="button" onClick={onPaste}>
                  댓글 붙여넣기
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : tiktok !== null ? (
        blocker !== null ? (
          <div className="stack-tight">
            <p>{blocker}</p>
            <div className="row">
              <SettingsButton navigate={navigate} section="tiktok" />
            </div>
          </div>
        ) : writable ? (
          <div className="stack-tight">
            <p>내 틱톡 아이디: @{tiktok.tiktokId}</p>
            <div className="row">
              <button type="button" className="button" disabled={action.busy} onClick={() => void link()}>
                틱톡 잇기
              </button>
            </div>
          </div>
        ) : (
          <p>이은 틱톡 라이브가 없어요.</p>
        )
      ) : null}
      {action.error !== null && !asking ? <ErrorNote error={action.error} /> : null}
      {asking ? (
        <Modal
          title="틱톡 연결 끊기"
          onClose={() => {
            setAsking(false)
            action.setError(null)
          }}
          actions={
            <button type="button" className="button button-danger" disabled={action.busy} onClick={() => void unlink()}>
              끊기
            </button>
          }
        >
          <p>{TIKTOK_UNLINK_QUESTION}</p>
          {action.error !== null ? <ErrorNote error={action.error} /> : null}
        </Modal>
      ) : null}
    </section>
  )
}
