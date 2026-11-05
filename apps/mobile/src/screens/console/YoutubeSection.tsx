// 콘솔 유튜브 (YT-11 AC2·AC5·AC6·AC8, D-YT-SRV-03·06·07·09 — 웹 ConsoleYoutube와 같은 약속·문장).
// - 서버가 방송 주소만으로 읽으면(연결 응답 webChat): 구글 연결 없이 잇기(최근 이은 채널의 지금 방송 + 주소 붙여넣기), 처음 잇는 채널만 확인 줄.
// - 이은 방송: "유튜브 방송 · {채널 이름}", 수집 상태(서버 문장), "서버 연결로 받는 중", 받은 채팅 수, 끊긴 동안 빠짐.
// - 막힘·형식 바뀜·운영자 끔은 바로 맨 위 경고 + 대비 경로(문자찜·음성 안내, 댓글 붙여넣기는 웹으로 열기). 다시 받으면 "다시 받고 있어요" 한 줄.
// - 실시간 `youtube`(같은 연결)로 수집 상태가 바뀌면 다시 받는다. 리허설은 유튜브 요청을 보내지 않는다. 채널 이름·제목은 글자로만.
// - 방송 시작의 "주소 붙여넣기" 단계 (D-UX2-07): 클립보드에 유튜브 주소가 있으면 [붙여 넣기] 하나로 잇는다(앱으로 돌아올 때 다시 본다).
//   옛 공식 읽기 서버(구글 연결로 읽음)도 앱에서 잇는다 — 연결돼 있으면 같은 잇기 칸, 아니면 "먼저 연결" 안내와 연결 화면(웹으로 열기)·[다시 확인].
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CollectorView, ConnectionStatus, LinkView, LiveBroadcastItem, YoutubeConnectionResponse, YoutubeWebChat } from '@livejjim/web/src/api/types.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../../api/client.ts'
import { clipboardHasText } from '../../lib/clipboard.ts'
import { liveLinkOf } from '../../lib/live-link.ts'
import { BandPostPicker, TiktokConsentCard } from './OtherLinks.tsx'
import { PasteButton } from '../../native/paste.tsx'
import { PopNote, PopupDialog } from '../../ui/kit/index.ts'
import { openWeb } from '../../lib/open-web.ts'
import { useAppForeground } from '../../lib/use-app-state.ts'
import {
  FIRST_CHANNEL_GROUP,
  INVITED_CONFIRM_CODE,
  MOBILE_FALLBACK_HINT,
  NOT_CONFIGURED_MESSAGE,
  NO_BROADCAST_TITLE,
  NOT_CONNECTED_FIRST,
  NOT_CONNECTED_HELP,
  PASTE_COPIED,
  UNKNOWN_LINK,
  RECONNECT_FIRST,
  MY_CHANNEL_TITLE,
  RECENT_TITLE,
  RETRYING_WARN_MS,
  SERVER_ROUTE_SERVER,
  WEB_CHAT_OFF_MESSAGE,
  WEB_CHAT_RESUMED,
  broadcastChannelLine,
  channelName,
  firstChannelPopup,
  broadcastTitleText,
  LINK_CHECK_GROUP,
  linkCheckPopup,
  linkedChannelName,
  readModeOf,
  recentLine,
  resumeStep,
  warningLine,
  webChatTrouble,
  type ResumeStep,
} from '../../lib/youtube.ts'
import { useServices } from '../../services.tsx'
import { BigButton, Body, Card, Field, Hint, Notice, Row, Stack } from '../../ui/parts.tsx'

type Phase = 'loading' | 'hidden' | 'notConfigured' | 'ready'

export interface MobileYoutube {
  readonly phase: Phase
  readonly webChat: YoutubeWebChat | null
  /** 구글 연결 상태 (옛 공식 읽기 서버에서 잇기 칸을 열지 정한다) */
  readonly connection: ConnectionStatus | null
  readonly link: LinkView | null
  readonly resumed: boolean
  readonly retryingLong: boolean
  readonly broadcastId: string
  dismissResumed(): void
  setLink(view: LinkView): void
  reloadLink(): Promise<void>
  /** 연결 상태·잇기를 처음부터 다시 받는다 ("다시 확인") */
  reload(): Promise<void>
}

