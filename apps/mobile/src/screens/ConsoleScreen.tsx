// D-UX4-20 (사용자 지시 2026-11-09): 머리 오른쪽 ⋯ 대신 회색 톱니. 누르면 아래 판이 아니라 오른쪽에서 밀려 들어오는 "방송 설정" 화면(토스 설정처럼 굵은 묶음 이름·흰 카드),
// 머리 글("방송 메뉴"·방송 제목)은 없앴다. "직접 넣기"는 상품 탭 오른쪽 아래 (+) → 상품 추가 화면(D-UX4-31), 문자찜 넣기는 설정 화면 줄로.
// 방송 중 (SPEC §7 화면 2, D-UX2-03 새 시안): 머리(뒤로 · "방송 중" · 음성 상태 · 방송 메뉴) → 도움 한 줄 → 꼭 필요한 경고만 한 줄씩
// → 음성 확인할 것 → 상품 전체 리스트(최신이 위). 아래 고정 버튼은 없다 — 직접 넣기·휴대폰 마이크는 방송 메뉴(⋯)에 (D-UX3-73).
// 빠른 입력·문자찜은 "직접 넣기" 시트, 유튜브 잇기·음성 설정·방송 끝내기는 방송 메뉴(⋯)의 시트로 옮겼다. 상품이 없는 새 방송이 유튜브에
// 이어져 있지 않으면 유튜브 잇기 시트를 한 번 먼저 연다(방송 시작 흐름의 "주소 붙여넣기" 단계).
// - 범위 자료는 ScopeStore(웹과 같은 프로토콜)로 받고, 쓰기는 /api/events에 요청 번호를 붙여 보낸 뒤 응답 seq까지 따라잡는다.
// - 앱이 뒤로 갔다 돌아오면(APP-04) 실시간을 다시 잇고 쌓인 라벨을 이어 찍고 "자리를 비운 동안 라벨 n장·찜 n건·음성 n개"를 10초 보인다.
// - 라벨 상태 낱말(라벨 대기·출력됨·재출력 필요)은 서버 출력 기록(GET /api/print/labels?date=)에서 — 리허설은 없다.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ScrollView, View, type ScrollViewInstance } from 'react-native'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { ApiError, get, isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import { BuyerNames, alertCounts, boardProducts } from '../lib/derive.ts'
import { ScopeStore, type ScopeSnapshot } from '../lib/scope-store.ts'
import { useAppForeground } from '../lib/use-app-state.ts'
import { LISTEN_START, LISTEN_STOP, LIVE_RECONNECTING, LIVE_STALE, RETRY_NOW, VOICE_SELLER_ONLY } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { AppHeader, BigButton, BottomSheet, ConfirmSheet, FullSheet, DotStatus, HeaderIconButton, ToggleRow, Txt, useBottomInset, useKit } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { BigButton as SmallButton, Loading, Notice, Row } from '../ui/parts.tsx'
import { AlertStrip } from './console/AlertStrip.tsx'
import { ConsoleContext, type ConsoleApi } from './console/context.ts'
import { ProductDetail, ProductList, shownProducts } from './console/ProductBoard.tsx'
import { AddFab, ProductAddPage } from './console/ProductAdd.tsx'
import { MenuGroup, MenuRow, SlidePage } from './console/parts.tsx'
import { SmsForm } from './console/SmsForm.tsx'
import { ChatView, PasteView } from './console/ChatPaste.tsx'
import { DecisionsView } from './console/Decisions.tsx'

import { Pill } from '../ui/day-pills.tsx'
import { UndoStrip, noItems, noSubscribe, useUndoQueue } from '../lib/host-queue.tsx'
import { VoicePanel, VoiceSettingsPanel } from './console/VoicePanel.tsx'
import { ListenLine, listenChip, useKeptStream } from './console/StreamAudio.tsx'
import { ClaimFeed } from './console/ClaimFeed.tsx'
import { LiveTalk, TALK_TAB } from './console/LiveTalk.tsx'
import { APP_IMPORT_TITLE, ImportView } from './console/ImportSheet.tsx'
import { canLinkByAddress } from './BroadcastLinkScreen.tsx'
import { YoutubeSection, YoutubeWarning, sendLiveLink, useAddressLinker, useMobileYoutube, wasLinkAsked } from './console/YoutubeSection.tsx'

