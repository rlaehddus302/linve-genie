// 유튜브 연결 칸 (YT-01, YT-08, D-I3-02·06, AC-I3-01~05·37·54). 설정의 "유튜브" 칸과 시작 마법사 3단계가 같이 쓴다.
// - 상태마다: 준비 안 된 서버(안내 한 줄) · 연결 안 됨(권한 안내 + "구글로 유튜브 연결하기") · 연결됨(채널 이름·권한·동의·사용량·"연결 끊기") ·
//   다시 연결 필요("다시 연결하기", 동의가 켜져 있으면 글쓰기 권한 안내).
// - 연결하기는 서버가 준 승인 주소로 같은 탭에서 최상위 이동한다(저장·기록 없음). 돌아온 결과 문장은 화면 낭독기가 읽는 상태 영역에 한 번.
// - 연결 상태는 늘 서버로 다시 읽는다(결과 코드로 짐작하지 않는다). 영문 상태값·권한 주소·인증 정보는 화면에 없다.
// - 서버가 방송 주소만으로 채팅을 읽으면(연결 응답 webChat, YT-11 D-YT-SRV-11): 첫 줄 "방송할 때 방송 주소만 넣으면 채팅을 받아요."와
//   운영자 끔 안내, 그 아래 "감사 채팅을 올리려면 (선택)" 칸에 구글 연결(보조 버튼 — 마법사에서도 건너뛸 수 있다). oauth=false면 버튼 대신 안내.
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, post, type ApiError } from '../api/client.ts'
import type { BroadcastItem, LinkView, QuotaView, YoutubeConnection, YoutubeConnectionResponse, YoutubeWebChat } from '../api/types.ts'
import { goToGoogle, type GoogleReturn } from '../lib/google-return.ts'
import { kstDateTimeWords } from '../lib/kst.ts'
import { groupDigits } from '../lib/money.ts'
import { routePath, type Navigate } from '../lib/router.ts'
import {
  GOOGLE_FOR_THANKS,
  GOOGLE_FOR_THANKS_TITLE,
  GOOGLE_NOT_READY,
  NOT_CONFIGURED_MESSAGE,
  QUOTA_MODE_SENTENCE,
  RECONNECT_FOR_THANKS,
  RECONNECT_NEEDED_MESSAGE,
  WEB_CHAT_INTRO,
  WEB_CHAT_OFF_MESSAGE,
  callbackMessage,
  callbackSucceeded,
  hasChannel,
  readModeOf,
} from '../lib/youtube.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import { SERVICE_NAME } from '../brand.ts'

export type ConnectionState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'notConfigured' }
  | { readonly phase: 'error'; readonly error: ApiError }
  | {
      readonly phase: 'ready'
      readonly connection: YoutubeConnection
      /** 서버가 방송 주소만으로 채팅을 읽는가 (YT-11) — null이면 옛 공식 읽기 */
      readonly webChat?: YoutubeWebChat | null
      /** 구글 연결(감사 채팅용)을 쓸 수 있는 서버인가 — 없으면 쓸 수 있음(옛 서버) */
      readonly oauth?: boolean
    }

export interface ConnectionHandle {
  readonly state: ConnectionState
  readonly connection: YoutubeConnection | null
  readonly reload: () => Promise<void>
  /** 알림·쓰기 응답으로 받은 연결 — 서버 읽기·구글 연결 가능 여부는 앞에 받은 값을 그대로 둔다 */
  readonly set: (connection: YoutubeConnection) => void
}

/** 연결 응답 → 준비된 상태 (서버 읽기·구글 연결 가능 여부를 함께) */
export function readyState(body: YoutubeConnectionResponse): ConnectionState {
  return { phase: 'ready', connection: body.connection, ...readModeOf(body) }
}

/** 알림으로 받은 연결로 바꾼다 — 서버 읽기·구글 연결 가능 여부(연결 응답에만 있다)는 그대로 */
export function withConnection(state: ConnectionState, connection: YoutubeConnection): ConnectionState {
  return state.phase === 'ready' ? { ...state, connection } : { phase: 'ready', connection }
}

/** 서버가 방송 주소만으로 읽는가 (준비된 상태에서만) */
export function webChatOf(state: ConnectionState): YoutubeWebChat | null {
  return state.phase === 'ready' ? (state.webChat ?? null) : null
}

/** 구글 연결(감사 채팅용)을 쓸 수 있는가 */
export function oauthOf(state: ConnectionState): boolean {
  return state.phase !== 'ready' || state.oauth !== false
}