export function useMobileYoutube(broadcastId: string, enabled: boolean): MobileYoutube {
  const services = useServices()
  const [phase, setPhase] = useState<Phase>('loading')
  const [webChat, setWebChat] = useState<YoutubeWebChat | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [link, setLinkState] = useState<LinkView | null>(null)
  const [resume, setResume] = useState<ResumeStep>({ trouble: false, resumed: false })
  const [retryingLong, setRetryingLong] = useState(false)
  const version = useRef(0)
  const path = `/api/broadcasts/${encodeURIComponent(broadcastId)}/youtube`

  const reloadLink = useCallback(async () => {
    const mine = ++version.current
    try {
      const view = await get<LinkView>(path)
      if (mine === version.current) setLinkState(view)
    } catch {
      // 다음 알림·다시 붙을 때 다시 받는다
    }
  }, [path])
  const setLink = useCallback((view: LinkView) => {
    version.current++
    setLinkState(view)
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const body = await get<YoutubeConnectionResponse>('/api/youtube/connection')
      setWebChat(readModeOf(body).webChat)
      setConnection(body.connection?.status ?? null)
      setPhase('ready')
    } catch (error) {
      setPhase(isApiError(error) && error.code === 'YOUTUBE_NOT_CONFIGURED' ? 'notConfigured' : 'hidden')
      return
    }
    await reloadLink()
  }, [reloadLink])

  useEffect(() => {
    if (!enabled) return
    void loadAll()
    const view = services.stream.open()
    let readies = 0
    view.addEventListener('ready', () => {
      // 처음 붙을 때는 위에서 받았다 — 다시 붙을 때만 모두 다시 받는다
      if (readies++ > 0) void loadAll()
    })
    view.addEventListener('youtube', (event) => {
      type Data = { kind?: unknown; broadcast?: unknown; collector?: CollectorView } | null
      let data: Data
      try {
        data = JSON.parse(event.data) as Data
      } catch {
        return
      }
      if (data?.kind !== 'collector' || data.broadcast !== broadcastId) return
      const collector = data.collector ?? null
      version.current++
      setLinkState((current) => (current === null ? current : { ...current, collector }))
      void reloadLink()
    })
    return () => view.close()
  }, [enabled, broadcastId, services, loadAll, reloadLink])

  const collector = link?.collector ?? null
  useEffect(() => {
    setResume((previous) => {
      const next = resumeStep(previous, collector)
      return next.trouble === previous.trouble && next.resumed === previous.resumed ? previous : next
    })
  }, [collector])
  const status = collector?.status ?? null
  useEffect(() => {
    setRetryingLong(false)
    if (status !== 'RETRYING') return
    const timer = setTimeout(() => setRetryingLong(true), RETRYING_WARN_MS)
    return () => clearTimeout(timer)
  }, [status])
  const dismissResumed = useCallback(() => setResume((previous) => ({ ...previous, resumed: false })), [])

  return { phase: enabled ? phase : 'hidden', webChat, connection, link, resumed: enabled && resume.resumed, retryingLong, broadcastId, dismissResumed, setLink, reloadLink, reload: loadAll }
}

