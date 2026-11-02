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
import { clipboardYoutubeAddress } from '../../lib/clipboard.ts'
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
  RECONNECT_FIRST,
  MY_CHANNEL_TITLE,
  RECENT_TITLE,
  RETRYING_WARN_MS,
  SERVER_ROUTE_SERVER,
  WEB_CHAT_OFF_MESSAGE,
  WEB_CHAT_RESUMED,
  broadcastChannelLine,
  channelName,
  firstChannelQuestion,
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

function LinkPicker({ yt }: { readonly yt: MobileYoutube }) {
  const [recent, setRecent] = useState<readonly LiveBroadcastItem[] | null>(null)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [ask, setAsk] = useState<{ video: string; name: string } | null>(null)
  const pending = useRef<{ video: string; confirmed: boolean; requestId: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // 클립보드의 유튜브 주소 — 칸을 열 때, 그리고 유튜브 앱에서 주소를 복사하고 돌아올 때
  // 복사한 주소가 있으면 칸을 미리 채운다 — 따로 묻는 카드 없이 [이 방송에 잇기] 하나로 (D-LIVETEST-09)
  const peek = useCallback(async () => {
    const found = await clipboardYoutubeAddress()
    setCopied(found)
    if (found !== null) setAddress((now) => (now.trim() === '' ? found : now))
  }, [])
  useEffect(() => {
    void peek()
  }, [peek])
  useAppForeground({ onForeground: () => void peek() })

  // 못 찾으면 목록만 감춘다 — 주소를 붙여 넣으면 된다 (D-LIVETEST-09)
  const search = useCallback(async () => {
    setRecent(null)
    try {
      const { broadcasts } = await get<{ broadcasts: LiveBroadcastItem[] }>('/api/youtube/live-broadcasts')
      setRecent(broadcasts)
    } catch {
      setRecent([])
    }
  }, [])
  // 잇기 칸을 열 때 한 번 (되풀이해 찾지 않는다, D-YT-SRV-03)
  useEffect(() => {
    void search()
  }, [search])

  const link = async (video: string, confirmed = false) => {
    if (busy || video.trim() === '') return
    if (pending.current?.video !== video || pending.current.confirmed !== confirmed) pending.current = { video, confirmed, requestId: newRequestId() }
    const { requestId } = pending.current
    setBusy(true)
    setError(null)
    setAsk(null)
    try {
      const body = confirmed ? { requestId, video, confirmInvited: true } : { requestId, video }
      const view = await withRetry(() => post<LinkView>(`/api/broadcasts/${encodeURIComponent(yt.broadcastId)}/youtube`, body))
      pending.current = null
      yt.setLink(view)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.retryable) pending.current = null
      if (!confirmed && caught.code === INVITED_CONFIRM_CODE) {
        const channel = caught.details.channel
        const title = typeof channel === 'object' && channel !== null ? (channel as { title?: unknown }).title : undefined
        setAsk({ video, name: channelName(title) })
      } else setError(caught)
    } finally {
      setBusy(false)
    }
  }

  const recentTitle = yt.webChat === null ? MY_CHANNEL_TITLE : RECENT_TITLE
  return (
    <Stack tight>
      <Field label="방송 주소 붙여넣기" value={address} onChangeText={(text) => {
        setAddress(text)
        setAsk(null)
      }} inputMode="url" autoCapitalize="none" autoCorrect={false} />
      {copied !== null && address === copied ? <Hint>{PASTE_COPIED}</Hint> : null}
      {/* 내 채널(최근 이은 채널)에서 지금 하는 방송 — 있을 때만, 주소를 붙이지 않고 바로 잇기 */}
      {(recent ?? []).length > 0 ? (
      <Card label={recentTitle}>
        <Body bold>{recentTitle}</Body>
        {(recent ?? []).map((item) => {
          const other = item.linkedBroadcast !== null && item.linkedBroadcast !== yt.broadcastId
          // 내 채널 목록(구글 연결로 읽는 서버)에는 채널 이름이 없다 — 제목만 ("(이름 없음)"을 보이지 않게)
          const line = yt.webChat === null ? (item.title.trim() === '' ? NO_BROADCAST_TITLE : item.title) : recentLine(item)
          return (
            <Stack tight key={item.videoId}>
              <Body>
                {line} · {item.status === 'LIVE' ? '방송 중' : '예정'}
                {other ? ' · 다른 방송에 이어져 있어요' : ''}
              </Body>
              <Row>
                <BigButton small label="잇기" ariaLabel={`${line} 잇기`} disabled={busy || other} onPress={() => void link(item.videoId)} />
              </Row>
            </Stack>
          )
        })}
      </Card>
      ) : null}
      {ask !== null ? (
        <Card label={FIRST_CHANNEL_GROUP}>
          <Notice tone="warning" alert>
            {firstChannelQuestion(ask.name)}
          </Notice>
          <Row wrap>
            <BigButton small primary label="맞아요, 잇기" disabled={busy} onPress={() => void link(ask.video, true)} />
            <BigButton small label="취소" disabled={busy} onPress={() => setAsk(null)} />
          </Row>
        </Card>
      ) : null}
      {error !== null ? (
        <Notice tone="danger" alert>
          {error.message}
        </Notice>
      ) : null}
      <BigButton label="이 방송에 잇기" primary disabled={busy || address.trim() === ''} onPress={() => void link(address.trim())} />
    </Stack>
  )
}