/** 연결 상태 (GET /api/youtube/connection — 503 YOUTUBE_NOT_CONFIGURED면 준비 안 된 서버) */
export function useYoutubeConnection(enabled = true): ConnectionHandle {
  const [state, setState] = useState<ConnectionState>({ phase: 'loading' })
  const version = useRef(0)
  const reload = useCallback(async () => {
    const mine = ++version.current
    try {
      const body = await get<YoutubeConnectionResponse>('/api/youtube/connection')
      if (mine === version.current) setState(readyState(body))
    } catch (error) {
      if (!isApiError(error) || mine !== version.current) return
      setState(error.code === 'YOUTUBE_NOT_CONFIGURED' ? { phase: 'notConfigured' } : { phase: 'error', error })
    }
  }, [])
  const set = useCallback((connection: YoutubeConnection) => {
    version.current++
    setState((current) => withConnection(current, connection))
  }, [])
  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])
  return { state, connection: state.phase === 'ready' ? state.connection : null, reload, set }
}

export interface QuotaHandle {
  readonly quota: QuotaView | null
  readonly reload: () => Promise<void>
  /** 알림으로 받은 모드 (숫자는 다시 받는다) */
  readonly setMode: (mode: QuotaView['mode']) => void
}

/** 사용량 (GET /api/youtube/quota). 연결이 있을 때만 받는다 */
export function useQuota(enabled: boolean): QuotaHandle {
  const [quota, setQuota] = useState<QuotaView | null>(null)
  const reload = useCallback(async () => {
    try {
      const { quota: view } = await get<{ quota: QuotaView }>('/api/youtube/quota')
      setQuota(view)
    } catch {
      // 사용량을 받지 못하면 숨긴다 (다음 알림·다시 붙을 때 다시 받는다)
    }
  }, [])
  const setMode = useCallback((mode: QuotaView['mode']) => setQuota((current) => (current === null ? current : { ...current, mode })), [])
  useEffect(() => {
    if (enabled) void reload()
    else setQuota(null)
  }, [enabled, reload])
  return { quota, reload, setMode }
}

/**
 * 권한 안내 (연결 안 됨·다시 연결 필요일 때 버튼 위, AC-I3-01).
 * 서버가 방송 주소만으로 채팅을 읽으면(web) 구글 연결은 감사 채팅용이라 "채팅 읽기"를 할 수 있는 일에 넣지 않는다 (D-YT-SRV-01·11)
 */
export function PermissionGuide({ navigate, place, web = false }: { readonly navigate: Navigate; readonly place: 'settings' | 'wizard'; readonly web?: boolean }) {
  return (
    <div className="permission-guide stack-tight">
      <p>연결하면 {SERVICE_NAME}가 할 수 있는 일:</p>
      {web ? (
        <ul>
          <li>내 채널 이름 보기</li>
          <li>감사 채팅을 내 채널 이름으로 올리기 (따로 동의할 때만)</li>
        </ul>
      ) : (
        <ul>
          <li>내 채널 이름 보기</li>
          <li>내 라이브 방송 목록 보기</li>
          <li>방송 채팅 읽기(찜 받기)</li>
        </ul>
      )}
      {web ? <p>채팅 받기에는 구글 연결을 쓰지 않아요.</p> : null}
      <p>연결만으로는 내 채널에 글을 쓰지 않아요.</p>
      <p>
        {place === 'settings'
          ? "구매 감사 메시지 자동 게시는 '구매 감사 메시지'에서 따로 동의하고, 그때 구글 화면에서 글쓰기 권한을 한 번 더 허락해요."
          : '구매 감사 메시지 자동 게시는 설정에서 따로 동의하고, 그때 구글 화면에서 글쓰기 권한을 한 번 더 허락해요.'}
      </p>
      <p>구글 인증 정보는 암호로 바꿔 보관하고, 채팅 내용은 방송 날짜부터 30일 뒤에 지워요.</p>
      <p>언제든 연결을 끊거나 구글 계정 설정에서 권한을 거둘 수 있어요.</p>
      <p>
        <a
          className="text-link"
          href={routePath({ name: 'privacy' })}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey) return
            event.preventDefault()
            navigate({ name: 'privacy' })
          }}
        >
          개인정보처리방침
        </a>
      </p>
    </div>
  )
}

/** 구글에서 돌아온 결과 문장 (한 번 — 상태 영역) */
export function CallbackResult({ code }: { readonly code: string | null }) {
  if (code === null) return null
  return (
    <p className={callbackSucceeded(code) ? 'notice' : 'warning'} role="status">
      {callbackMessage(code)}
    </p>
  )
}