/** 방송 설정의 문자찜 칸 줄 이름 (D-UX4-20 — 옛 "직접 넣기" 시트의 문자찜 칸) */
export const SMS_DIRECT = '문자찜 직접 넣기'

/** 감사 채팅 켜기·끄기 결과 줄을 보이는 시간 */
const THANKS_NOTE_MS = 5000
export const THANKS_ON_DONE = '감사 채팅을 켰어요. 이제 찜이 확정되면 채팅에 감사 메시지를 올려요.'
export const THANKS_OFF_DONE = '감사 채팅을 껐어요. 이제 채팅에 감사 메시지를 올리지 않아요.'

/** 방송 설정의 감사 채팅 스위치 (D-YT-SRV-24 → D-UX4-20 스위치로) — 켜짐·꺼짐이 스위치에 보인다 */
export function ThanksSwitch({ on, busy, onPress }: { readonly on: boolean; readonly busy: boolean; readonly onPress: (next: boolean) => void }) {
  return (
    <View style={{ paddingHorizontal: SPACE.xl }}>
      <ToggleRow title="감사 채팅" on={on} disabled={busy} testID="thanks-switch" onChange={onPress} />
    </View>
  )
}

/** 돌아온 뒤 따라잡기를 기다리는 최대 시간 (APP-04 AC1 "3초 안에") */
const RETURN_WAIT_MS = 3000
/** 채팅 의심 표시 읽는 간격 (D-V3-129) */
const DOUBT_POLL_MS = 20_000

export function useScopeStore(broadcastId: string): { store: ScopeStore; snapshot: ScopeSnapshot } {
  const services = useServices()
  const store = useMemo(() => new ScopeStore({ broadcastId, openStream: () => services.stream.open() }), [broadcastId, services])
  // 방송 화면에 들어왔다는 기록을 먼저 끝낸 뒤 방송 목록을 받는다 (D-UX3-25 고침): 새 방송 단계에서 만든 방송은 이 기록 전에는 목록에 없어,
  // 둘을 함께 보내면 목록이 먼저 와 "그 방송을 찾지 못했어요"가 떴다(라벨 [괜찮아요]로 바로 넘어올 때). 기록이 실패해도 그대로 불러온다.
  useEffect(() => {
    let live = true
    void withRetry(() => post(`/api/broadcasts/${encodeURIComponent(broadcastId)}/open`, {}))
      .catch(() => undefined)
      .then(() => {
        if (live) void store.start()
      })
    return () => {
      live = false
      store.stop()
    }
  }, [store, broadcastId])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return { store, snapshot }
}

export function LiveNotice({ snapshot, onRetry }: { readonly snapshot: ScopeSnapshot; readonly onRetry: () => void }) {
  return (
    <>
      {snapshot.connection !== 'open' ? <Notice tone="warning">{LIVE_RECONNECTING}</Notice> : null}
      {snapshot.stale ? (
        <Row wrap>
          <Notice tone="warning" alert>
            {LIVE_STALE}
          </Notice>
          <SmallButton small label={RETRY_NOW} onPress={onRetry} />
        </Row>
      ) : null}
    </>
  )
}

function AwayLine() {
  const { away } = useServices()
  const view = useSyncExternalStore(away.subscribe, away.getSnapshot)
  useEffect(() => {
    if (view.line === null) return
    const handle = setTimeout(() => away.tick(Date.now()), Math.max(0, view.until - Date.now()))
    return () => clearTimeout(handle)
  }, [away, view])
  if (view.line === null) return null
  return (
    <Notice tone="info" label="자리를 비운 동안">
      {view.line}
    </Notice>
  )
}

/**
 * onEnded: 방송을 끝낸 뒤 (D-UX2-07) — 경로가 홈으로 돌려보내고 홈이 방송 목록을 다시 받는다. 없으면 이 화면에 "끝난 방송"으로 남는다.
 */
/**
 * openLink: 방송 연결을 쌓인 화면으로 연다(밀어서 뒤로 가기, D-UX3-09) — 없으면 앱 안 전체 화면 판(시험·웹).
 * refresh: 바뀌면 유튜브 잇기 상태를 다시 받는다(방송 연결 화면에서 돌아올 때 경로가 올린다).
 */
