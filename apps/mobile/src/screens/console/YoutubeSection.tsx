// 콘솔 유튜브 (YT-11 AC2·AC5·AC6·AC8, D-YT-SRV-03·06·07·09 — 웹 ConsoleYoutube와 같은 약속·문장).
// - 서버가 방송 주소만으로 읽으면(연결 응답 webChat): 구글 연결 없이 잇기(최근 이은 채널의 지금 방송 + 주소 붙여넣기), 처음 잇는 채널만 확인 줄.
// - 이은 방송: "유튜브 방송 · {채널 이름}", 수집 상태(서버 문장), "서버 연결로 받는 중", 받은 채팅 수, 끊긴 동안 빠짐.
// - 막힘·형식 바뀜·운영자 끔은 바로 맨 위 경고 + 대비 경로(문자찜·음성 안내, 댓글 붙여넣기는 웹으로 열기). 다시 받으면 "다시 받고 있어요" 한 줄.
// - 실시간 `youtube`(같은 연결)로 수집 상태가 바뀌면 다시 받는다. 리허설은 유튜브 요청을 보내지 않는다. 채널 이름·제목은 글자로만.
// - 방송 시작의 "주소 붙여넣기" 단계 (D-UX2-07): 클립보드에 유튜브 주소가 있으면 [붙여 넣기] 하나로 잇는다(앱으로 돌아올 때 다시 본다).
//   옛 공식 읽기 서버(구글 연결로 읽음)도 앱에서 잇는다 — 연결돼 있으면 같은 잇기 칸, 아니면 "먼저 연결" 안내와 연결 화면(웹으로 열기)·[다시 확인].
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CollectorView, ConnectionStatus, LinkView, LiveBroadcastItem, RecentChannel, RecentTiktok, YoutubeConnectionResponse, YoutubeWebChat } from '@livejjim/web/src/api/types.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../../api/client.ts'
import { clipboardHasText } from '../../lib/clipboard.ts'
import { liveLinkOf } from '../../lib/live-link.ts'
import { BandPostPicker, TiktokConsentCard } from './OtherLinks.tsx'
import { PasteButton } from '../../native/paste.tsx'
import { Appear, FormPage, PopNote, PopupDialog, RADIUS, SoftChip, SPACE, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { PlatformIcon } from '../../ui/PlatformIcon.tsx'
import { ChannelPhoto, useChannelAvatar } from '../../ui/ChannelPhoto.tsx'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { BackHandler, Image, Platform, View } from 'react-native'
import { useHoldRouteSwipe } from '../../ui/kit/route-swipe.tsx'
import { EdgeSwipeBack, SlideSwitch } from '../../ui/kit/slide.tsx'
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
  RETRYING_WARN_MS,
  SERVER_ROUTE_SERVER,
  WEB_CHAT_OFF_MESSAGE,
  WEB_CHAT_RESUMED,
  broadcastChannelLine,
  channelName,
  firstChannelPopup,
  broadcastTitleText,
  linkedChannelName,
  readModeOf,
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
export function YoutubeWarning({ yt, closed }: { readonly yt: MobileYoutube; readonly closed: boolean }) {
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
        // 댓글 붙여넣기 단추는 없앴다 (D-UX4-78) — 채팅을 못 받는 동안은 음성으로
        <Hint>{MOBILE_FALLBACK_HINT}</Hint>
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
  else if (closed) body = <Body>연결한 유튜브 라이브가 없어요.</Body>
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

/** 같이 보는 라이브에 들어감 (D-SHARE-LIVE-01): 다른 계정이 이미 이어 둔 라이브라 새로 잇지 않고 그 방송에 들어갔다 */
export interface JoinedLiveView {
  readonly broadcastId: string
  readonly shopName: string
}

/** 잇기 대신 같이 보는 라이브에 들어갔다 — 화면 옮기기는 앱 뿌리가 했다. 잇는 화면은 오류 없이 멈춘다 */
export class JoinedLive extends Error {
  readonly joined: JoinedLiveView
  constructor(joined: JoinedLiveView) {
    super('같이 보는 라이브에 들어갔어요')
    this.name = 'JoinedLive'
    this.joined = joined
  }
}

let joinedHandler: ((joined: JoinedLiveView) => Promise<void>) | null = null
/** 앱 뿌리가 한 번 정한다: 내 정보를 다시 읽고 그 방송 화면으로 옮긴다 */
export function setJoinedLiveHandler(handler: ((joined: JoinedLiveView) => Promise<void>) | null): void {
  joinedHandler = handler
}

function joinedOf(body: unknown): JoinedLiveView | null {
  if (typeof body !== 'object' || body === null) return null
  const joined = (body as { joined?: unknown }).joined
  if (typeof joined !== 'object' || joined === null) return null
  const { broadcastId, shopName } = joined as { broadcastId?: unknown; shopName?: unknown }
  return typeof broadcastId === 'string' && broadcastId !== '' ? { broadcastId, shopName: typeof shopName === 'string' ? shopName : '' } : null
}

async function tookJoin(body: unknown): Promise<void> {
  const joined = joinedOf(body)
  if (joined === null) return
  await joinedHandler?.(joined)
  throw new JoinedLive(joined)
}

/** 잇기 요청 보내기 — 유튜브면 받은 연결 보기, 틱톡·밴드는 null. 다른 계정이 이어 둔 라이브면 그 방송에 들어가고 JoinedLive를 던진다 (D-SHARE-LIVE-01) */
export async function sendLiveLink(broadcastId: string, request: LiveLinkRequest): Promise<LinkView | null> {
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}`
  if (request.platform === 'youtube') {
    const view = await withRetry(() => post<LinkView>(`${base}/youtube`, request.body))
    await tookJoin(view)
    return view
  }
  await tookJoin(await withRetry(() => post<unknown>(request.platform === 'tiktok' ? `${base}/tiktok/link-url` : `${base}/band/link`, request.body)))
  // 틱톡·밴드로 이었으면 이 방송 화면이 연결 화면을 다시 저절로 열지 않는다 (D-LINK-TT-01 — 방송 목록이 아직 옛 값이어도)
  markLinkAsked(broadcastId)
  return null
}

export interface AddressLinkerOptions {
  readonly webChat: YoutubeWebChat | null
  /** 아직 만들기 전이면 null — 다른 방송에 이어진 것만 막는다 */
  readonly broadcastId: string | null
  /** 잇기 요청 (유튜브·틱톡·밴드, D-UX3-14). 거절은 그대로 던지면 여기서 문장·확인 줄로 보인다 */
  readonly submit: (request: LiveLinkRequest) => Promise<void>
  readonly label?: string
  readonly disabled?: boolean
  /** false면 클립보드·내 채널 목록을 보지 않는다(화면이 닫혀 있을 때) */
  readonly enabled?: boolean
  /** 링크 칸을 고치기 시작했을 때 (화면의 다른 오류 문장도 지우게) */
  readonly onEdit?: () => void
  /** [링크를 모르겠어요] — 칸 아래 [붙여넣기]와 한 줄 (D-UX4-117). 누르면 플랫폼 고르기 → 앱 안 브라우저 (D-UX4-160). 없으면 칩이 없다 */
  readonly onUnknown?: () => void
  /** 연결 확인 화면 [연결하기] 위에 보일 화면의 알림 (새 라이브를 못 만들었을 때 등) */
  readonly confirmNotice?: ReactNode
}

/** 라이브 링크 화면 제목 (D-UX4-112 → D-UX4-113 → D-UX4-117: 설명은 없앴다 — 사용자 지시 2026-11-10 "설명 그냥 지우고 제목 아래에 인풋") */
export const LINK_ASK_TITLE = '라이브 링크를 넣어 주세요'
export const LINK_UNKNOWN = '링크를 모르겠어요'
/** 링크 화면 맨 아래 단추 — 누르면 연결 확인 화면으로 (D-UX4-117, 옛 [확인]) */
export const LINK_NEXT = '다음'
/** 연결 확인 화면 (D-UX4-117, 사용자 지시 2026-11-10 "라이브 확인 팝업 띄우지 말고 별도의 화면으로") */
export const LINK_CONFIRM_TITLE = '이 라이브에 연결할까요?'
export const LINK_CONFIRM_ACTION = '연결하기'
const CHECK_ICON = 24

/**
 * 연결할 라이브 정보 (D-UX4-116 → D-UX4-117): 옅은 회색 둥근 카드에 세 줄 — 플랫폼 아이콘·이름 / 굵은 제목 / 채널 사진·이름.
 * 확인 화면에서는 제목을 자르지 않고 다 보인다(사용자 지시 "끊지말고 그냥 다 보여줘"). 바깥 글이라 글자로만
 */
export function LiveCheck({ title, channel, channelId }: { readonly title: string; readonly channel: string; readonly channelId: string | null }) {
  const { p } = useKit()
  return (
    <View testID="live-check" style={{ gap: SPACE.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.lg, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
      <View testID="live-check-platform" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <PlatformIcon platform="youtube" size={CHECK_ICON} />
        <Txt step="body" weight="medium" color="textSub">
          유튜브
        </Txt>
      </View>
      <Txt step="bodyLarge" weight="bold" testID="live-check-title">
        {title}
      </Txt>
      <View testID="live-check-channel" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <ChannelPhoto channelId={channelId} size={CHECK_ICON} testID="live-check-avatar" />
        <View style={{ flexShrink: 1 }}>
          <Txt step="body" color="textSub">
            {channel}
          </Txt>
        </View>
      </View>
    </View>
  )
}

type Ask =
  | { readonly kind: 'live'; readonly video: string; readonly loading: boolean; readonly title: string; readonly name: string; readonly channelId: string | null }
  | { readonly kind: 'firstChannel'; readonly video: string; readonly name: string }

/** 라이브 정보를 받는 동안의 카드 (D-UX4-121): 같은 자리·크기에 회색 막대 — 받으면 그 자리에 정보가 들어온다 */
export function LiveCheckLoading() {
  const { p } = useKit()
  const bar = (width: `${number}%`, height: number) => <View style={{ width, height, borderRadius: 6, borderCurve: 'continuous', backgroundColor: p.soft }} />
  return (
    <View testID="live-check-loading" role="progressbar" aria-label="라이브 정보를 불러오고 있어요" style={{ gap: SPACE.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.lg, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <PlatformIcon platform="youtube" size={CHECK_ICON} />
        <Txt step="body" weight="medium" color="textSub">
          유튜브
        </Txt>
      </View>
      {bar('90%', 18)}
      {bar('55%', 18)}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <View style={{ width: CHECK_ICON, height: CHECK_ICON, borderRadius: CHECK_ICON / 2, borderCurve: 'continuous', backgroundColor: p.soft }} />
        {bar('35%', 14)}
      </View>
    </View>
  )
}

/** 미리 보기가 없는 서버: 넣은 링크만 보인다 (D-UX4-121) */
function LiveCheckLink({ video }: { readonly video: string }) {
  const { p } = useKit()
  return (
    <View testID="live-check" style={{ gap: SPACE.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.lg, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
      <View testID="live-check-platform" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <PlatformIcon platform="youtube" size={CHECK_ICON} />
        <Txt step="body" weight="medium" color="textSub">
          유튜브
        </Txt>
      </View>
      <Txt step="body" testID="live-check-link">
        {video}
      </Txt>
    </View>
  )
}

export function LinkUnknownChip({ onPress }: { readonly onPress: () => void }) {
  return <SoftChip label={LINK_UNKNOWN} onPress={onPress} testID="link-unknown" />
}

/** 링크 화면 "최근 연결한 채널의 라이브" 제목 (D-UX4-112 — 옛 "최근 이은 채널의 라이브") */
export const RECENT_LIVE_TITLE = '최근 연결한 채널의 라이브가 있어요'
/** 최근 연결한 채널 5곳 묶음 이름 (D-UX4-187 — 라이브가 없는 채널도 보인다) */
export const RECENT_CHANNELS_TITLE = '최근 연결한 채널'
/** 지금 라이브·예정이 없는 채널 줄의 회색 글 (D-UX4-187) */
export const NO_LIVE_NOW = '지금 라이브가 없어요'
/** 최근 라이브 줄의 플랫폼 그림 크기 (토스 계좌 줄의 은행 그림처럼 두 줄 높이) */
const RECENT_ICON = 40
/** 최근 연결한 채널 줄 수 — 유튜브 채널과 틱톡 계정을 합쳐서 (D-UX4-187 5곳, D-RECENT-TT-01) */
export const RECENT_ROWS_MAX = 5
/** 최근 연결한 틱톡 계정 줄의 회색 글 (D-RECENT-TT-01 — 라이브인지는 모른다, [연결]하면 서버가 확인한다) */
export const RECENT_TIKTOK_SUB = '틱톡'
/** 틱톡 아이디 (서버 해석과 같은 글자 — 이것만 주소로 만든다) */
const TIKTOK_ID_RE = /^[a-z0-9._]{2,24}$/

/** 틱톡 계정의 라이브 주소 (D-RECENT-TT-01 — 붙여 넣은 틱톡 링크와 같은 길로 잇는다) */
export function tiktokLiveUrl(tiktokId: string): string {
  return `https://www.tiktok.com/@${tiktokId}/live`
}

/**
 * 최근 연결한 유튜브 채널·틱톡 계정을 이은 때 차례로 섞는다 (D-RECENT-TT-01): 둘 다 서버가 최근 것부터 준 차례를 지키고,
 * 틱톡이 더 나중에 이은 것일 때만 앞에 둔다(유튜브 이은 때를 모르는 옛 모양이면 유튜브가 먼저). 합쳐 5줄까지
 */
export function mergeRecent<C extends { readonly linkedAt?: string }, T extends { readonly linkedAt: string }>(channels: readonly C[], tiktok: readonly T[], max = RECENT_ROWS_MAX): ({ readonly kind: 'channel'; readonly value: C } | { readonly kind: 'tiktok'; readonly value: T })[] {
  const out: ({ readonly kind: 'channel'; readonly value: C } | { readonly kind: 'tiktok'; readonly value: T })[] = []
  let i = 0
  let j = 0
  while (out.length < max && (i < channels.length || j < tiktok.length)) {
    const channel = channels[i]
    const account = tiktok[j]
    const channelAt = channel?.linkedAt === undefined ? Number.NaN : Date.parse(channel.linkedAt)
    const tiktokFirst = account !== undefined && (channel === undefined || (!Number.isNaN(channelAt) && Date.parse(account.linkedAt) > channelAt))
    if (tiktokFirst) {
      out.push({ kind: 'tiktok', value: account })
      j += 1
    } else if (channel !== undefined) {
      out.push({ kind: 'channel', value: channel })
      i += 1
    }
  }
  return out
}

/** 틱톡 계정 사진 (D-RECENT-TT-01): 서버가 받아 둔 프로필 사진(D-TT-PHOTO-01 같은 경로), 모르면 틱톡 앱 그림 */
function TiktokPhoto({ broadcastId, size }: { readonly broadcastId: string | null; readonly size: number }) {
  const avatar = useChannelAvatar(null, broadcastId)
  return (
    <View testID="recent-live-avatar" aria-hidden>
      {avatar !== null ? (
        <Image testID="recent-tiktok-photo" source={{ uri: avatar }} style={{ width: size, height: size, borderRadius: size / 2, borderCurve: 'continuous' }} />
      ) : (
        <PlatformIcon platform="tiktok" size={size} />
      )}
    </View>
  )
}
/** 한 줄 글 끝이 흐려지는 폭 */
const FADE_WIDTH = 36

/** 한 줄 글: 넘치면 말줄임표 대신 끝이 점점 흐려져 사라진다 (D-UX4-112, 사용자 지시 "한 줄 넘어가면 그냥 점점 흐려지게 해서 뒤에 안 보이게") */
function FadeLine({ text, testID, step = 'body' }: { readonly text: string; readonly testID?: string; readonly step?: 'body' | 'bodyLarge' }) {
  const { p } = useKit()
  const [box, setBox] = useState(0)
  const [natural, setNatural] = useState(0)
  const over = natural > box + 0.5 && box > 0
  return (
    <View style={{ flex: 1, overflow: 'hidden' }} onLayout={(event) => setBox(event.nativeEvent.layout.width)}>
      <Txt step={step} weight="bold" numberOfLines={1} ellipsizeMode="clip" testID={testID}>
        {text}
      </Txt>
      {/* 글 본래 폭을 재는 보이지 않는 글 */}
      <View aria-hidden pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 4000, opacity: 0, flexDirection: 'row' }}>
        <Txt step={step} weight="bold" onLayout={(event) => setNatural(event.nativeEvent.layout.width)}>
          {text}
        </Txt>
      </View>
      {over ? (
        <View aria-hidden pointerEvents="none" testID="fade-line-end" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: FADE_WIDTH }}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={p.surface} stopOpacity={0} />
                <Stop offset="1" stopColor={p.surface} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
          </Svg>
        </View>
      ) : null}
    </View>
  )
}