/** 맨 위 경고 (AC5·AC6·AC8) — 휴대폰은 확장 안내 없이 문자찜·음성·댓글 붙여넣기(앱 안 창 — D-APPX-03) */
export function YoutubeWarning({ yt, closed, onPaste }: { readonly yt: MobileYoutube; readonly closed: boolean; readonly onPaste?: () => void }) {
  if (closed || yt.phase !== 'ready') return null
  const line = warningLine(yt.link?.collector ?? null, yt.retryingLong)
  if (line === null) return null
  const web = yt.webChat !== null || webChatTrouble(yt.link?.collector ?? null)
  return (
    <Stack tight>
      <Notice tone="danger" alert label="유튜브 채팅 경고">
        {line}
      </Notice>
      {web ? (
        <>
          <Hint>{MOBILE_FALLBACK_HINT}</Hint>
          <Row wrap>
            {onPaste !== undefined ? <BigButton small label="댓글 붙여넣기" onPress={onPaste} /> : null}
          </Row>
        </>
      ) : null}
    </Stack>
  )
}

/** 유튜브 칸 */
export function YoutubeSection({ yt, closed }: { readonly yt: MobileYoutube; readonly closed: boolean }) {
  if (yt.phase === 'hidden' || yt.phase === 'loading') return null
  if (yt.phase === 'notConfigured') {
    return (
      <Card label="유튜브">
        <Body bold>유튜브</Body>
        <Body>{NOT_CONFIGURED_MESSAGE}</Body>
      </Card>
    )
  }
  const linked = yt.link?.link ?? null
  let body: ReactNode = null
  if (yt.link === null) {
    // 불러오는 중
  } else if (linked !== null) body = <LinkedStatus yt={yt} closed={closed} />
  else if (closed) body = <Body>이은 유튜브 방송이 없어요.</Body>
  else if (yt.webChat === null) body = yt.connection === 'CONNECTED' ? <LinkPicker yt={yt} /> : <ConnectFirst yt={yt} />
  else if (!yt.webChat.on) body = <Notice tone="warning">{WEB_CHAT_OFF_MESSAGE}</Notice>
  else body = <LinkPicker yt={yt} />
  return (
    <Card label="유튜브">
      <Body bold>유튜브</Body>
      {body}
    </Card>
  )
}

function LinkedStatus({ yt, closed }: { readonly yt: MobileYoutube; readonly closed: boolean }) {
  const link = yt.link?.link ?? null
  const collector = yt.link?.collector ?? null
  const [error, setError] = useState<string | null>(null)
  const name = yt.webChat !== null ? linkedChannelName(link) : null
  const restart = async () => {
    setError(null)
    try {
      yt.setLink(await withRetry(() => post<LinkView>(`/api/broadcasts/${encodeURIComponent(yt.broadcastId)}/youtube/collector/restart`, {})))
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : '다시 받지 못했어요. 다시 눌러 주세요.')
    }
  }
  return (
    <Stack tight>
      {name !== null ? <Body bold>{broadcastChannelLine(name)}</Body> : null}
      {yt.resumed ? (
        <Stack tight>
          <Notice tone="info">{WEB_CHAT_RESUMED}</Notice>
          <Row>
            <BigButton small label="확인했어요" onPress={yt.dismissResumed} />
          </Row>
        </Stack>
      ) : null}
      {collector !== null ? (
        <>
          <Body>
            {collector.status === 'CHAT_ENDED' ? '유튜브 채팅이 끝났어요.' : collector.statusMessage}
            {collector.reasonMessage !== null && collector.reasonMessage !== collector.statusMessage ? ` — ${collector.reasonMessage}` : ''}
          </Body>
          {collector.status === 'LIVE' && collector.mode === 'WEB' ? <Body>● {SERVER_ROUTE_SERVER}</Body> : null}
          <Body>받은 채팅 {collector.recorded.toLocaleString('ko-KR')}개</Body>
          {collector.gap && collector.gapMessage !== null ? <Notice tone="warning">{collector.gapMessage}</Notice> : null}
          {!closed && collector.restartable ? <BigButton small label="채팅 다시 받기" onPress={() => void restart()} /> : null}
        </>
      ) : null}
      {error !== null ? (
        <Notice tone="danger" alert>
          {error}
        </Notice>
      ) : null}
    </Stack>
  )
}