/** "구글로 유튜브 연결하기"·"다시 연결하기" — 서버가 준 승인 주소로 최상위 이동 */
// 주 버튼(채운 색)은 화면에 하나까지 (UX-01·D-102): 단계마다 할 일이 하나인 시작 마법사에서만 주 버튼, 칸마다 버튼이 있는 설정에서는 보조 버튼.
export function ConnectButton({ label, from, primary }: { readonly label: string; readonly from: GoogleReturn | null; readonly primary: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const start = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { authorizeUrl } = await post<{ authorizeUrl: string }>('/api/youtube/connection/start', {})
      goToGoogle(authorizeUrl, from)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      setBusy(false)
    }
  }
  return (
    <div className="stack-tight">
      <div className="row">
        <button type="button" className={primary ? 'button button-primary' : 'button'} disabled={busy} onClick={() => void start()}>
          {label}
        </button>
      </div>
      {error !== null ? <ErrorNote error={error} onRetry={() => void start()} retryLabel="다시 시도" /> : null}
    </div>
  )
}

/** 사용량 (AC-I3-37) — 한국 시간, 세 자리 쉼표. 호출 종류별 숫자·태평양 날짜는 보이지 않는다 */
export function QuotaSummary({ quota }: { readonly quota: QuotaView | null }) {
  if (quota === null) return null
  return (
    <div className="quota stack-tight" aria-label="유튜브 사용량" role="group">
      <p>
        오늘 쓴 양 {groupDigits(quota.used)} · 남은 양 {groupDigits(quota.remaining)} (하루 한도 {groupDigits(quota.budget)})
      </p>
      <p>한국 시간 {kstDateTimeWords(quota.resetsAt)}에 다시 채워져요</p>
      <p className={quota.mode === 'NORMAL' ? '' : 'warning'}>{QUOTA_MODE_SENTENCE[quota.mode]}</p>
    </div>
  )
}

/** 동의 상태 한 줄 (켜기·끄기 버튼은 "구매 감사 메시지" 칸에 있다) */
function consentWords(connection: YoutubeConnection): string {
  const word = (state: { enabled: boolean; at: string | null }) => (state.enabled ? `켜짐${state.at === null ? '' : ` (${kstDateTimeWords(state.at)}에 동의함)`}` : '꺼짐')
  return `자동 게시 동의: 실시간 채팅 ${word(connection.consent.liveChat)} · 영상 댓글 ${word(connection.consent.videoComment)}`
}

export interface YoutubeStatusProps {
  readonly handle: ConnectionHandle
  readonly quota: QuotaView | null
  readonly navigate: Navigate
  readonly place: 'settings' | 'wizard'
}

/** 연결 상태 본문 (설정·마법사) */
export function YoutubeStatus({ handle, quota, navigate, place }: YoutubeStatusProps) {
  const { state } = handle
  if (state.phase === 'loading') return <p role="status">불러오는 중…</p>
  if (state.phase === 'notConfigured') return <p className="notice">{NOT_CONFIGURED_MESSAGE}</p>
  if (state.phase === 'error') return <ErrorNote error={state.error} onRetry={() => void handle.reload()} retryLabel="다시 불러오기" />
  const webChat = state.webChat ?? null
  if (webChat === null) return <GoogleStatus handle={handle} connection={state.connection} quota={quota} navigate={navigate} place={place} web={false} />
  // 서버가 방송 주소만으로 읽는다 (YT-11, D-YT-SRV-11): 첫 줄은 "방송 주소만", 구글 연결은 감사 채팅을 올리려는 판매자만의 선택 칸
  return (
    <div className="stack">
      <p className="web-chat-intro">
        <strong>{WEB_CHAT_INTRO}</strong>
      </p>
      {webChat.on ? null : (
        <p className="warning" role="note">
          {WEB_CHAT_OFF_MESSAGE}
        </p>
      )}
      <section className="stack-tight google-optional" aria-label={GOOGLE_FOR_THANKS_TITLE}>
        <h3 className="sub-title">{GOOGLE_FOR_THANKS_TITLE}</h3>
        <p>{GOOGLE_FOR_THANKS}</p>
        {state.oauth === false ? <p className="notice">{GOOGLE_NOT_READY}</p> : <GoogleStatus handle={handle} connection={state.connection} quota={quota} navigate={navigate} place={place} web />}
      </section>
    </div>
  )
}