/** 최근 라이브 줄 오른쪽 [연결] — 토스 계좌 줄 [송금]: 옅은 회색 둥근 네모, 회색 중간 굵기 글, 꾸욱 눌림 (D-UX4-113) */
function ConnectButton({ label, disabled, onPress }: { readonly label: string; readonly disabled: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: SPACE.lg - 2, justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : p.surfaceAlt, opacity: disabled ? 0.45 : 1 })}
    >
      <Txt step="body" weight="medium" ink={p.tabInk}>
        연결
      </Txt>
    </Tap>
  )
}

/** 다른 방송에 틱톡이 이어져 있을 때 (D-UX3-17) — 서버 TIKTOK_ELSEWHERE 문장과 같은 뜻, 팝업이라 줄을 나눈다 (D-UX4-02) */
export const TIKTOK_MOVE_QUESTION = '다른 라이브에 틱톡이 연결돼 있어요.\n이 라이브로 옮길까요?'

/** 잇기 거절을 짧게 (D-UX3-11, 사용자 지시 2026-11-03 "구체적으로 말고 추상적으로 짧게"). 모르는 거절은 서버 문장 그대로 */
const SHORT_LINK_ERRORS: Readonly<Record<string, string>> = {
  INVALID_VIDEO_URL: UNKNOWN_LINK,
  NO_LIVE_CHAT: '라이브 채팅을 받을 수 없는 라이브예요.',
  YOUTUBE_NOT_PUBLIC: '공개 라이브만 연결할 수 있어요.',
  YOUTUBE_UNAVAILABLE: '지금은 연결할 수 없어요. 잠시 뒤 다시 눌러 주세요.',
  INVALID_TIKTOK_LINK: UNKNOWN_LINK,
}
export function shortLinkError(error: ApiError): string {
  return SHORT_LINK_ERRORS[error.code] ?? error.message
}

