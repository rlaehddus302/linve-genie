// 콘솔의 인스타그램·틱톡 칸과 여러 플랫폼 안내 (SPEC §7 화면 2, PLT-01·02·03, D-N2b-2-02·13, AC-N2b-2-60~64).
// - 플랫폼 칸은 스크롤 영역(고정 영역 밖)에 둔다: 유튜브(지금 칸 그대로) · 인스타그램 · 틱톡. 둘 이상 이으면 칸 위에 도착순 안내.
//   리허설 회차는 인스타그램·틱톡 칸 대신 "리허설 방송에는 라이브를 이을 수 없어요." 한 줄이고 인스타그램·틱톡 요청을 보내지 않는다.
// - 고정 영역에 줄을 더하지 않는다(UX-04 35%, TE-N2b-2-001): 틱톡 알림 줄(누르면 붙여넣기 창)·인스타그램 알림(LIVE_MOVED 등 — 문장 그대로,
//   누르면 인스타그램 칸의 알림 목록으로)·붙여넣기 결과는 알림 띠 맨 앞 항목이다(platformLeads). 휴대폰에서는 띠와 함께 한 줄로 접힌다.
//   인스타그램 알림의 "닫기"는 인스타그램 칸의 알림 목록에 있다.
// - 틱톡 저장 실패(확인하지 않은 수 = saveFailed − saveFailedSeen)가 있으면 알림 띠 줄 옆과 틱톡 칸에 "확인했어요"(D-N2b-2-16) —
//   누르면 보던 saveFailed를 upTo로 보낸다. 끊긴 동안의 missed(CONNECTED)는 칸 경고만이고 끄는 단추가 없다(D-N2b-2-15).
// - 쓰기 응답(잇기·끊기·다시 연결)은 그사이 SSE로 더 새 상태가 오지 않았을 때만 넣는다 — 왔으면 서버 상태를 다시 받는다(TE-N2b-2-003).
// - 실시간: 범위 저장소의 같은 연결로 SSE `instagram`·`tiktok`을 받는다(새로 고침 없이). 끊겼다 이어지면 모두 다시 받는다.
//   댓글 수는 알림마다 오지 않으므로 새 채팅이 들어오면 모아서 한 번 다시 받는다.
// - MOB1 D-MOB1-09(AC-MOB1-15): 휴대폰 폭에서는 쓸 수 없는 칸("준비되지 않았어요"·"연결 안 함"·틱톡 막힘 문장 + "설정으로"뿐)을 그리지 않는다 —
//   이 방송에 이었거나 이을 수 있는 칸, 알림·오류가 있는 칸, 다시 연결할 칸은 그대로. PC 폭과 리허설 한 줄은 그대로.
// 서버 문장(수집 상태·오류·알림)은 고치지 않고 그대로 보인다. 아이디·라이브 ID는 글자로만 보인다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, newRequestId, post, withRetry, withQuery, type ApiError } from '../api/client.ts'
import type { BroadcastLive, InstagramConnection, InstagramDmRow, InstagramLinkView, InstagramLive, PlatformCapability, TikTokLinkView, TikTokSettings } from '../api/types.ts'
import type { ConsoleStore } from '../lib/console-store.ts'
import type { AlertLead } from './AlertStrip.tsx'
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
  TIKTOK_SAVE_FAILED_SEEN,
  TIKTOK_UNLINK_QUESTION,
  failedDmCount,
  failedDmMessage,
  tiktokBlocker,
  tiktokDirectMessage,
  tiktokNeedsPaste,
  tiktokReconnectable,
  tiktokUnseenSaveFailed,
} from '../lib/platforms.ts'
import { routePath, type Navigate, type SettingsSection } from '../lib/router.ts'
import { useWide } from '../lib/use-wide.ts'
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
  /** 쓰기를 보내기 직전에 받아 둔다 (응답을 넣을 때 그사이 더 새 상태가 왔는지 본다) */
  igStamp(): number
  ttStamp(): number
  /** 쓰기 응답: 그사이 SSE·조회로 상태가 바뀌지 않았으면 넣고, 바뀌었으면 서버 상태를 다시 받는다 */
  acceptIgLink(view: InstagramLinkView, stamp: number): void
  acceptTtLink(view: TikTokLinkView, stamp: number): void
  dismissNotice(id: number): void
  reload(): Promise<void>
  /** 저장 실패 "확인했어요" (D-N2b-2-16) — upTo = 화면이 보고 있던 saveFailed */
  ackTtSaveFailed(upTo: number): Promise<void>
  readonly ttSeenBusy: boolean
  readonly ttSeenError: ApiError | null
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
  const [ttSeenBusy, setTtSeenBusy] = useState(false)
  const [ttSeenError, setTtSeenError] = useState<ApiError | null>(null)
  const ttSeenSending = useRef(false)
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

  const igStamp = useCallback(() => igVersion.current, [])
  const ttStamp = useCallback(() => ttVersion.current, [])
  const acceptIgLink = useCallback(
    (view: InstagramLinkView, stamp: number) => {
      if (!alive.current) return
      if (stamp === igVersion.current) setIgLink(view)
      else void reloadIgLink()
    },
    [setIgLink, reloadIgLink],
  )
  const acceptTtLink = useCallback(
    (view: TikTokLinkView, stamp: number) => {
      if (!alive.current) return
      if (stamp === ttVersion.current) setTtLink(view)
      else void reloadTtLink()
    },
    [setTtLink, reloadTtLink],
  )

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

  // 저장 실패 확인 (D-N2b-2-16): 서버는 max(지금, min(upTo, saveFailed))로 적는다 — 같은 요청을 다시 보내도 같다(자동 다시 보내기 안전)
  const ackTtSaveFailed = useCallback(
    async (upTo: number) => {
      if (ttSeenSending.current) return
      ttSeenSending.current = true
      setTtSeenBusy(true)
      setTtSeenError(null)
      const stamp = ttVersion.current
      try {
        const { link } = await withRetry(() => post<{ link: TikTokLinkView }>(`${base}/tiktok/save-failed-seen`, { upTo }))
        acceptTtLink(link, stamp)
      } catch (error) {
        if (!isApiError(error)) throw error
        if (alive.current) setTtSeenError(error)
      } finally {
        ttSeenSending.current = false
        if (alive.current) setTtSeenBusy(false)
      }
    },
    [base, acceptTtLink],
  )

  // 확인할 저장 실패가 없어지면(응답·SSE) 앞선 확인 오류는 지운다
  const unseen = tiktokUnseenSaveFailed(ttLink?.state === 'LINKED' ? ttLink.collection : null)
  useEffect(() => {
    if (unseen === 0) setTtSeenError(null)
  }, [unseen])

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
    igStamp,
    ttStamp,
    acceptIgLink,
    acceptTtLink,
    dismissNotice,
    reload,
    ackTtSaveFailed,
    ttSeenBusy,
    ttSeenError,
  }
}