export function ConsoleScreen({ broadcastId, seller, onBack, onEnded, openReviews, openLabels, openLink, refresh = 0 }: { readonly broadcastId: string; readonly seller: boolean; readonly onBack: () => void; readonly onEnded?: () => void; readonly openReviews?: () => void; readonly openLabels?: () => void; readonly openLink?: (closed: boolean) => void; readonly refresh?: number }) {
  const services = useServices()
  const { store, snapshot } = useScopeStore(broadcastId)
  const { p } = useKit()
  const inset = useBottomInset()
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  type SheetName = 'none' | 'sms' | 'youtube' | 'voice' | 'end' | 'chat' | 'paste' | 'decide' | 'pending' | 'import'
  const [sheet, setSheet] = useState<SheetName>('none')
  // 밀려 들어오는 화면 (D-UX4-20·31): 방송 설정 · 상품 추가. 판(Modal)이 아니라 방송 화면 안에 겹쳐 그려, 여기서 연 판이 그 위에 그대로 뜬다(D-UX3-26 겹침 없음)
  const [page, setPage] = useState<'none' | 'settings' | 'add'>('none')
  const [thanksBusy, setThanksBusy] = useState(false)
  // 본문 탭: 상품(번호·가격·예약) · 찜 기록(채팅찜·문자찜을 시간순으로, D-LIVETEST-07) · 채팅·문자(실시간으로 온 채팅·손님 문자, D-UX4-12)
  const [tab, setTab] = useState<'products' | 'feed' | 'talk'>('products')
  // 라이브 채팅처럼 (D-UX3-75): 목록은 최신이 맨 아래. 처음·탭을 바꿀 때는 맨 아래에서 시작하고,
  // 맨 아래를 보고 있는 동안 새 줄이 오면 따라 내려간다. 위로 올려 보고 있으면 그대로 둔다.
  const scroll = useRef<ScrollViewInstance>(null)
  const atBottom = useRef(true)
  useEffect(() => {
    atBottom.current = true
    scroll.current?.scrollToEnd({ animated: false })
  }, [tab])
  const [decideFor, setDecideFor] = useState<string | null>(null)
  // 방송자 조치 5초 대기·되돌리기 (정하기 창 — D-APPX-03). 화면이 내려가면 기다리던 조치는 보내지 않는다
  const hostQueue = useUndoQueue()
  const hostItems = useSyncExternalStore(hostQueue?.subscribe ?? noSubscribe, hostQueue?.getSnapshot ?? noItems)
  const [pasted, setPasted] = useState<string | null>(null)
  const [labels, setLabels] = useState<readonly LabelView[]>([])
  const [endError, setEndError] = useState<string | null>(null)
  // 방송 중 감사 채팅 켜기·끄기 결과 한 줄 (D-YT-SRV-24) — 5초 뒤 사라진다
  const [thanksNote, setThanksNote] = useState<{ readonly tone: 'success' | 'danger'; readonly text: string } | null>(null)
  useEffect(() => {
    if (thanksNote === null) return
    const handle = setTimeout(() => setThanksNote(null), THANKS_NOTE_MS)
    return () => clearTimeout(handle)
  }, [thanksNote])
  // 끝내기 성공 — 방송 목록을 다시 받지 않아도 바로 "끝난 방송"으로 (범위 기록의 방송 정보는 처음 한 번만 받는다)
  const [endedHere, setEndedHere] = useState(false)
  const labelsQueue = useSyncExternalStore(services.labels.subscribe, services.labels.getSnapshot)
  const data = snapshot.data
  const broadcast = snapshot.broadcast
  const returning = useRef<{ at: number } | null>(null)
  // 유튜브 (YT-11): 실제 방송만 — 리허설은 유튜브 요청을 보내지 않는다
  const yt = useMobileYoutube(broadcastId, broadcast !== null && !broadcast.rehearsal)

  // 앱이 뒤로 갔다 돌아옴 (APP-04)
  const finishReturn = useCallback(() => {
    if (returning.current === null) return
    returning.current = null
    services.away.back(store.getSnapshot().data?.claims.keys() ?? [], services.labels.backlog, Date.now())
  }, [services, store])
  useAppForeground({
    onBackground: () => services.away.leave(store.getSnapshot().data?.claims.keys() ?? [], Date.now()),
    onForeground: () => {
      returning.current = { at: Date.now() }
      services.stream.resume()
      services.labels.resume()
      void store.retryNow()
      setTimeout(finishReturn, RETURN_WAIT_MS)
    },
  })
  useEffect(() => {
    // 다시 붙어 따라잡았으면 기다리지 않고 바로 줄을 정한다
    if (returning.current !== null && snapshot.connection === 'open' && !snapshot.stale && snapshot.reconnects > 0) finishReturn()
  }, [snapshot.connection, snapshot.stale, snapshot.reconnects, snapshot.data?.seq, finishReturn])

  // 라벨 상태 (실제 방송만) — 범위 기록이 바뀌면 조금 뒤 다시 받는다
  const seq = data?.seq ?? 0
  const rehearsal = broadcast?.rehearsal ?? true
  useEffect(() => {
    if (broadcast === null || rehearsal || data === null) return
    let alive = true
    const handle = setTimeout(() => {
      get<{ labels: LabelView[] }>(withQuery('/api/print/labels', { date: broadcast.date })).then(
        (view) => {
          if (alive) setLabels(view.labels)
        },
        () => {
          // 라벨 상태는 다음 변경 때 다시 받는다
        },
      )
    }, 300)
    return () => {
      alive = false
      clearTimeout(handle)
    }
  }, [broadcast, rehearsal, seq, labelsQueue.queue?.rev, data === null])

  const names = useMemo(() => (data === null ? null : new BuyerNames(data.buyers, data.claims)), [data])
  const labelWords = useMemo(() => {
    const map = new Map<string, string>()
    for (const label of labels) if (label.claim !== null && label.word !== '') map.set(label.claim, label.word)
    return map
  }, [labels])

  const ended = (broadcast?.ended ?? false) || endedHere
  const sealed = data?.sealed ?? false
  // 방송 연결 전체 화면 (D-UX3-06·07): 아직 잇지 않은 방송이면 주소 칸은 본문에, [확인]는 맨 아래(주소를 넣어야 보인다) — 아니면 유튜브 칸 그대로.
  // 훅이라 이른 return보다 앞에 둔다
  const linkable = canLinkByAddress(yt, ended || sealed)
  // 방송 연결 화면에서 돌아오면 잇기 상태를 다시 받는다
  const { reload: reloadYoutube } = yt
  useEffect(() => {
    if (refresh > 0) void reloadYoutube()
  }, [refresh, reloadYoutube])
  const showLink = () => {
    if (openLink === undefined) setSheet('youtube')
    else {
      setSheet('none')
      openLink(ended || sealed)
    }
  }
  const linker = useAddressLinker({ enabled: sheet === 'youtube' && linkable, webChat: yt.webChat, broadcastId, submit: async (request) => {
      const view = await sendLiveLink(broadcastId, request)
      if (view === null) setSheet('none')
      else yt.setLink(view)
    } })
  const command = useCallback(
    async (event: Readonly<Record<string, unknown>>, requestId: string = newRequestId()): Promise<WriteResult> => {
      const current = store.getSnapshot()
      if (current.data === null) throw new ApiError({ status: 0, code: 'NOT_READY', message: '아직 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요.' })
      if (current.data.sealed) throw new ApiError({ status: 409, code: 'SEALED', message: '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.' })
      let result: WriteResult
      try {
        result = await withRetry(() => post<WriteResult>(withQuery('/api/events', typeof event.b === 'string' ? {} : { date: current.data!.date, rehearsal: current.data!.rehearsal }), { requestId, ...event }))
      } catch (error) {
        if (isApiError(error) && error.code === 'PROCESSING_FAILED') void store.catchUp()
        throw error
      }
      await store.sync(result.seq)
      return result
    },
    [store],
  )

  // 방송이 끝나면 음성도 끈다 (APP-02 "방송 끝")
  const voiceView = useSyncExternalStore(services.voice.subscribe, services.voice.getView)
  const live = seller && broadcast !== null && !(broadcast.ended || endedHere) && !(data?.sealed ?? false)
  // 방송 소리 듣기는 앱 뿌리가 붙잡는다 — 이 화면을 나가도 계속 듣는다 (D-UX3-48). 방송이 끝났거나 닫혔으면 놓는다
  const streamTitle = broadcast === null || broadcast.title.trim() === '' ? '제목 없음' : broadcast.title
  const knownOver = broadcast !== null && !live
  useEffect(() => {
    if (live) services.streamKeep.keep(broadcastId, streamTitle)
    else if (knownOver) services.streamKeep.release(broadcastId)
  }, [live, knownOver, broadcastId, streamTitle, services])
  const stream = useKeptStream(services.streamKeep, broadcastId)

  // 채팅 의심 표시 (D-V3-129): 방송 중·판매자일 때 20초마다 읽는다 — 등록을 바꾸지 않고 줄에 문장만
  const [doubts, setDoubts] = useState<ReadonlyMap<number, string>>(new Map())
  useEffect(() => {
    if (!live) return
    let stop = false
    const read = () => {
      get<{ doubts: readonly { no: number; text: string }[] }>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/voice-doubts`).then((body) => {
        if (!stop) setDoubts(new Map(body.doubts.map((doubt) => [doubt.no, doubt.text])))
      }, () => undefined)
    }
    read()
    const timer = setInterval(read, DOUBT_POLL_MS)
    return () => { stop = true; clearInterval(timer) }
  }, [live, broadcastId])

  // 상품이 없는 새 방송이 유튜브에 이어져 있지 않으면 연결 화면을 한 번 연다 — 새 방송 화면에서 주소 단계를 이미 거쳤으면 열지 않는다 (D-UX3-06)
  const askedLink = useRef(wasLinkAsked(broadcastId))
  const productCount = data === null ? -1 : boardProducts(data, broadcastId).length
  useEffect(() => {
    if (askedLink.current || yt.phase !== 'ready' || yt.link === null || yt.link.link !== null) return
    if ((broadcast?.ended ?? true) || (data?.sealed ?? true) || productCount !== 0) return
    askedLink.current = true
    if (openLink !== undefined) openLink(false)
    else setSheet((now) => (now === 'none' ? 'youtube' : now))
  }, [yt.phase, yt.link, broadcast?.ended, data?.sealed, productCount])
  useEffect(() => {
    if (ended && voiceView.on && voiceView.broadcastId === broadcastId) void services.voice.turnOff()
  }, [ended, voiceView.on, voiceView.broadcastId, broadcastId, services])

  const endBroadcast = async () => {
    setEndError(null)
    try {
      const result = await withRetry(() => post<WriteResult>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/end`, { requestId: newRequestId() }))
      setEndedHere(true)
      setSheet('none')
      await store.sync(result.seq)
      onEnded?.()
    } catch (caught) {
      setSheet('none')
      setEndError(isApiError(caught) ? caught.message : '끝내지 못했어요. 다시 눌러 주세요.')
    }
  }

  const frame = (body: ReactNode) => (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <AppHeader title="방송" onBack={onBack} backLabel="홈으로" />
      <View style={{ paddingHorizontal: SPACE.lg, gap: SPACE.md }}>{body}</View>
    </View>
  )
  if (snapshot.phase === 'missing') {
    return frame(
      <>
        <Notice tone="danger" alert>
          그 방송을 찾지 못했어요. 홈에서 다시 골라 주세요.
        </Notice>
        <BigButton label="홈으로" onPress={onBack} />
      </>,
    )
  }
  if (snapshot.phase === 'error' && snapshot.error !== null) {
    return frame(
      <>
        <Notice tone="danger" alert>
          {snapshot.error.message}
        </Notice>
        <BigButton label={RETRY_NOW} onPress={() => void store.retryNow()} />
        <BigButton kind="outline" label="홈으로" onPress={onBack} />
      </>,
    )
  }
  if (data === null || broadcast === null || names === null) {
    return frame(
      <>
        <LiveNotice snapshot={snapshot} onRetry={() => void store.retryNow()} />
        <Loading />
      </>,
    )
  }

  const api: ConsoleApi = { b: broadcastId, data, names, ended, sealed, command, sync: (seq) => store.sync(seq), latest: () => store.getSnapshot().data ?? data, select: setSelected, selected, labelWords, doubts }
  const detailProduct = detail === null ? undefined : data.products.get(detail)
  const title = broadcast.title.trim() === '' ? '제목 없음' : broadcast.title
  const closed = ended || sealed
  // 홈 "지금 라이브 중"과 같은 말로 (D-UX3-89 — 옛 "방송 중")
  const heading = ended ? '끝난 방송' : '라이브'
  const help = closed ? '끝난 방송이에요. 늦게 온 채팅·문자찜은 처리돼요.' : !seller ? VOICE_SELLER_ONLY : null
  const close = () => setSheet('none')
  const closePage = () => setPage('none')
  // 다육이 방송이면 상품 추가에서 품종도 묻는다 (D-UX4-31 — 판매 종류는 방송 제목에 들어 있다, NewBroadcastScreen)
  const askName = broadcast.title.includes('다육이')
  const thanksOn = data.broadcasts.get(broadcastId)?.settings['thanks.liveChat'] === true
  const listening = voiceView.on && voiceView.broadcastId === broadcastId
  const switchThanks = (next: boolean) => {
    setThanksBusy(true)
    command({ type: 'broadcast.thanks', b: broadcastId, liveChat: next }).then(
      () => setThanksNote({ tone: 'success', text: next ? THANKS_ON_DONE : THANKS_OFF_DONE }),
      (caught: unknown) => setThanksNote({ tone: 'danger', text: isApiError(caught) ? caught.message : '바꾸지 못했어요. 다시 눌러 주세요.' }),
    ).finally(() => setThanksBusy(false))
  }
  const thanksLine = thanksNote !== null ? <Notice tone={thanksNote.tone} alert={thanksNote.tone === 'danger'}>{thanksNote.text}</Notice> : null
  const chip = listenChip(voiceView, broadcastId, stream.status)
  const claimCount = [...data.claims.values()].filter((claim) => claim.broadcast === broadcastId && claim.status !== 'DUPLICATE').length
  const productCountNow = shownProducts(data, broadcastId).length
  const onAlert = (action: 'pending' | 'attention' | 'decide' | 'labels') => {
    if (action === 'pending') setSheet('pending')
    else if (action === 'attention') openReviews?.()
    else if (action === 'decide') { setDecideFor(null); setSheet('decide') }
    else openLabels?.()
  }

  return (
    <ConsoleContext.Provider value={api}>
      <View style={{ flex: 1, backgroundColor: p.background }} testID="console-screen">
        <AppHeader
          title={heading}
          onBack={onBack}
          backLabel="홈으로"
          right={
            <>
              {seller && !closed ? <DotStatus word={chip.word} tone={chip.tone} /> : null}
              {/* 토스 계좌 화면 오른쪽 위 회색 톱니 (D-UX4-20) — 화면에 글은 없고 이름만 읽힌다 */}
              <HeaderIconButton icon="gear" label="방송 메뉴" color={p.clearCircle} size={27} onPress={() => setPage('settings')} />
            </>
          }
        />
        {help !== null ? (
          <View style={{ paddingHorizontal: SPACE.xl, paddingBottom: SPACE.sm }}>
            <Txt step="caption" color="textSub">
              {help}
            </Txt>
          </View>
        ) : null}
        <ScrollView
          ref={scroll}
          scrollEventThrottle={100}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
            atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 48
          }}
          onContentSizeChange={() => { if (atBottom.current) scroll.current?.scrollToEnd({ animated: false }) }}
          style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: SPACE.md, paddingBottom: Math.max(inset, SPACE.md) + SPACE.xl, gap: SPACE.sm }} keyboardShouldPersistTaps="handled">
          <AwayLine />
          <LiveNotice snapshot={snapshot} onRetry={() => void store.retryNow()} />
          {sealed ? <Notice tone="info">30일이 지나 봉인한 날짜예요. 볼 수만 있어요.</Notice> : null}
          {endError !== null ? <Notice tone="danger" alert>{endError}</Notice> : null}
          {page !== 'settings' ? thanksLine : null}
          <AlertStrip counts={alertCounts(data)} queue={labelsQueue.queue} rehearsal={broadcast.rehearsal} ended={ended} onAction={onAlert} />
          {pasted !== null ? <Notice tone="success">{pasted}</Notice> : null}
          {hostQueue !== null ? <UndoStrip items={hostItems} queue={hostQueue} /> : null}
          <YoutubeWarning yt={yt} closed={closed} onPaste={() => setSheet('paste')} />
          {live ? <ListenLine session={services.voice} broadcastId={broadcastId} stream={stream} /> : null}
          <VoicePanel session={services.voice} broadcastId={broadcastId} title={title} seller={seller} ended={ended} />
          <View role="tablist" aria-label="보기" style={{ flexDirection: 'row', gap: SPACE.sm }}>
            <Pill on={tab === 'products'} label={`상품 ${String(productCountNow)}`} ariaLabel="상품" onPress={() => setTab('products')} />
            <Pill on={tab === 'feed'} label={`찜 기록 ${String(claimCount)}`} ariaLabel="찜 기록" onPress={() => setTab('feed')} />
            <Pill on={tab === 'talk'} label={TALK_TAB} ariaLabel={TALK_TAB} onPress={() => setTab('talk')} />
          </View>
          {/* 목록 붙이기 (D-UX3-81 — D-UX3-77을 바꿈): 채팅·문자는 라이브 채팅처럼 화면 아래에, 상품·찜 기록은 위에 */}
          <View testID="console-list" style={{ flexGrow: 1, justifyContent: tab === 'talk' ? 'flex-end' : 'flex-start' }}>
            {tab === 'products' ? <ProductList onOpen={setDetail} /> : tab === 'feed' ? <ClaimFeed onOpenProduct={setDetail} /> : <LiveTalk />}
          </View>
          {/* (+) 단추에 마지막 줄이 가리지 않게 */}
          {tab === 'products' && !closed ? <View style={{ height: 72 }} /> : null}
        </ScrollView>
        {tab === 'products' && !closed ? <AddFab bottom={Math.max(inset, SPACE.md) + SPACE.md} onPress={() => setPage('add')} /> : null}

        <BottomSheet visible={sheet === 'sms'} onClose={close} title={SMS_DIRECT}>
          <SmsForm />
        </BottomSheet>
        {/* 상품 자세히 (D-UX4-30): 번호·품종·가격은 판 안 점선 칸이 보이므로 판 제목은 두지 않는다 */}
        <BottomSheet visible={detailProduct !== undefined && detailProduct.status !== 'CLOSED'} onClose={() => setDetail(null)} title="">
          {detailProduct !== undefined ? <ProductDetail product={detailProduct} onKey={setDetail} onDone={() => setDetail(null)} {...(seller && !sealed ? { onDecide: () => { setDecideFor(detailProduct.key); setDetail(null); setSheet('decide') } } : {})} /> : null}
        </BottomSheet>
        <BottomSheet visible={sheet === 'decide'} onClose={close} title="정하기">
          {sheet === 'decide' && hostQueue !== null ? <DecisionsView queue={hostQueue} {...(decideFor === null || data.products.get(decideFor) === undefined ? {} : { product: data.products.get(decideFor) })} onQueued={close} /> : null}
        </BottomSheet>
        <FullSheet visible={sheet === 'import'} onClose={close} name={APP_IMPORT_TITLE} title={APP_IMPORT_TITLE}>
          {sheet === 'import' ? <ImportView /> : null}
        </FullSheet>
        <BottomSheet visible={sheet === 'pending'} onClose={close} title="보류 찜">
          <Txt step="caption" color="textSub">아직 상품이 없는 번호의 찜이에요. 그 번호 상품을 올리면 먼저 온 순서대로 정해져요.</Txt>
          {sheet === 'pending' ? <ClaimFeed only="PENDING" /> : null}
        </BottomSheet>
        <BottomSheet visible={sheet === 'chat'} onClose={close} title="채팅">
          {sheet === 'chat' ? <ChatView /> : null}
        </BottomSheet>
        <BottomSheet visible={sheet === 'paste'} onClose={close} title="댓글 붙여넣기">
          {sheet === 'paste' ? (
            <PasteView
              onDone={(message) => {
                setPasted(message)
                close()
              }}
            />
          ) : null}
        </BottomSheet>
        <ProductAddPage
          visible={page === 'add'}
          onClose={closePage}
          askName={askName}
          onAdded={(key) => {
            closePage()
            setTab('products')
            setSelected(key)
            scroll.current?.scrollTo({ y: 0, animated: true })
          }}
        />
        {/* 방송 설정 (D-UX4-20): 토스 설정 화면처럼 — 머리 글 없이 뒤로만, 굵은 묶음 이름 · 흰 카드 · 줄 이름만 */}
        <SlidePage visible={page === 'settings'} onClose={closePage} name="방송 설정" gray testID="console-settings">
          {thanksLine}
          <MenuGroup title="방송">
            {yt.phase !== 'hidden' && yt.phase !== 'loading' ? <MenuRow title="방송 연결" onPress={showLink} /> : null}
            {/* 방송 중 감사 채팅 켜기·끄기 (D-YT-SRV-24) — 실제 방송만(리허설은 유튜브에 아무것도 올리지 않는다) */}
            {seller && !closed && !broadcast.rehearsal ? <ThanksSwitch on={thanksOn} busy={thanksBusy} onPress={switchThanks} /> : null}
            {openLabels !== undefined && !broadcast.rehearsal ? <MenuRow title="프린터·라벨" onPress={openLabels} /> : null}
          </MenuGroup>
          {seller && !closed ? (
            <MenuGroup title="듣기">
              {/* 휴대폰 마이크 켜기·끄기는 방송 화면에서 안내·상태를 보여 주므로 설정 화면을 닫는다 (D-UX3-73) */}
              <MenuRow title={listening ? LISTEN_STOP : LISTEN_START} testID="listen-button" onPress={() => { closePage(); void (listening ? services.voice.turnOff() : services.voice.turnOn(broadcastId, title)) }} />
              {stream.status?.phase === 'stopped' ? <MenuRow title="방송 소리 다시 켜기" onPress={() => { closePage(); stream.retry() }} /> : null}
              <MenuRow title="음성 설정" onPress={() => setSheet('voice')} />
            </MenuGroup>
          ) : null}
          <MenuGroup title="넣기·보기">
            {!closed ? <MenuRow title={SMS_DIRECT} onPress={() => setSheet('sms')} /> : null}
            {/* 방송 전 상품 미리 등록 (PRD-05 앱, D-V3-128) */}
            {seller && !closed ? <MenuRow title={APP_IMPORT_TITLE} onPress={() => setSheet('import')} /> : null}
            {!broadcast.rehearsal && !closed ? <MenuRow title="댓글 붙여넣기" onPress={() => setSheet('paste')} /> : null}
            <MenuRow title="채팅 보기" onPress={() => setSheet('chat')} />
          </MenuGroup>
          {!closed ? (
            <MenuGroup>
              <MenuRow title="방송 끝내기" danger onPress={() => setSheet('end')} />
            </MenuGroup>
          ) : null}
        </SlidePage>
        {/* 방송 연결은 전체 화면 (D-UX3-06) — 키보드가 주소 칸을 가리지 않게 */}
        <FullSheet visible={sheet === 'youtube'} onClose={close} name="방송 연결" title={linkable ? '방송 링크를 넣어 주세요' : '방송 연결'} cards={!linkable} overlay={linkable ? linker.popup : undefined} actions={linkable ? (
            <>
              <BigButton kind="outline" label="나중에 잇기" onPress={close} />
              {linker.action}
            </>
          ) : undefined}>
          {linkable ? (
            <View role="group" aria-label="유튜브">
              {linker.fields}
            </View>
          ) : (
            <YoutubeSection yt={yt} closed={closed} />
          )}
        </FullSheet>
        <BottomSheet visible={sheet === 'voice'} onClose={close} title="음성 설정">
          <VoiceSettingsPanel session={services.voice} broadcastId={broadcastId} />
        </BottomSheet>
        <ConfirmSheet
          visible={sheet === 'end'}
          question="방송을 끝낼까요?"
          description="끝난 뒤에도 늦게 온 채팅·문자찜은 처리돼요."
          confirmLabel="끝내기"
          cancelLabel="아니요"
          danger
          onCancel={close}
          onConfirm={() => void endBroadcast()}
        />
      </View>
    </ConsoleContext.Provider>
  )
}