/**
 * "방송 주소" 칸 + 내 채널 방송 목록 + 처음 잇는 채널 확인 (fields) 과 [확인] (action — D-UX3-13, 전 [이 방송에 잇기] — 주소를 넣기 전엔 null, D-UX3-07).
 * 방송 화면 연결과 새 방송 화면이 함께 쓴다 (D-UX3-06). 단추는 화면 맨 아래(키보드 위)에 두라고 따로 준다.
 */
export interface AddressLinker {
  readonly fields: ReactNode
  readonly action: ReactNode | null
  readonly popup: ReactNode
  readonly busy: boolean
  readonly recheck: () => Promise<void>
  /** 연결 확인 화면이 떠 있나 (D-UX4-117 — 미리 본 라이브가 있을 때) */
  readonly confirming: boolean
  /** 연결 확인 화면 내용(라이브 정보 카드)과 [연결하기] */
  readonly confirmBody: ReactNode
  readonly confirmAction: ReactNode
  /** 연결 확인 화면에서 링크 화면으로 */
  readonly back: () => void
  /**
   * 앱 안 브라우저의 [이 라이브예요] (D-UX4-162): 그 링크를 칸에 넣고 맨 아래 [다음]을 누른 것과 똑같이 진행한다
   * (유튜브는 연결 확인 화면, 틱톡은 바로 잇기, 밴드는 글 고르기 — 못 이으면 칸 아래 오류 안내 그대로)
   */
  readonly submitFound: (url: string) => void
  /** 브라우저 시작 주소에 쓸 유튜브 채널 (최근 연결한 채널의 라이브 목록 첫 채널) — 모르면 null */
  readonly knownChannel: string | null
}