/** 구글 연결 본문. web = 서버가 읽는다 — 구글 연결은 감사 채팅용 선택이라 주 버튼이 아니고, "다시 연결 필요"여도 채팅은 받는다 */
function GoogleStatus({ handle, connection, quota, navigate, place, web }: YoutubeStatusProps & { readonly connection: YoutubeConnection; readonly web: boolean }) {
  const [disconnecting, setDisconnecting] = useState(false)
  const from: GoogleReturn | null = place === 'wizard' ? 'wizard' : null
  // 주 버튼은 화면에 하나까지 — 선택 칸이 된 구글 연결은 마법사에서도 보조 버튼 (마법사의 주 버튼은 "다음")
  const primary = place === 'wizard' && !web
  if (connection.status === 'NOT_CONNECTED') {
    return (
      <div className="stack">
        <p>유튜브 채널이 아직 연결되지 않았어요.</p>
        <PermissionGuide navigate={navigate} place={place} web={web} />
        <ConnectButton label="구글로 유튜브 연결하기" from={from} primary={primary} />
      </div>
    )
  }
  const consentOn = connection.consent.liveChat.enabled || connection.consent.videoComment.enabled
  return (
    <div className="stack">
      {connection.channel !== null ? (
        <p className="channel-name">
          연결한 채널: <strong>{connection.channel.title}</strong>
        </p>
      ) : null}
      {connection.status === 'RECONNECT_NEEDED' ? (
        <>
          <p className="warning" role="note">
            {web ? RECONNECT_FOR_THANKS : RECONNECT_NEEDED_MESSAGE}
          </p>
          {consentOn ? <p>구글 화면에 글쓰기 권한도 함께 나와요. 빼고 허락하면 자동 게시가 꺼져요.</p> : null}
          <PermissionGuide navigate={navigate} place={place} web={web} />
          <ConnectButton label="다시 연결하기" from={from} primary={primary} />
        </>
      ) : (
        <ul className="plain-list">
          <li>읽기 권한 있음</li>
          <li>글쓰기 권한 {connection.permissions.publish ? '있음' : '없음'}</li>
        </ul>
      )}
      {place === 'settings' ? <p>{consentWords(connection)}</p> : null}
      {place === 'settings' && hasChannel(connection) ? <QuotaSummary quota={quota} /> : null}
      {place === 'settings' ? (
        <div className="row">
          <button type="button" className="button" onClick={() => setDisconnecting(true)}>
            연결 끊기
          </button>
        </div>
      ) : null}
      {disconnecting ? (
        <DisconnectDialog
          web={web}
          onClose={() => setDisconnecting(false)}
          onDone={(next) => {
            setDisconnecting(false)
            handle.set(next)
          }}
        />
      ) : null}
    </div>
  )
}

/** 지금 채팅을 받는 실제 방송(끝나지 않음, 유튜브 방송을 이었음)의 제목 */
async function collectingTitles(): Promise<string[]> {
  const { broadcasts } = await get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
  const open = broadcasts.filter((item) => !item.rehearsal && !item.ended)
  const views = await Promise.all(
    open.map(async (item) => {
      try {
        return { item, view: await get<LinkView>(`/api/broadcasts/${encodeURIComponent(item.id)}/youtube`) }
      } catch {
        return { item, view: null }
      }
    }),
  )
  return views.filter(({ view }) => view?.link !== null && view?.link !== undefined).map(({ item }) => item.title)
}

/**
 * 연결 끊기 확인 (AC-I3-03): 처음 포커스·Esc는 "그대로 두기" — 그때는 아무 요청도 보내지 않는다.
 * 서버가 읽으면(web) 끊어도 채팅은 그대로 받는다 — 채팅을 받는 방송 목록을 찾지 않는다 (D-YT-SRV-10)
 */
function DisconnectDialog({ web, onClose, onDone }: { readonly web: boolean; readonly onClose: () => void; readonly onDone: (connection: YoutubeConnection) => void }) {
  const [titles, setTitles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    if (web) return
    let alive = true
    collectingTitles().then(
      (list) => {
        if (alive) setTitles(list)
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [web])
  const disconnect = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { connection } = await post<{ connection: YoutubeConnection }>('/api/youtube/connection/disconnect', {})
      onDone(connection)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      setBusy(false)
    }
  }
  return (
    <Modal
      title="유튜브 연결을 끊을까요?"
      onClose={onClose}
      closeLabel="그대로 두기"
      actions={
        <button type="button" className="button button-danger" disabled={busy} onClick={() => void disconnect()}>
          연결 끊기
        </button>
      }
    >
      <p>{web ? '끊으면 감사 메시지 자동 게시가 멈추고, 자동 게시 동의도 지워져요. 채팅은 그대로 받아요.' : '끊으면 진행 중인 방송의 채팅 수집과 감사 메시지 자동 게시가 멈추고, 자동 게시 동의도 지워져요.'}</p>
      <p>이미 받은 찜과 판매 기록은 그대로예요.</p>
      {titles.map((title) => (
        <p key={title} className="warning">
          지금 채팅을 받는 방송: {title}
        </p>
      ))}
      {error !== null ? <ErrorNote error={error} /> : null}
    </Modal>
  )
}