/** 옛 공식 읽기 서버에서 구글 연결이 없거나 끊김: 무엇을 하면 되는지 + 연결 화면(웹) + 다시 확인 */
function ConnectFirst({ yt }: { readonly yt: MobileYoutube }) {
  return (
    <Stack tight>
      <Notice tone="warning">{yt.connection === 'RECONNECT_NEEDED' ? RECONNECT_FIRST : NOT_CONNECTED_FIRST}</Notice>
      <Hint>{NOT_CONNECTED_HELP}</Hint>
      <BigButton label="유튜브 연결하러 가기" ariaLabel="유튜브 연결하러 가기 (웹으로 열기)" primary onPress={() => void openWeb('/settings/youtube')} />
      <BigButton label="다시 확인" onPress={() => void yt.reload()} />
      <Hint>{MOBILE_FALLBACK_HINT}</Hint>
    </Stack>
  )
}

/** 방송 시작 흐름에서 주소 단계를 이미 거친 방송 (D-UX3-06): 방송 화면이 연결 판을 다시 저절로 열지 않는다 */
const linkAsked = new Set<string>()
export function markLinkAsked(broadcastId: string): void {
  linkAsked.add(broadcastId)
}
export function wasLinkAsked(broadcastId: string): boolean {
  return linkAsked.has(broadcastId)
}

function LinkPicker({ yt }: { readonly yt: MobileYoutube }) {
  const { fields, action, popup } = useAddressLinker({ webChat: yt.webChat, broadcastId: yt.broadcastId, submit: async (request) => {
      const view = await sendLiveLink(yt.broadcastId, request)
      if (view !== null) yt.setLink(view)
    } })
  return (
    <Stack tight>
      {fields}
      {action}
      {popup}
    </Stack>
  )
}

export interface LinkBody {
  readonly requestId: string
  readonly video: string
  readonly confirmInvited?: true
}

/** 어느 플랫폼에 무엇을 보내 잇나 (D-UX3-14) */
export type LiveLinkRequest =
  | { readonly platform: 'youtube'; readonly body: LinkBody }
  | { readonly platform: 'tiktok'; readonly body: { readonly requestId: string; readonly url: string; readonly move?: true } }
  | { readonly platform: 'band'; readonly body: { readonly requestId: string; readonly bandKey: string; readonly postKey: string } }