/** 틱톡 댓글이 들어오지 않는다 (알림 줄·주 단추) */
export function tiktokTrouble(live: ConsolePlatforms): boolean {
  return live.enabled && live.ttLink?.state === 'LINKED' && tiktokNeedsPaste(live.ttLink.collection, live.ttLink.extension ?? null)
}

// ── 알림 띠 맨 앞 항목 (고정 영역에 줄을 더하지 않는다) ─────────────────

/** 인스타그램 칸의 알림 목록 (띠의 인스타그램 알림을 누르면 여기로) */
export const INSTAGRAM_NOTICES_ID = 'instagram-notices'

function showInstagramNotices(): void {
  // 포커스를 옮기면 브라우저가 그 목록이 보이게 굴린다
  document.getElementById(INSTAGRAM_NOTICES_ID)?.focus()
}

/**
 * 알림 띠 맨 앞에 붙일 플랫폼 줄 (AC-N2b-2-60·62·63, UX-04): 붙여넣기 결과(10초) · 틱톡 알림 줄 · 인스타그램 알림(가장 최근 것).
 * 휴대폰에서는 띠와 함께 한 줄로 접히고 긴 문장은 말줄임이다(전문은 단추 이름·"펼치기"·인스타그램 칸).
 */
export function platformLeads({ live, sealed, onPaste, pasteNote }: { readonly live: ConsolePlatforms; readonly sealed: boolean; readonly onPaste: () => void; readonly pasteNote: string | null }): AlertLead[] {
  const leads: AlertLead[] = []
  if (pasteNote !== null) leads.push({ key: 'paste-note', text: pasteNote })
  if (!sealed && tiktokTrouble(live)) {
    // 확인하지 않은 저장 실패가 있으면 그 줄 옆에 "확인했어요" (D-N2b-2-16)
    const collection = live.ttLink?.collection ?? null
    const action =
      collection !== null && tiktokUnseenSaveFailed(collection) > 0
        ? { label: TIKTOK_SAVE_FAILED_SEEN, onClick: () => void live.ackTtSaveFailed(collection.saveFailed), busy: live.ttSeenBusy }
        : undefined
    leads.push({ key: 'tiktok', text: TIKTOK_PASTE_ALERT, onClick: onPaste, ...(action !== undefined ? { action } : {}) })
  }
  const notice = live.notices.at(-1)
  if (notice !== undefined) leads.push({ key: 'instagram', text: notice.message, onClick: showInstagramNotices, soft: true })
  return leads
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
  return <LivePanels {...props} />
}