export function useAddressLinker({ webChat, broadcastId, submit, label = LINK_NEXT, disabled, enabled = true, onEdit, onUnknown, confirmNotice }: AddressLinkerOptions): AddressLinker {
  const [recent, setRecent] = useState<readonly LiveBroadcastItem[] | null>(null)
  /** 최근 연결한 채널 (최근 것이 먼저, D-UX4-187) — 옛 서버면 null(라이브 줄만) */
  const [channels, setChannels] = useState<readonly RecentChannel[] | null>(null)
  /** 최근 연결한 틱톡 계정 (최근 것이 먼저, D-RECENT-TT-01) — 옛 서버면 빈 목록 */
  const [tiktok, setTiktok] = useState<readonly RecentTiktok[]>([])
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * 잇기 전 확인 (D-UX4-08): live = 연결 확인 화면(D-UX4-117 — loading이면 라이브 정보를 받는 중, D-UX4-121), firstChannel = 서버가 처음 잇는 채널이라고 알린 것(팝업)
   */
  const [ask, setAsk] = useState<Ask | null>(null)
  /** 미리 보기 요청 번호 — 뒤로 갔다 다시 오면 옛 답은 버린다 */
  const looking = useRef(0)
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
    setChannels(null)
    setTiktok([])
    try {
      const { broadcasts, channels: found, tiktok: accounts } = await get<{ broadcasts: LiveBroadcastItem[]; channels?: RecentChannel[]; tiktok?: RecentTiktok[] }>('/api/youtube/live-broadcasts')
      setRecent(broadcasts)
      setChannels(Array.isArray(found) ? found : null)
      // 옛 서버(칸 없음)는 틱톡 줄 없이. 주소로 만들 수 있는 아이디만 (D-RECENT-TT-01)
      setTiktok(Array.isArray(accounts) ? accounts.filter((row) => typeof row?.tiktokId === 'string' && TIKTOK_ID_RE.test(row.tiktokId) && typeof row.linkedAt === 'string') : [])
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
    // 못 읽었으면(아이폰 "붙여넣기 허용 안 함"·빈 클립보드) 아무것도 하지 않는다 — 오류를 띄우지 않는다 (D-UX4-115)
    if (text.trim() === '') return
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
      // 같이 보는 라이브에 들어갔다 — 앱 뿌리가 그 방송 화면으로 옮겼다 (D-SHARE-LIVE-01)
      if (caught instanceof JoinedLive) { other.current = null; setStep('none'); return }
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

  /**
   * 서버 읽기면 잇기 전에 늘 연결 확인 화면 (D-UX4-08 → D-UX4-117). [다음]·[연결]을 누르면 기다리지 않고 바로 넘어간다 (D-UX4-121, 사용자 지시
   * "라이브 링크 넣고 다음이나 연결 누르면 로딩이 긴데 … 연결하기 버튼 눌러야 실제로 연결해야지"): 아무것도 잇지 않고, 라이브 정보는 확인 화면에서 받는다.
   * 최근 라이브 줄은 이미 아는 제목·채널을 바로 쓴다(known). 미리 보기가 링크를 거절하면 링크 화면으로 돌아가 칸 아래에 까닭.
   * 미리 보기가 없는 서버(PREVIEW_UNAVAILABLE)면 정보 없이 확인 화면에 남고 [연결하기]로 잇는다. 구글 연결로 읽는 서버(webChat 없음)는 옛 흐름.
   */
  const check = async (video: string, known?: { readonly title: string; readonly name: string; readonly channelId: string | null }) => {
    if (busy || disabled === true || video.trim() === '') return
    if (webChat === null) {
      void link(video)
      return
    }
    setError(null)
    looking.current += 1
    const ticket = looking.current
    if (known !== undefined) {
      setAsk({ kind: 'live', video, loading: false, ...known })
      return
    }
    setAsk({ kind: 'live', video, loading: true, name: '', title: '', channelId: null })
    try {
      const seen = await withRetry(() => post<{ title?: unknown; channelTitle?: unknown; channelId?: unknown }>('/api/youtube/preview', { video }))
      if (looking.current !== ticket) return
      setAsk((now) => (now?.kind === 'live' && now.video === video ? { kind: 'live', video, loading: false, name: channelName(seen.channelTitle), title: broadcastTitleText(seen.title), channelId: typeof seen.channelId === 'string' && seen.channelId !== '' ? seen.channelId : null } : now))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (looking.current !== ticket) return
      if (caught.code === 'PREVIEW_UNAVAILABLE') {
        setAsk((now) => (now?.kind === 'live' && now.video === video ? { ...now, loading: false } : now))
      } else {
        setAsk(null)
        setError(shortLinkError(caught))
      }
    }
  }

  const link = async (video: string, confirmed = false) => {
    if (busy || disabled === true || video.trim() === '') return
    if (pending.current?.video !== video || pending.current.confirmed !== confirmed) pending.current = { video, confirmed, requestId: newRequestId() }
    const { requestId } = pending.current
    setBusy(true)
    setError(null)
    // 확인 화면에서 [연결하기]면 보내는 동안 그 화면 그대로 (D-UX4-117) — 처음 잇는 채널 팝업은 닫는다
    setAsk((now) => (confirmed && now?.kind === 'live' ? now : null))
    try {
      const body: LinkBody = confirmed ? { requestId, video, confirmInvited: true } : { requestId, video }
      await submit({ platform: 'youtube', body })
      pending.current = null
    } catch (caught) {
      // 같이 보는 라이브에 들어갔다 — 앱 뿌리가 그 방송 화면으로 옮겼다 (D-SHARE-LIVE-01)
      if (caught instanceof JoinedLive) { pending.current = null; setAsk(null); return }
      if (!isApiError(caught)) throw caught
      if (!caught.retryable) pending.current = null
      if (!confirmed && caught.code === INVITED_CONFIRM_CODE) {
        const channel = caught.details.channel
        const title = typeof channel === 'object' && channel !== null ? (channel as { title?: unknown }).title : undefined
        setAsk({ kind: 'firstChannel', video, name: channelName(title) })
      } else {
        // 못 이으면 링크 화면으로 돌아가 칸 아래에 까닭을 보인다
        setAsk(null)
        setError(shortLinkError(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  const recentTitle = webChat === null ? MY_CHANNEL_TITLE : channels !== null ? RECENT_CHANNELS_TITLE : RECENT_LIVE_TITLE
  // 줄 차례 (D-UX4-187, 사용자 "최근 5군데 채널 다 보여주도록 해. 맨위가 젤 최근으로"): 서버가 준 최근 채널 차례대로 — 라이브·예정이 있으면 그 라이브 줄,
  // 없으면 [연결] 없이 "지금 라이브가 없어요". 옛 서버(채널 목록 없음)면 라이브 줄만
  // 최근 연결한 틱톡 계정도 이은 때 차례로 섞는다 (D-RECENT-TT-01, 판매자 "최근 연결한 채널에 틱톡은 없음") — 합쳐 5줄
  const recentRows: readonly ({ readonly kind: 'live'; readonly item: LiveBroadcastItem } | { readonly kind: 'quiet'; readonly channel: RecentChannel } | { readonly kind: 'tiktok'; readonly account: RecentTiktok })[] =
    channels === null
      ? (recent ?? []).map((item) => ({ kind: 'live' as const, item }))
      : mergeRecent(channels, tiktok).map((row) => {
          if (row.kind === 'tiktok') return { kind: 'tiktok' as const, account: row.value }
          const channel = row.value
          const item = channel.videoId === null ? undefined : (recent ?? []).find((found) => found.videoId === channel.videoId)
          return item === undefined ? { kind: 'quiet' as const, channel } : { kind: 'live' as const, item }
        })
  /** 틱톡 줄 [연결]: 그 계정의 라이브 주소를 칸에 넣고 [다음]을 누른 것과 같다 — 동의 안내·옮기기 묻기·못 이은 까닭도 붙여 넣은 링크 그대로 (D-RECENT-TT-01) */
  const linkTiktok = (tiktokId: string) => {
    const url = tiktokLiveUrl(tiktokId)
    edit(url)
    confirm(url)
  }
  // [붙여넣기]: 클립보드에 글이 있고 칸이 비었을 때만 (D-UX4-113 — 칸 바로 아래 왼쪽)
  const pasteButton = canPaste && address === '' ? <PasteButton onPaste={paste} /> : null
  const off = busy || disabled === true
  const fields = (
    <Stack tight>
      {/* 키보드를 띄우지 않는다 (D-UX4-112, 사용자 지시 "링크를 키보드로 직접 치는 사람이 어딨어 … 방송 링크 넣는 화면에서는 키보드를 띄우지 마"):
          스스로 초점을 받지 않고, 눌러도 휴대폰 키보드 없이 길게 눌러 붙여넣기만 된다 */}
      <Field
        label="라이브 링크"
        value={address}
        onChangeText={edit}
        problem={error}
        inputMode="url"
        autoCapitalize="none"
        autoCorrect={false}
        showSoftInputOnFocus={false}
      />
      {/* 칸 아래 한 줄: [링크를 모르겠어요] · [붙여넣기] (D-UX4-117, 사용자 지시 "제목 아래에 인풋 배치하고 그 아래에 링크를 모르겠어요, 붙여넣기 버튼을 순서대로 한줄에").
          [붙여넣기]는 클립보드에 글이 있고 칸이 비었을 때만 */}
      {onUnknown === undefined && pasteButton === null ? null : (
        <View testID="link-chips" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACE.sm, paddingTop: SPACE.sm }}>
          {onUnknown === undefined ? null : <LinkUnknownChip onPress={onUnknown} />}
          {pasteButton === null ? null : <View testID="link-paste">{pasteButton}</View>}
        </View>
      )}
      {/* 최근 연결한 채널에서 지금 하는 라이브 (D-UX4-112 → D-UX4-113 → D-UX4-117): 서버에서 받아 한발 늦게 오므로 옅게 나타나며 올라온다(Appear).
          줄마다 왼쪽 채널 사진(라이브 중이면 홈처럼 빨간 테두리 + "라이브") · 굵은 채널 이름 한 줄(넘치면 끝이 흐려짐) · 오른쪽 회색 [연결] — 누르면 연결 확인 화면.
          (사용자 지시 "채널 아이콘(홈화면에 라이브 빨간표시 그거도 넣고) + 채널명만") 다른 라이브에 연결돼 있거나 예정이면 그 말만 회색으로 한 줄 더 */}
      {recentRows.length > 0 ? (
        <Appear testID="recent-lives">
          <View role="group" aria-label={recentTitle} style={{ gap: SPACE.lg, paddingTop: SPACE.xxxl }}>
            <Txt step="body" weight="bold" color="textSub">
              {recentTitle}
            </Txt>
            {recentRows.map((row) => {
              if (row.kind === 'tiktok') {
                const account = row.account
                const tiktokName = `@${account.tiktokId}`
                const here = account.linkedBroadcast !== null && account.linkedBroadcast === broadcastId
                const elsewhere = account.linkedBroadcast !== null && !here
                const tiktokSub = here ? `${RECENT_TIKTOK_SUB} · 이 라이브에 연결돼 있어요` : elsewhere ? `${RECENT_TIKTOK_SUB} · 다른 라이브에 연결돼 있어요` : RECENT_TIKTOK_SUB
                return (
                  <View key={`tiktok-${account.tiktokId}`} testID="recent-live" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
                    <TiktokPhoto broadcastId={account.photoBroadcast} size={RECENT_ICON} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <FadeLine text={tiktokName} testID="recent-live-channel" step="bodyLarge" />
                      <Txt step="body" color="textSub" numberOfLines={1} testID="recent-live-sub">
                        {tiktokSub}
                      </Txt>
                    </View>
                    {/* 다른 라이브에 이어져 있으면 눌러서 옮길지 묻는다(TIKTOK_ELSEWHERE) — 이 라이브에 이미 이어져 있으면 누를 수 없다 */}
                    <ConnectButton label={`${tiktokName} 연결`} disabled={off || here} onPress={() => linkTiktok(account.tiktokId)} />
                  </View>
                )
              }
              if (row.kind === 'quiet') {
                const quietName = channelName(row.channel.channelTitle)
                return (
                  <View key={`channel-${row.channel.channelId}`} testID="recent-live" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
                    <ChannelPhoto channelId={row.channel.channelId} size={RECENT_ICON} live={false} testID="recent-live-avatar" />
                    <View style={{ flex: 1, gap: 2 }}>
                      <FadeLine text={quietName} testID="recent-live-channel" step="bodyLarge" />
                      <Txt step="body" color="textSub" numberOfLines={1} testID="recent-live-sub">
                        {NO_LIVE_NOW}
                      </Txt>
                    </View>
                  </View>
                )
              }
              const item = row.item
              const other = item.linkedBroadcast !== null && item.linkedBroadcast !== broadcastId
              const title = item.title.trim() === '' ? NO_BROADCAST_TITLE : item.title
              // 내 채널 목록(구글 연결로 읽는 서버)에는 채널 이름이 없다 — 그때는 라이브 제목 ("(이름 없음)"을 보이지 않게)
              const name = webChat === null ? title : channelName(item.channelTitle)
              const live = item.status === 'LIVE'
              const sub = other ? '다른 라이브에 연결돼 있어요' : live ? null : '예정'
              return (
                <View key={item.videoId} testID="recent-live" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
                  <ChannelPhoto channelId={item.channelId ?? null} size={RECENT_ICON} live={live} testID="recent-live-avatar" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <FadeLine text={name} testID="recent-live-channel" step="bodyLarge" />
                    {sub === null ? null : (
                      <Txt step="body" color="textSub" numberOfLines={1} testID="recent-live-sub">
                        {sub}
                      </Txt>
                    )}
                  </View>
                  <ConnectButton label={`${name} 연결`} disabled={off || other} onPress={() => void check(item.videoId, { title, name: channelName(item.channelTitle), channelId: item.channelId ?? null })} />
                </View>
              )
            })}
          </View>
        </Appear>
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
      {/* 처음 잇는 채널(미리 보기 없는 옛 흐름)만 팝업 — 미리 본 라이브는 연결 확인 화면으로 (D-UX4-117) */}
      <PopupDialog
        visible={ask?.kind === 'firstChannel'}
        name={FIRST_CHANNEL_GROUP}
        message={firstChannelPopup(shownAsk.current?.name ?? '')}
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
  // 연결 확인 화면 (D-UX4-117): 미리 본 라이브 정보 카드(제목은 자르지 않음) + [연결하기]
  const confirming = ask?.kind === 'live'
  const seen = shownAsk.current
  const confirmBody =
    seen === null || seen.kind !== 'live' ? null : (
      <View style={{ gap: SPACE.lg }}>
        {seen.loading ? <LiveCheckLoading /> : seen.title === '' ? <LiveCheckLink video={seen.video} /> : <LiveCheck title={seen.title} channel={seen.name} channelId={seen.channelId} />}
        {confirmNotice}
      </View>
    )
  const confirmAction = (
    <BigButton
      label={LINK_CONFIRM_ACTION}
      primary
      disabled={off || (ask?.kind === 'live' && ask.loading)}
      onPress={() => {
        if (ask !== null) void link(ask.video, true)
      }}
    />
  )
  const back = () => {
    looking.current += 1
    setAsk(null)
  }
  const submitFound = (url: string) => {
    const text = url.trim()
    if (text === '') return
    edit(text)
    confirm(text)
  }
  // 가장 최근 채널 (D-UX4-187: 라이브가 없어도 최근 채널 차례의 첫 곳)
  const knownChannel = channels?.[0]?.channelId ?? (recent ?? []).find((item) => typeof item.channelId === 'string' && item.channelId !== '')?.channelId ?? null
  // recheck: 클립보드에 글이 있는지 다시 본다 ([붙여넣기] 칩)
  return { fields, action, popup: <PopNote note={note} />, busy, recheck: peek, confirming, confirmBody, confirmAction, back, submitFound, knownChannel }
}

/**
 * 링크 화면 ↔ 연결 확인 화면 (D-UX4-117, 사용자 지시 2026-11-10 "라이브 확인 팝업 띄우지 말고 별도의 화면으로 … [다음] 누르면 다음 페이지에서
 * 이 라이브에 연결할까요?"): 한 경로 안에서 밀어 넘긴다(SlideSwitch). 확인 화면에서 뒤로(머리 ‹ · 왼쪽 끝 밀기 · 안드로이드 뒤로)는 링크 화면으로 —
 * 그동안은 경로를 닫는 휴대폰 밀기를 끈다(useHoldRouteSwipe)
 */
export function LinkPages({ linker, name, children }: { readonly linker: AddressLinker; readonly name: string; readonly children: ReactNode }) {
  const backNow = useRef(linker.back)
  backNow.current = linker.back
  useHoldRouteSwipe(linker.confirming)
  useEffect(() => {
    if (!linker.confirming || Platform.OS === 'web') return
    const handle = BackHandler.addEventListener('hardwareBackPress', () => {
      backNow.current()
      return true
    })
    return () => handle.remove()
  }, [linker.confirming])
  return (
    <SlideSwitch id={linker.confirming ? 'confirm' : 'link'} back={!linker.confirming}>
      {linker.confirming ? (
        <EdgeSwipeBack onBack={() => backNow.current()}>
          <FormPage title={LINK_CONFIRM_TITLE} name={name} onBack={() => backNow.current()} actions={linker.confirmAction} testID="link-confirm">
            {linker.confirmBody}
          </FormPage>
        </EdgeSwipeBack>
      ) : (
        children
      )}
    </SlideSwitch>
  )
}