/** 잇기 요청 보내기 — 유튜브면 받은 연결 보기, 틱톡·밴드는 null */
export async function sendLiveLink(broadcastId: string, request: LiveLinkRequest): Promise<LinkView | null> {
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}`
  if (request.platform === 'youtube') return withRetry(() => post<LinkView>(`${base}/youtube`, request.body))
  await withRetry(() => post(request.platform === 'tiktok' ? `${base}/tiktok/link-url` : `${base}/band/link`, request.body))
  return null
}

export interface AddressLinkerOptions {
  readonly webChat: YoutubeWebChat | null
  /** 아직 만들기 전이면 null — 다른 방송에 이어진 것만 막는다 */
  readonly broadcastId: string | null
  /** 잇기 요청 (유튜브·틱톡·밴드, D-UX3-14). 거절은 그대로 던지면 여기서 문장·확인 줄로 보인다 */
  readonly submit: (request: LiveLinkRequest) => Promise<void>
  readonly label?: string
  readonly autoFocus?: boolean
  readonly disabled?: boolean
  /** false면 클립보드·내 채널 목록을 보지 않는다(화면이 닫혀 있을 때) */
  readonly enabled?: boolean
  /** 링크 칸을 고치기 시작했을 때 (화면의 다른 오류 문장도 지우게) */
  readonly onEdit?: () => void
}

/** 다른 방송에 틱톡이 이어져 있을 때 (D-UX3-17) — 서버 TIKTOK_ELSEWHERE 문장과 같은 뜻, 팝업이라 줄을 나눈다 (D-UX4-02) */
export const TIKTOK_MOVE_QUESTION = '다른 방송에 틱톡이 이어져 있어요.\n이 방송으로 옮길까요?'

/** 잇기 거절을 짧게 (D-UX3-11, 사용자 지시 2026-11-03 "구체적으로 말고 추상적으로 짧게"). 모르는 거절은 서버 문장 그대로 */
const SHORT_LINK_ERRORS: Readonly<Record<string, string>> = {
  INVALID_VIDEO_URL: UNKNOWN_LINK,
  NO_LIVE_CHAT: '라이브 채팅을 받을 수 없는 방송이에요.',
  YOUTUBE_NOT_PUBLIC: '공개 방송만 이을 수 있어요.',
  YOUTUBE_UNAVAILABLE: '지금은 이을 수 없어요. 잠시 뒤 다시 눌러 주세요.',
  INVALID_TIKTOK_LINK: UNKNOWN_LINK,
}
export function shortLinkError(error: ApiError): string {
  return SHORT_LINK_ERRORS[error.code] ?? error.message
}

/**
 * "방송 주소" 칸 + 내 채널 방송 목록 + 처음 잇는 채널 확인 (fields) 과 [확인] (action — D-UX3-13, 전 [이 방송에 잇기] — 주소를 넣기 전엔 null, D-UX3-07).
 * 방송 화면 연결과 새 방송 화면이 함께 쓴다 (D-UX3-06). 단추는 화면 맨 아래(키보드 위)에 두라고 따로 준다.
 */
export function useAddressLinker({ webChat, broadcastId, submit, label = '확인', autoFocus, disabled, enabled = true, onEdit }: AddressLinkerOptions): { readonly fields: ReactNode; readonly action: ReactNode | null; readonly popup: ReactNode; readonly busy: boolean; readonly recheck: () => Promise<void> } {
  const [recent, setRecent] = useState<readonly LiveBroadcastItem[] | null>(null)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 잇기 전 확인 (D-UX4-08): title이 있으면 미리 본 방송(제목·채널), 없으면 서버가 처음 잇는 채널이라고 알린 것 */
  const [ask, setAsk] = useState<{ video: string; name: string; title: string | null } | null>(null)
  // 팝업이 닫히는 동안에도 채널 이름이 남아 있게
  const shownAsk = useRef(ask)
  if (ask !== null) shownAsk.current = ask
  const pending = useRef<{ video: string; confirmed: boolean; requestId: string } | null>(null)
  const [canPaste, setCanPaste] = useState(false)
  const [note, setNote] = useState<{ id: number; message: string } | null>(null)
  /** 틱톡 동의 안내·밴드 글 고르기 (D-UX3-14), 다른 방송의 틱톡을 옮길지 묻기 (D-UX3-17) */
  const [step, setStep] = useState<'none' | 'tiktokConsent' | 'tiktokMove' | 'bandPick'>('none')

  // 클립보드는 읽지 않고 글이 있는지만 본다 — 아이폰 "붙여넣기 허용" 창이 뜨지 않게 (D-UX3-11).
  // 글이 있으면 빈 링크 칸 오른쪽에 [붙여넣기](아이폰 기본 단추 — 누르는 것이 허락). 칸을 열 때와 앱·브라우저에서 돌아올 때 다시 본다.
  const peek = useCallback(async () => {
    if (!enabled) return
    setCanPaste(await clipboardHasText())
  }, [enabled])
  useEffect(() => {
    void peek()
  }, [peek])
  useAppForeground({ onForeground: () => void peek() })

  // 못 찾으면 목록만 감춘다 — 링크를 붙여 넣으면 된다 (D-LIVETEST-09)
  const search = useCallback(async () => {
    if (!enabled) return
    setRecent(null)
    try {
      const { broadcasts } = await get<{ broadcasts: LiveBroadcastItem[] }>('/api/youtube/live-broadcasts')
      setRecent(broadcasts)
    } catch {
      setRecent([])
    }
  }, [enabled])
  // 잇기 칸을 열 때 한 번 (되풀이해 찾지 않는다, D-YT-SRV-03)
  useEffect(() => {
    void search()
  }, [search])

  /** 고치기 시작하면 오류 문장·확인 줄을 걷는다 (D-UX3-11) */
  const edit = (text: string) => {
    setAddress(text)
    setAsk(null)
    setError(null)
    setStep('none')
    onEdit?.()
  }
  const paste = (text: string) => {
    const found = liveLinkOf(text)
    edit(found?.url ?? text.trim())
    if (found === null) setError(UNKNOWN_LINK)
    else setNote((now) => ({ id: (now?.id ?? 0) + 1, message: PASTE_COPIED }))
  }

  /** 틱톡·밴드 잇기 요청 (요청 번호는 같은 것을 다시 보낼 때 그대로) */
  const other = useRef<{ key: string; requestId: string } | null>(null)
  const sendOther = async (request: (requestId: string) => LiveLinkRequest, key: string) => {
    if (busy || disabled === true) return
    if (other.current?.key !== key) other.current = { key, requestId: newRequestId() }
    setBusy(true)
    setError(null)
    try {
      await submit(request(other.current.requestId))
      other.current = null
      setStep('none')
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.retryable) other.current = null
      if (caught.code === 'NO_CONSENT') setStep('tiktokConsent')
      else if (caught.code === 'TIKTOK_ELSEWHERE') setStep('tiktokMove')
      else {
        setStep('none')
        setError(shortLinkError(caught))
      }
    } finally {
      setBusy(false)
    }
  }
  /** [확인]: 링크가 어느 플랫폼인지 보고 잇는다 — 유튜브는 그대로, 틱톡은 서버가 아이디를 읽고, 밴드는 글을 고르게 한다 */
  const confirm = (text: string) => {
    const found = liveLinkOf(text)
    if (found === null) {
      // 유튜브 영상 번호만 넣은 것도 서버가 판정한다 (전과 같다)
      if (!/[/.\s]/.test(text)) void check(text)
      else setError(UNKNOWN_LINK)
      return
    }
    if (found.platform === 'youtube') void check(found.url)
    else if (found.platform === 'tiktok') void sendOther((requestId) => ({ platform: 'tiktok', body: { requestId, url: found.url } }), `tiktok ${found.url}`)
    else {
      setError(null)
      setStep('bandPick')
    }
  }

  /** 서버 읽기면 잇기 전에 늘 방송 제목·채널 이름을 미리 보고 확인 팝업을 띄운다 (D-UX4-08 — 처음이든 아니든). 미리 보기가 없는 서버면 옛 흐름 */
  const check = async (video: string) => {
    if (busy || disabled === true || video.trim() === '') return
    if (webChat === null) {
      void link(video)
      return
    }
    setBusy(true)
    setError(null)
    setAsk(null)
    let fallback = false
    try {
      const seen = await withRetry(() => post<{ title?: unknown; channelTitle?: unknown }>('/api/youtube/preview', { video }))
      setAsk({ video, name: channelName(seen.channelTitle), title: broadcastTitleText(seen.title) })
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (caught.code === 'PREVIEW_UNAVAILABLE') fallback = true
      else setError(shortLinkError(caught))
    } finally {
      setBusy(false)
    }
    if (fallback) void link(video)
  }

  const link = async (video: string, confirmed = false) => {
    if (busy || disabled === true || video.trim() === '') return
    if (pending.current?.video !== video || pending.current.confirmed !== confirmed) pending.current = { video, confirmed, requestId: newRequestId() }
    const { requestId } = pending.current
    setBusy(true)
    setError(null)
    setAsk(null)
    try {
      const body: LinkBody = confirmed ? { requestId, video, confirmInvited: true } : { requestId, video }
      await submit({ platform: 'youtube', body })
      pending.current = null
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.retryable) pending.current = null
      if (!confirmed && caught.code === INVITED_CONFIRM_CODE) {
        const channel = caught.details.channel
        const title = typeof channel === 'object' && channel !== null ? (channel as { title?: unknown }).title : undefined
        setAsk({ video, name: channelName(title), title: null })
      } else setError(shortLinkError(caught))
    } finally {
      setBusy(false)
    }
  }

  const recentTitle = webChat === null ? MY_CHANNEL_TITLE : RECENT_TITLE
  const off = busy || disabled === true
  const fields = (
    <Stack tight>
      <Field
        label="방송 링크"
        value={address}
        onChangeText={edit}
        problem={error}
        inputMode="url"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        trailing={canPaste ? <PasteButton onPaste={paste} /> : null}
      />
      {/* 내 채널(최근 이은 채널)에서 지금 하는 방송 — 있을 때만, 링크를 붙이지 않고 바로 잇기 */}
      {(recent ?? []).length > 0 ? (
      <Card label={recentTitle}>
        <Body bold>{recentTitle}</Body>
        {(recent ?? []).map((item) => {
          const other = item.linkedBroadcast !== null && item.linkedBroadcast !== broadcastId
          // 내 채널 목록(구글 연결로 읽는 서버)에는 채널 이름이 없다 — 제목만 ("(이름 없음)"을 보이지 않게)
          const line = webChat === null ? (item.title.trim() === '' ? NO_BROADCAST_TITLE : item.title) : recentLine(item)
          return (
            <Stack tight key={item.videoId}>
              <Body>
                {line} · {item.status === 'LIVE' ? '방송 중' : '예정'}
                {other ? ' · 다른 방송에 이어져 있어요' : ''}
              </Body>
              <Row>
                <BigButton small label="잇기" ariaLabel={`${line} 잇기`} disabled={off || other} onPress={() => void check(item.videoId)} />
              </Row>
            </Stack>
          )
        })}
      </Card>
      ) : null}
      {step === 'tiktokConsent' ? <TiktokConsentCard disabled={off} onAgreed={() => confirm(address.trim())} onCancel={() => setStep('none')} /> : null}
      {step === 'bandPick' ? <BandPostPicker disabled={off} onCancel={() => setStep('none')} onPick={(bandKey, postKey) => void sendOther((requestId) => ({ platform: 'band', body: { requestId, bandKey, postKey } }), `band ${bandKey} ${postKey}`)} /> : null}
      {/* 확인은 화면 안 줄이 아니라 가운데 팝업으로 — 왼쪽 부정, 오른쪽 긍정 (D-UX4-01·02) */}
      <PopupDialog
        visible={step === 'tiktokMove'}
        message={TIKTOK_MOVE_QUESTION}
        cancelLabel="취소"
        confirmLabel="옮기기"
        busy={off}
        onCancel={() => setStep('none')}
        onConfirm={() => {
          const url = liveLinkOf(address.trim())?.url ?? address.trim()
          void sendOther((requestId) => ({ platform: 'tiktok', body: { requestId, url, move: true } }), `tiktok-move ${url}`)
        }}
      />
      <PopupDialog
        visible={ask !== null}
        name={shownAsk.current?.title == null ? FIRST_CHANNEL_GROUP : LINK_CHECK_GROUP}
        message={shownAsk.current?.title == null ? firstChannelPopup(shownAsk.current?.name ?? '') : linkCheckPopup(shownAsk.current.title, shownAsk.current.name)}
        cancelLabel="아니에요"
        confirmLabel="맞아요"
        busy={off}
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          if (ask !== null) void link(ask.video, true)
        }}
      />
    </Stack>
  )
  // 링크를 넣기 전엔 단추를 보이지 않는다 (D-UX3-07)
  const action = address.trim() === '' || step !== 'none' ? null : <BigButton label={label} primary disabled={off} onPress={() => confirm(address.trim())} />
  // recheck: 앱 안 브라우저를 닫고 돌아왔을 때 클립보드를 다시 본다(앱이 뒤로 가지 않아 앞으로 옴 알림이 없다)
  return { fields, action, popup: <PopNote note={note} />, busy, recheck: peek }
}