function LivePanels(props: PlatformPanelsProps) {
  const wide = useWide()
  return (
    <>
      <InstagramPanel {...props} hideIdle={!wide} />
      <TikTokPanel {...props} hideIdle={!wide} />
    </>
  )
}

/** 휴대폰에서 숨길 칸 — 쓸 수 없음·연결 안 함 문장과 "설정으로"뿐인 칸 (D-MOB1-09) */
interface IdleProps {
  readonly hideIdle: boolean
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

function InstagramPanel({ live, broadcastId, navigate, ended, sealed, hideIdle }: PlatformPanelsProps & IdleProps) {
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

  const wait = () =>
    action.run(async () => {
      const stamp = live.igStamp()
      live.acceptIgLink((await send<{ link: InstagramLinkView }>(ids, 'wait', `${base}/wait`, (requestId) => ({ requestId, platform: 'INSTAGRAM' }))).link, stamp)
    })
  const link = (liveId: string) =>
    action.run(async () => {
      const stamp = live.igStamp()
      live.acceptIgLink((await send<{ link: InstagramLinkView }>(ids, `link:${liveId}`, `${base}/link`, (requestId) => ({ requestId, platform: 'INSTAGRAM', liveId }))).link, stamp)
      setLivesOpen(false)
    })
  const unlink = () =>
    action.run(async () => {
      const stamp = live.igStamp()
      live.acceptIgLink((await send<{ link: InstagramLinkView }>(ids, 'unlink', `${base}/unlink`, (requestId) => ({ requestId, platform: 'INSTAGRAM' }))).link, stamp)
      setAsking(false)
    })
  // 연결 상태가 바뀌면(SSE·응답) 앞선 조작의 오류 문장은 지운다 (UX-N2b-2-03)
  const igState = igLink === null ? null : `${igLink.state}:${igLink.collection?.state ?? ''}`
  const clearIgError = action.setError
  useEffect(() => clearIgError(null), [igState, clearIgError])

  const open = igLink !== null && igLink.state !== 'NONE'
  const collection = igLink?.collection ?? null
  const idle = instagram !== null && (!instagram.configured || instagram.status === 'NOT_CONNECTED') && !open && live.notices.length === 0 && live.dmFailed === 0 && action.error === null && !asking
  if (hideIdle && idle) return null
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
          <button
            type="button"
            className="button"
            disabled={action.busy}
            onClick={() => {
              action.setError(null)
              setAsking(true)
            }}
          >
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
        <ul id={INSTAGRAM_NOTICES_ID} className="plain-list stack-tight" aria-label="인스타그램 알림" tabIndex={-1}>
          {live.notices.map((notice) => (
            <li key={notice.id} className="notice platform-notice">
              <span>{notice.message}</span>
              <button type="button" className="button button-small" aria-label="인스타그램 알림 닫기" onClick={() => live.dismissNotice(notice.id)}>
                닫기
              </button>
            </li>
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

function TikTokPanel({ live, broadcastId, navigate, ended, sealed, onPaste, hideIdle }: PlatformPanelsProps & IdleProps) {
  const { tiktok, ttLink } = live
  const action = useAction()
  const ids = useRequestIds()
  const [asking, setAsking] = useState(false)
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}`
  const writable = !ended && !sealed
  const linked = ttLink !== null && ttLink.state === 'LINKED'
  const collection = ttLink?.collection ?? null
  // 크롬 확장 쪽 받는 길·경고 (TTX D-TTX-09) — 상태가 한 번도 없던 회차는 줄 없이 지금 화면 그대로
  const extension = linked && ttLink.extension != null && ttLink.extension.state !== 'NONE' ? ttLink.extension : null
  // 확장 상태가 없던 회차(NONE)에만 서버가 주는 안내 한 줄 (D-TTX-17 — AC-TTX-20 "지금 화면 그대로"의 예외)
  const extensionHint = linked ? (ttLink.extension?.hint ?? null) : null
  const reason = live.platforms?.find((item) => item.platform === 'TIKTOK')?.reasons.ready

  const link = () =>
    action.run(async () => {
      const stamp = live.ttStamp()
      live.acceptTtLink((await send<{ link: TikTokLinkView }>(ids, 'link', `${base}/live/link`, (requestId) => ({ requestId, platform: 'TIKTOK' }))).link, stamp)
    })
  const unlink = () =>
    action.run(async () => {
      const stamp = live.ttStamp()
      live.acceptTtLink((await send<{ link: TikTokLinkView }>(ids, 'unlink', `${base}/live/unlink`, (requestId) => ({ requestId, platform: 'TIKTOK' }))).link, stamp)
      setAsking(false)
    })
  const reconnect = () =>
    action.run(async () => {
      const stamp = live.ttStamp()
      live.acceptTtLink((await withRetry(() => post<{ link: TikTokLinkView }>(`${base}/tiktok/reconnect`, {}))).link, stamp)
    })
  // 연결 상태가 바뀌면(SSE·응답) 앞선 조작의 오류 문장("잠시 뒤 다시 눌러 주세요." 등)은 지운다 (UX-N2b-2-03)
  const ttState = ttLink === null ? null : `${ttLink.state}:${ttLink.collection?.state ?? ''}:${ttLink.collection?.reason ?? ''}`
  const clearTtError = action.setError
  useEffect(() => clearTtError(null), [ttState, clearTtError])

  const trouble = tiktokTrouble(live)
  const blocker = tiktok === null ? null : tiktokBlocker(tiktok, reason)
  if (hideIdle && !linked && blocker !== null && action.error === null && !asking) return null
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
              {tiktokDirectMessage(collection, extension) !== null ? (
                <p>
                  <strong>{tiktokDirectMessage(collection, extension)}</strong>
                </p>
              ) : null}
              {extension?.route != null ? (
                <p className="tiktok-route" role="status" aria-label="틱톡 댓글 받는 길">
                  {extension.route}
                </p>
              ) : null}
              {extensionHint !== null && extensionHint !== '' ? <p className="tiktok-hint">{extensionHint}</p> : null}
              {extension?.warning != null ? <p className="warning">{extension.warning}</p> : null}
              {collection.missed && collection.missedMessage !== null ? <p className="warning">{collection.missedMessage}</p> : null}
              {!sealed && tiktokUnseenSaveFailed(collection) > 0 ? (
                <div className="row">
                  <button
                    type="button"
                    className="button"
                    aria-busy={live.ttSeenBusy}
                    disabled={live.ttSeenBusy}
                    onClick={() => void live.ackTtSaveFailed(collection.saveFailed)}
                  >
                    {TIKTOK_SAVE_FAILED_SEEN}
                  </button>
                </div>
              ) : null}
              {live.ttSeenError !== null ? <ErrorNote error={live.ttSeenError} /> : null}
              <p>받은 댓글 {groupDigits(collection.comments)}개</p>
              {collection.lastCommentAt !== null ? <p>마지막 댓글 {kstClockWords(collection.lastCommentAt)}</p> : null}
            </>
          ) : null}
          {!sealed ? (
            // 단추 자리는 늘 붙여넣기 → 다시 연결 → 끊기 (U-TTX-04 — 방송 중 손에 익은 자리에 "끊기"가 오지 않게, 강조만 바뀐다)
            <div className="row">
              <button type="button" className={trouble ? 'button button-primary' : 'button'} onClick={onPaste}>
                댓글 붙여넣기
              </button>
              {writable && tiktokReconnectable(collection) ? (
                <button type="button" className="button" disabled={action.busy} onClick={() => void reconnect()}>
                  다시 연결
                </button>
              ) : null}
              <button
                type="button"
                className="button"
                disabled={action.busy}
                onClick={() => {
                  action.setError(null)
                  setAsking(true)
                }}
              >
                끊기
              </button>
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
